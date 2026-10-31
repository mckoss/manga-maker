import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db';
import {
	items as itemsTable,
	styles,
	versions as versionsTable,
	type ColorMode,
	type Item,
	type Style,
	type Version
} from './db/schema';
import { IMAGE_MODELS, randomSeed, type ImageModelId } from './ai/image';
import { putImage } from './assets';
import { enqueue, type JobHandler } from './jobs';
import {
	addVersion,
	attachJob,
	currentVersions,
	deleteScope,
	describeScope,
	ensureItem,
	finishVersion,
	itemsIn,
	slotKey,
	startVersion,
	VersionError,
	type Access,
	type ItemView
} from './versions';

export class StyleError extends Error {}

export const COLOR_MODES: Record<ColorMode, { label: string; phrase: string }> = {
	bw: {
		label: 'Black and white with screentones',
		phrase: 'Black and white manga art, black ink with screentone shading.'
	},
	grayscale: {
		label: 'Grayscale',
		phrase: 'Grayscale manga art with ink outlines and soft gray shading.'
	},
	limited: {
		label: 'Limited palette',
		phrase: 'Manga art in a limited palette of black ink plus one or two accent colors.'
	},
	color: { label: 'Full color', phrase: 'Full-color manga art.' }
};

/**
 * Restated at the end of a picture prompt: the subject that comes last pulls
 * the image toward color unless the tones are repeated after it. ("No color"
 * would not do: the image model reads negation as a request.)
 */
export const TONE_REMINDER: Record<ColorMode, string> = {
	bw: 'Drawn entirely in black ink on white paper.',
	grayscale: 'Drawn entirely in shades of gray.',
	limited: '',
	color: ''
};

const HUES =
	'red|reddish|orange|yellow|yellowish|green|greenish|blue|bluish|purple|violet|pink|indigo|crimson|scarlet|vermilion|azure|turquoise|teal|emerald|jade|magenta|cyan|golden|amber|ochre|navy|colorful|vibrant';
const HUE_WORDS = new RegExp(`(?:-?\\b(?:${HUES})\\b-?)+\\s*`, 'gi');

/**
 * Take the hue words out of text drawn in black and white or grayscale: a
 * single "green rice paddies" or "blue sky" makes the image model paint the
 * whole picture in color.
 */
export function toneOnly(colorMode: ColorMode, text: string): string {
	if (colorMode !== 'bw' && colorMode !== 'grayscale') return text;
	return text
		.replace(HUE_WORDS, '')
		.replace(/\s+([,.;:!?])/g, '$1')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

/**
 * The kinds of test picture every style is drawn with. Covering figures,
 * faces, places and motion shows how a style handles each kind of panel.
 * The AI writes the actual scene for each to suit the style's setting and
 * era. Location scenes say "empty" and "No people": genre words in a style
 * otherwise put people in them.
 */
export const SAMPLE_SUBJECTS = [
	{
		key: 'figure',
		label: 'Figure',
		role: 'one character, full body, standing in a neutral pose, on a plain white background'
	},
	{
		key: 'face',
		label: 'Face',
		role: "a close-up of one character's face showing a clear emotion"
	},
	{
		key: 'interior',
		label: 'Interior',
		role: 'an empty indoor room typical of the setting',
		empty: true
	},
	{
		key: 'exterior',
		label: 'Exterior',
		role: 'an empty outdoor street or landscape typical of the setting',
		empty: true
	},
	{
		key: 'action',
		label: 'Action',
		role: 'one character in a dynamic action pose, with a sense of motion'
	}
] satisfies { key: string; label: string; role: string; empty?: true }[];

export type SubjectKey = (typeof SAMPLE_SUBJECTS)[number]['key'];

export const SAMPLE_SIZE = 1024;

/** What each kind of input is called when saying why something is out of date. */
const INPUT_LABELS: Record<string, string> = {
	description: 'the description',
	avoid: 'the keep-out list',
	color: 'the color mode',
	model: 'the image model',
	prompt: 'the style prompt',
	scene: 'the scene'
};

export function isColorMode(value: string): value is ColorMode {
	return value in COLOR_MODES;
}

export function isImageModel(value: string): value is ImageModelId {
	return value in IMAGE_MODELS;
}

export function isSubject(value: string): value is SubjectKey {
	return SAMPLE_SUBJECTS.some((s) => s.key === value);
}

/** End a prompt part with a full stop, so the next part starts a new sentence. */
export function sentence(text: string): string {
	const t = text.trim();
	return !t || /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * The full image prompt for one subject: color mode, then style, then
 * subject, without hue words when the style has no color.
 */
export function compilePrompt(
	style: { colorMode: ColorMode; prompt: string },
	subjectPrompt: string
): string {
	return toneOnly(
		style.colorMode,
		[COLOR_MODES[style.colorMode].phrase, sentence(style.prompt), subjectPrompt]
			.filter(Boolean)
			.join(' ')
	);
}

/**
 * The full image prompt for a sample picture, with the user's guidance for
 * that one round, ending with the tones to draw in.
 */
export function picturePrompt(
	style: { colorMode: ColorMode; prompt: string },
	scene: string,
	guidance = ''
): string {
	return compilePrompt(
		style,
		[sentence(scene), sentence(positiveOnly(guidance)), TONE_REMINDER[style.colorMode]]
			.filter(Boolean)
			.join(' ')
	);
}

const NEGATION = /^(no|not|non|without|avoid|never|absence of|free of)\b/i;

/**
 * Drop the "no X" clauses from text the AI wrote. The image models handle
 * negation badly ("no power lines" draws power lines), and the local models
 * write such clauses even when told not to.
 */
export function positiveOnly(text: string): string {
	return text
		.split(/(?<=[.!?])\s+/)
		.map((sentence) => {
			const end = /[.!?]$/.test(sentence) ? sentence.slice(-1) : '';
			const body = end ? sentence.slice(0, -1) : sentence;
			const kept = body
				.split(/\s*[,;]\s*/)
				.map((clause) => clause.replace(/^(and|or)\s+/i, ''))
				.filter((clause) => clause && !NEGATION.test(clause));
			return kept.length ? kept.join(', ') + end : '';
		})
		.filter(Boolean)
		.join(' ');
}

/** An AI-written scene, cleaned up; location scenes always end "No people." */
function cleanAiScene(subjectKey: string, scene: string): string {
	const subject = SAMPLE_SUBJECTS.find((s) => s.key === subjectKey);
	const text = sentence(positiveOnly(scene));
	return text && subject && 'empty' in subject ? `${text} No people.` : text;
}

// ---------------------------------------------------------------------------
// State

export const styleScope = (styleId: number) => `style:${styleId}`;

/** Everything a style's next prompt, scene or picture would be made from. */
interface StyleState {
	style: Style;
	description: string;
	avoid: string;
	prompt: string;
	promptVersionId: number | null;
	scenes: Partial<Record<string, string>>;
	current: Map<string, Version>;
}

function stateOf(db: Db, style: Style): StyleState {
	const current = currentVersions(db, styleScope(style.id));
	const prompt = current.get('prompt');
	return {
		style,
		description: current.get('description')?.text ?? '',
		avoid: current.get('avoid')?.text ?? '',
		prompt: prompt?.text ?? '',
		promptVersionId: prompt?.id ?? null,
		scenes: Object.fromEntries(
			SAMPLE_SUBJECTS.map((s) => [s.key, current.get(`scene:${s.key}`)?.text ?? ''])
		),
		current
	};
}

const promptInputs = (s: StyleState) => ({
	description: s.description,
	avoid: s.avoid,
	color: s.style.colorMode
});

const sceneInputs = (s: StyleState) => ({ description: s.description, avoid: s.avoid });

const pictureInputs = (s: StyleState, key: string) => ({
	prompt: s.prompt,
	scene: s.scenes[key] ?? '',
	color: s.style.colorMode,
	model: s.style.model
});

/** What a new version of an item would be made from; null for the user's own inputs. */
const questionInputs = (s: StyleState) => ({ description: s.description });

function inputsFor(state: StyleState, item: Pick<Item, 'kind' | 'key'>) {
	if (item.kind === 'questions') return questionInputs(state);
	if (item.kind === 'prompt') return promptInputs(state);
	if (item.kind === 'scene') return sceneInputs(state);
	if (item.kind === 'picture') return pictureInputs(state, item.key);
	return null;
}

function isOutOfDate(state: StyleState, item: Pick<Item, 'kind' | 'key'>): boolean {
	const version = state.current.get(slotKey(item));
	if (!version) return true;
	const now = inputsFor(state, item);
	return now !== null && Object.entries(now).some(([k, v]) => (version.inputs[k] ?? null) !== v);
}

// ---------------------------------------------------------------------------
// Queries

function ownedStyle(db: Db, ownerId: number, styleId: number): Style {
	const style = db
		.select()
		.from(styles)
		.where(and(eq(styles.id, styleId), eq(styles.ownerId, ownerId)))
		.get();
	if (!style) throw new StyleError('Style not found.');
	return style;
}

/** Who may change a style's items. */
export function styleAccess(db: Db, ownerId: number, styleId: number): Access {
	ownedStyle(db, ownerId, styleId);
	return { ownerId, scope: styleScope(styleId) };
}

/** Current sample picture thumbnails, in subject order. */
function thumbsOf(state: StyleState): string[] {
	return SAMPLE_SUBJECTS.map((s) => state.current.get(`picture:${s.key}`)?.thumbHash).filter(
		(h): h is string => Boolean(h)
	);
}

/**
 * A style is ready to draw the rest of the manga with once it has a prompt
 * and at least one sample picture to show what it looks like.
 */
function isReady(state: StyleState): boolean {
	return Boolean(state.prompt) && thumbsOf(state).length > 0;
}

export function listStyles(db: Db, ownerId: number) {
	return db
		.select()
		.from(styles)
		.where(eq(styles.ownerId, ownerId))
		.orderBy(desc(styles.createdAt))
		.all()
		.map((style) => {
			const state = stateOf(db, style);
			return { ...style, ready: isReady(state), thumbs: thumbsOf(state) };
		});
}

/** What the rest of the manga is drawn in: the current prompt, color mode and model. */
export interface DrawingStyle {
	styleId: number;
	description: string;
	colorMode: ColorMode;
	model: ImageModelId;
	prompt: string;
	promptVersionId: number | null;
	ready: boolean;
}

export function drawingStyle(db: Db, styleId: number): DrawingStyle | undefined {
	const style = db.select().from(styles).where(eq(styles.id, styleId)).get();
	if (!style) return undefined;
	const state = stateOf(db, style);
	return {
		styleId,
		description: state.description,
		colorMode: style.colorMode,
		model: style.model as ImageModelId,
		prompt: state.prompt,
		promptVersionId: state.promptVersionId,
		ready: isReady(state)
	};
}

const emptyView = (kind: string, key = ''): ItemView => ({
	id: 0,
	kind,
	key,
	locked: false,
	versions: [],
	currentId: null,
	pending: false,
	error: null
});

export function getStyle(db: Db, ownerId: number, styleId: number) {
	const style = ownedStyle(db, ownerId, styleId);
	const state = stateOf(db, style);
	const views = describeScope(
		db,
		styleScope(styleId),
		(item) => inputsFor(state, item),
		INPUT_LABELS
	);
	const view = (kind: string, key = '') =>
		views.get(key ? `${kind}:${key}` : kind) ?? emptyView(kind, key);
	const all = [...views.values()];
	const questions = view('questions');
	return {
		style,
		description: view('description'),
		questions: { item: questions, list: openQuestions(questions) },
		avoid: view('avoid'),
		prompt: view('prompt'),
		scenes: SAMPLE_SUBJECTS.map((s) => ({ ...s, item: view('scene', s.key) })),
		pictures: SAMPLE_SUBJECTS.map((s) => ({ ...s, item: view('picture', s.key) })),
		ready: isReady(state),
		busy: all.some((v) => v.pending)
	};
}

export type StyleDetail = ReturnType<typeof getStyle>;

const question = z.object({
	question: z.string().min(1),
	/** Short answers the user can pick instead of typing one. */
	suggestions: z.array(z.string()).default([])
});

export type Question = z.infer<typeof question>;

/**
 * The AI's questions about the current description, if it has any the user
 * hasn't answered or skipped yet. Questions about an older description are
 * not shown: a new set is asked when the user changes it.
 */
function openQuestions(item: ItemView): Question[] {
	const current = item.versions.find((v) => v.id === item.currentId);
	if (!current || current.outOfDate.length || item.pending) return [];
	return parseQuestions(current.text);
}

function parseQuestions(text: string): Question[] {
	try {
		return z.array(question).parse(JSON.parse(text));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Commands

export interface StyleInput {
	name: string;
	description: string;
	colorMode: ColorMode;
	model: ImageModelId;
}

/** Create a style from a description, and ask the AI to write its prompt and scenes. */
export function createStyle(db: Db, ownerId: number, input: StyleInput): number {
	const name = input.name.trim();
	const description = input.description.trim();
	if (!name) throw new StyleError('Give the style a name.');
	if (!description) throw new StyleError('Describe the look you want.');
	const style = db
		.insert(styles)
		.values({
			ownerId,
			name,
			colorMode: input.colorMode,
			model: input.model,
			createdAt: new Date()
		})
		.returning()
		.get();
	const scope = styleScope(style.id);
	addVersion(db, ensureItem(db, ownerId, scope, 'description'), {
		origin: 'user',
		text: description
	});
	requestQuestions(db, ownerId, style.id);
	requestPrompt(db, ownerId, style.id);
	requestScenes(db, ownerId, style.id, 'outdated');
	return style.id;
}

/**
 * Copy a style into a new one, so another manga can start from it: the
 * current version of each part, locks included, without the history.
 */
export function copyStyle(db: Db, ownerId: number, fromStyleId: number, name: string): number {
	const source = ownedStyle(db, ownerId, fromStyleId);
	const state = stateOf(db, source);
	if (!isReady(state)) throw new StyleError('Only a style with sample pictures can be reused.');
	return db.transaction(() => {
		const style = db
			.insert(styles)
			.values({
				ownerId,
				name,
				colorMode: source.colorMode,
				model: source.model,
				createdAt: new Date()
			})
			.returning()
			.get();
		for (const item of itemsIn(db, styleScope(source.id))) {
			const version = state.current.get(slotKey(item));
			if (!version) continue;
			const copy = ensureItem(db, ownerId, styleScope(style.id), item.kind, item.key);
			addVersion(db, copy, {
				origin: version.origin,
				text: version.text,
				assetHash: version.assetHash,
				thumbHash: version.thumbHash,
				seed: version.seed,
				inputs: version.inputs,
				notes: version.notes,
				guidance: version.guidance
			});
			if (item.locked) {
				db.update(itemsTable).set({ locked: true }).where(eq(itemsTable.id, copy.id)).run();
			}
		}
		return style.id;
	});
}

export function renameStyle(db: Db, ownerId: number, styleId: number, name: string): void {
	ownedStyle(db, ownerId, styleId);
	if (!name.trim()) throw new StyleError('Give the style a name.');
	db.update(styles).set({ name: name.trim() }).where(eq(styles.id, styleId)).run();
}

export function deleteStyle(db: Db, ownerId: number, styleId: number): void {
	ownedStyle(db, ownerId, styleId);
	deleteScope(db, styleScope(styleId));
	db.delete(styles).where(eq(styles.id, styleId)).run();
}

/** Change the color mode or image model. They are settings, not versioned. */
export function saveSettings(
	db: Db,
	ownerId: number,
	styleId: number,
	settings: { colorMode: ColorMode; model: ImageModelId }
): void {
	ownedStyle(db, ownerId, styleId);
	db.update(styles).set(settings).where(eq(styles.id, styleId)).run();
}

export type TextKind = 'description' | 'avoid' | 'prompt' | 'scene';

export function isTextKind(value: string): value is TextKind {
	return ['description', 'avoid', 'prompt', 'scene'].includes(value);
}

/** Save the user's own wording of a piece of text as a new version, if it changed. */
export function saveText(
	db: Db,
	ownerId: number,
	styleId: number,
	kind: TextKind,
	key: string,
	text: string
): void {
	const style = ownedStyle(db, ownerId, styleId);
	if (kind === 'scene' && !isSubject(key)) throw new StyleError('Unknown scene.');
	const slot = { kind, key: kind === 'scene' ? key : '' };
	const value = text.trim();
	if (!value && kind !== 'avoid') throw new StyleError('It cannot be empty.');
	const state = stateOf(db, style);
	if (value === (state.current.get(slotKey(slot))?.text ?? '')) return;
	run(() =>
		addVersion(db, ensureItem(db, ownerId, styleScope(styleId), slot.kind, slot.key), {
			origin: 'user',
			text: value,
			inputs: inputsFor(state, slot) ?? {}
		})
	);
	if (kind === 'description') requestQuestions(db, ownerId, styleId);
}

/** Ask the AI whether the description leaves out anything that would change the pictures. */
export function requestQuestions(db: Db, ownerId: number, styleId: number): void {
	ownedStyle(db, ownerId, styleId);
	const item = ensureItem(db, ownerId, styleScope(styleId), 'questions');
	if (item.locked) return;
	const version = startVersion(db, item);
	const job = enqueue(db, ownerId, 'style.questions', { styleId, versionId: version.id });
	attachJob(db, [version.id], job.id);
}

/**
 * Have the AI fold the user's answers into a new version of the description.
 * Unanswered questions are dropped.
 */
export function answerQuestions(db: Db, ownerId: number, styleId: number, answers: string[]): void {
	const style = ownedStyle(db, ownerId, styleId);
	const state = stateOf(db, style);
	const asked = parseQuestions(state.current.get('questions')?.text ?? '[]');
	const answered = asked
		.map((q, i) => ({ question: q.question, answer: answers[i]?.trim() ?? '' }))
		.filter((qa) => qa.answer);
	if (!answered.length) throw new StyleError('Answer at least one question, or skip them.');
	const item = ensureItem(db, ownerId, styleScope(styleId), 'description');
	const version = run(() =>
		startVersion(db, item, {
			guidance: answered.map((qa) => `${qa.question} ${qa.answer}`).join('\n')
		})
	);
	const job = enqueue(db, ownerId, 'style.fold', { styleId, versionId: version.id });
	attachJob(db, [version.id], job.id);
}

/** Put the questions away without answering them. */
export function skipQuestions(db: Db, ownerId: number, styleId: number): void {
	const style = ownedStyle(db, ownerId, styleId);
	const state = stateOf(db, style);
	const item = ensureItem(db, ownerId, styleScope(styleId), 'questions');
	run(() => addVersion(db, item, { origin: 'user', text: '[]', inputs: questionInputs(state) }));
}

/** Turn a VersionError into a StyleError the page shows. */
function run<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		if (e instanceof VersionError) throw new StyleError(e.message);
		throw e;
	}
}

/** Ask the AI for a new version of the style prompt, guided by the user's feedback. */
export function requestPrompt(db: Db, ownerId: number, styleId: number, guidance = ''): void {
	ownedStyle(db, ownerId, styleId);
	const item = ensureItem(db, ownerId, styleScope(styleId), 'prompt');
	const version = run(() => startVersion(db, item, { guidance }));
	const job = enqueue(db, ownerId, 'style.prompt', { styleId, versionId: version.id });
	attachJob(db, [version.id], job.id);
}

/**
 * Which items of a stage to regenerate: the unlocked ones that are missing
 * or out of date, every unlocked one, or one in particular.
 */
export type Which = 'outdated' | 'all' | SubjectKey;

function chooseSubjects(
	db: Db,
	ownerId: number,
	state: StyleState,
	kind: 'scene' | 'picture',
	which: Which
) {
	const scope = styleScope(state.style.id);
	const chosen = SAMPLE_SUBJECTS.filter(
		(s) => which === 'all' || which === 'outdated' || which === s.key
	)
		.map((s) => ({ subject: s, item: ensureItem(db, ownerId, scope, kind, s.key) }))
		.filter(({ item }) => {
			if (which !== 'all' && which !== 'outdated') return true; // locked: startVersion refuses
			return !item.locked && (which === 'all' || isOutOfDate(state, item));
		});
	return chosen;
}

/** Ask the AI for new sample scenes; returns how many it will write. */
export function requestScenes(
	db: Db,
	ownerId: number,
	styleId: number,
	which: Which,
	guidance = ''
): number {
	const style = ownedStyle(db, ownerId, styleId);
	const chosen = chooseSubjects(db, ownerId, stateOf(db, style), 'scene', which);
	if (!chosen.length) return 0;
	const started = run(() =>
		chosen.map(
			({ subject, item }) => [subject.key, startVersion(db, item, { guidance }).id] as const
		)
	);
	const job = enqueue(db, ownerId, 'style.scenes', {
		styleId,
		versionIds: Object.fromEntries(started)
	});
	attachJob(
		db,
		started.map(([, id]) => id),
		job.id
	);
	return started.length;
}

/**
 * Draw new sample pictures; returns how many. Each keeps the seed (and the
 * guidance) of its current version unless given new ones, so a redraw shows
 * what the changed prompt or scene did. A missing prompt or scene is
 * written first.
 */
export function requestPictures(
	db: Db,
	ownerId: number,
	styleId: number,
	which: Which,
	opts: { seed?: number; guidance?: string } = {}
): number {
	const style = ownedStyle(db, ownerId, styleId);
	let state = stateOf(db, style);
	const chosen = chooseSubjects(db, ownerId, state, 'picture', which);
	if (!chosen.length) return 0;
	const scope = styleScope(styleId);
	const waiting = (kind: string, key = '') => {
		const item = ensureItem(db, ownerId, scope, kind, key);
		return item.locked || describeScope(db, scope, () => null, {}).get(slotKey(item))?.pending;
	};
	if (!state.prompt && !waiting('prompt')) requestPrompt(db, ownerId, styleId);
	const unwritten = chosen
		.map(({ subject }) => subject.key)
		.filter((key) => !state.scenes[key] && !waiting('scene', key));
	for (const key of unwritten) requestScenes(db, ownerId, styleId, key as SubjectKey);
	state = stateOf(db, style);
	const single = which !== 'all' && which !== 'outdated';
	return run(
		() =>
			chosen.map(({ subject, item }) => {
				const current = state.current.get(`picture:${subject.key}`);
				const version = startVersion(db, item, {
					seed: (single ? opts.seed : undefined) ?? current?.seed ?? randomSeed(),
					guidance: single ? (opts.guidance ?? '') : (current?.guidance ?? '')
				});
				const job = enqueue(db, ownerId, 'style.picture', { styleId, versionId: version.id });
				attachJob(db, [version.id], job.id);
				return version;
			}).length
	);
}

// ---------------------------------------------------------------------------
// Jobs

const NO_NEGATION = `Never write "no", "not", "without" or "avoid". The image model ignores negative prompts and reads negation as a request: "no power lines" draws power lines. To keep something out, describe what is there instead: "a dirt road under an open sky, lined with wooden houses" rather than "no asphalt, no power lines". The user may list things to keep out of every image; honor them this way, by naming period-appropriate things to show in their place.`;

const PROMPT_SYSTEM = `You are an experienced manga art director helping someone who may be new to comics define a drawing style for an AI image model.

You write the style prompt: a fragment that will be combined with many different subjects (characters, places, action scenes), so it describes ONLY how things are drawn: medium, line work, inking, shading, tones and textures, level of detail, proportions, rendering, genre conventions and mood. Never describe a particular subject, character, setting or action. Write 25 to 70 words as comma-separated phrases or short sentences. Stay consistent with the color mode, which is added to the prompt separately.

${NO_NEGATION}

Reply with only a JSON object with these keys:
- "prompt": the style fragment.
- "notes": two to four plain-language sentences to the user explaining what you wrote or changed and why, and what to look for in the sample pictures.`;

const promptReply = z.object({ prompt: z.string().min(1), notes: z.string().default('') });

export function promptMessages(state: StyleState, guidance: string) {
	const lines = [
		`Description of the look the user wants: ${state.description}`,
		`Color mode: ${COLOR_MODES[state.style.colorMode].label}`
	];
	if (state.avoid) lines.push(`Keep out of every image: ${state.avoid}`);
	if (state.prompt) lines.push(`Current style prompt: ${state.prompt}`);
	lines.push(
		guidance
			? `The user's feedback: ${guidance}`
			: state.prompt
				? 'Improve the current prompt so it matches the description more closely.'
				: 'Write the first version of the style prompt.'
	);
	return [
		{ role: 'system' as const, content: PROMPT_SYSTEM },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

const SCENES_SYSTEM = `You are an experienced manga art director. You write the sample scenes used to test a drawing style for an AI image model.

Each scene is one sentence of 12 to 35 words describing what the picture shows, and each must fit the setting, era, place and genre the user's description implies: clothing, architecture, objects and technology must all belong to that world. For a story set in historical Japan, for example, show kimono and wooden buildings, never school uniforms, power lines or cars. The kinds of scene are:
${SAMPLE_SUBJECTS.map((s) => `- "${s.key}": ${s.role}`).join('\n')}
The "interior" and "exterior" scenes must start with "An empty" or "The empty"; "No people." is added to them automatically.

Unless the color mode is full color, describe light, shadow and tones (dark, pale, misty, sunlit) and never hues: a single word like "green" or "blue" makes the image model paint the picture in color.

${NO_NEGATION}

Reply with only a JSON object with the key "scenes": an object whose keys are the scenes asked for, each a scene sentence.`;

const scenesReply = z.object({ scenes: z.record(z.string(), z.string()) });

export function sceneMessages(state: StyleState, requests: { key: string; guidance: string }[]) {
	const asked = new Set(requests.map((r) => r.key));
	const lines = [
		`Description of the look and setting the user wants: ${state.description}`,
		`Color mode: ${COLOR_MODES[state.style.colorMode].label}`
	];
	if (state.avoid) lines.push(`Keep out of every image: ${state.avoid}`);
	const others = SAMPLE_SUBJECTS.filter((s) => !asked.has(s.key) && state.scenes[s.key]);
	if (others.length) {
		lines.push(
			'The other scenes, which stay as they are (vary from them):',
			...others.map((s) => `- ${s.key}: ${state.scenes[s.key]}`)
		);
	}
	lines.push('Write these scenes:');
	for (const { key, guidance } of requests) {
		const current = state.scenes[key];
		const parts = [`- "${key}"`];
		if (current) parts.push(`(currently: ${current})`);
		if (guidance) parts.push(`— the user asks: ${guidance}`);
		lines.push(parts.join(' '));
	}
	return [
		{ role: 'system' as const, content: SCENES_SYSTEM },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

/** The style a job works on, and its pending version, if both are still there. */
function jobTarget(db: Db, styleId: number, versionId: number) {
	const style = db.select().from(styles).where(eq(styles.id, styleId)).get();
	if (!style) return undefined;
	const pending = db
		.select({ version: versionsTable, item: itemsTable })
		.from(versionsTable)
		.innerJoin(itemsTable, eq(versionsTable.itemId, itemsTable.id))
		.where(eq(versionsTable.id, versionId))
		.get();
	if (pending?.version.status !== 'pending') return undefined;
	return { style, ...pending };
}

const promptHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { styleId, versionId } = job.payload as { styleId: number; versionId: number };
	const target = jobTarget(db, styleId, versionId);
	if (!target) return; // deleted or superseded meanwhile
	const state = stateOf(db, target.style);
	const reply = await ai.text.json(
		promptMessages(state, target.version.guidance),
		promptReply,
		signal
	);
	finishVersion(db, versionId, {
		text: positiveOnly(reply.prompt.trim()),
		notes: reply.notes.trim(),
		inputs: promptInputs(state)
	});
};

const scenesHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { styleId, versionIds } = job.payload as {
		styleId: number;
		versionIds: Record<string, number>;
	};
	const targets = Object.entries(versionIds)
		.map(([key, versionId]) => ({ key, versionId, target: jobTarget(db, styleId, versionId) }))
		.filter((t) => t.target);
	if (!targets.length) return;
	const state = stateOf(db, targets[0].target!.style);
	const reply = await ai.text.json(
		sceneMessages(
			state,
			targets.map((t) => ({ key: t.key, guidance: t.target!.version.guidance }))
		),
		scenesReply,
		signal
	);
	const missing: string[] = [];
	for (const { key, versionId } of targets) {
		const scene = cleanAiScene(key, reply.scenes[key] ?? '');
		if (scene) finishVersion(db, versionId, { text: scene, inputs: sceneInputs(state) });
		else missing.push(key);
	}
	if (missing.length) throw new Error(`The AI did not write the ${missing.join(', ')} scene.`);
};

const pictureHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { styleId, versionId } = job.payload as { styleId: number; versionId: number };
	const target = jobTarget(db, styleId, versionId);
	if (!target) return;
	const state = stateOf(db, target.style);
	const key = target.item.key;
	if (!state.prompt) throw new Error('The style prompt has not been written.');
	if (!state.scenes[key]) throw new Error('The scene has not been written.');
	const seed = target.version.seed ?? randomSeed();
	const prompt = picturePrompt(
		{ colorMode: target.style.colorMode, prompt: state.prompt },
		state.scenes[key]!,
		target.version.guidance
	);
	const result = await ai.image.generate(
		{
			model: target.style.model as ImageModelId,
			prompt,
			seed,
			width: SAMPLE_SIZE,
			height: SAMPLE_SIZE
		},
		signal
	);
	const { hash, thumbHash } = await putImage(db, result.png);
	finishVersion(db, versionId, {
		text: prompt,
		assetHash: hash,
		thumbHash,
		seed,
		inputs: pictureInputs(state, key)
	});
};

const QUESTIONS_SYSTEM = `You are an experienced manga art director helping someone who may be new to comics describe the drawing style they want, before an AI image model draws in it.

Read their description and decide what it leaves out that would change the pictures: the era or period, the place, the kind of story (genre), the mood, the audience, how detailed or sparse the drawing is, the line work and shading, or artists and works it should look like. Ask only about real gaps that matter most for this description, at most four. Do not ask about anything the description already settles, and do not ask for finer detail about what it already covers. A short, vague description needs three or four questions; a detailed one needs one or two, or none.

Each question is short and specific to their description ("Which part of the Edo period: the 1700s or the 1860s?"), with two to four short suggested answers that fit what they wrote.

Reply with only a JSON object with the key "questions": a list of objects with the keys "question" and "suggestions" (a list of strings). The list may be empty.`;

const questionsReply = z.object({ questions: z.array(question).max(6).default([]) });

export function questionMessages(state: StyleState) {
	const lines = [
		`The user's description of the look they want: ${state.description}`,
		`Color mode: ${COLOR_MODES[state.style.colorMode].label}`
	];
	if (state.avoid) lines.push(`Keep out of every image: ${state.avoid}`);
	return [
		{ role: 'system' as const, content: QUESTIONS_SYSTEM },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

const FOLD_SYSTEM = `You are an experienced manga art director. The user described the drawing style they want, and answered some of your questions about it. Rewrite their description so it includes their answers.

Keep everything they wrote and keep their voice; add each answer where it fits. Write plain prose of one to five sentences, with no headings or lists. Do not add anything they did not say.

Reply with only a JSON object with the key "description".`;

const foldReply = z.object({ description: z.string().min(1) });

export function foldMessages(description: string, answers: string) {
	return [
		{ role: 'system' as const, content: FOLD_SYSTEM },
		{
			role: 'user' as const,
			content: `The user's description: ${description}\nYour questions and their answers:\n${answers}`
		}
	];
}

const questionsHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { styleId, versionId } = job.payload as { styleId: number; versionId: number };
	const target = jobTarget(db, styleId, versionId);
	if (!target) return;
	const state = stateOf(db, target.style);
	const reply = await ai.text.json(questionMessages(state), questionsReply, signal);
	const list = reply.questions.slice(0, 4).map((q) => ({
		question: q.question.trim(),
		suggestions: q.suggestions
			.map((s) => s.trim())
			.filter(Boolean)
			.slice(0, 4)
	}));
	finishVersion(db, versionId, { text: JSON.stringify(list), inputs: questionInputs(state) });
};

const foldHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { styleId, versionId } = job.payload as { styleId: number; versionId: number };
	const target = jobTarget(db, styleId, versionId);
	if (!target) return;
	const state = stateOf(db, target.style);
	const reply = await ai.text.json(
		foldMessages(state.description, target.version.guidance),
		foldReply,
		signal
	);
	finishVersion(db, versionId, {
		text: reply.description.trim(),
		notes: 'Your answers, folded into the description.'
	});
	// The questions were about the old description; they are now answered.
	const questions = ensureItem(db, target.item.ownerId, styleScope(styleId), 'questions');
	if (!questions.locked) {
		addVersion(db, questions, {
			origin: 'user',
			text: '[]',
			inputs: questionInputs(stateOf(db, target.style))
		});
	}
};

export const styleJobHandlers: Record<string, JobHandler> = {
	'style.questions': questionsHandler,
	'style.fold': foldHandler,
	'style.prompt': promptHandler,
	'style.scenes': scenesHandler,
	'style.picture': pictureHandler
};
