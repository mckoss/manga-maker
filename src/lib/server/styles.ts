/**
 * A drawing style: the user's description and keep-out list (and its color
 * mode) → the style prompt → a sample scene per subject → a sample picture
 * per subject, drawn from the prompt and its scene.
 *
 * Everything is a versioned item scoped "style:<id>". The prompt, scenes and
 * pictures run on the pipeline engine (`./pipeline`) as the stages prompt →
 * scenes → pictures. What is style's own:
 *
 * - Nothing ever regenerates by itself: every stage has `cascades: false`,
 *   and the requests below start exactly what they are asked for. A picture
 *   whose prompt or scene is out of date (or being rewritten) shows as
 *   "upstream" ("Earlier step changed") so the user can redraw it by hand.
 * - The user's description and keep-out list are listed as upstream of the
 *   prompt and scenes but made by no stage; they hold back what follows only
 *   while being rewritten (`anchoredOutside`).
 * - Jobs are queued with only the style's id and the version id(s) (stage
 *   `payload: 'ids'`), as they always have been.
 * - The questions → answers → description "clarify" flow runs beside the
 *   engine (see "Clarify").
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db';
import {
	items as itemsTable,
	styles,
	versions as versionsTable,
	type ColorMode,
	type Style
} from './db/schema';
import { randomSeed } from './ai/image';
import { isImageModel } from '#lib/models.js';
import { negativeFor, seriesOfStyle, styleImageModel } from './models';
import { putImage } from './assets';
import { askJson } from './prompts/ask';
import { SAMPLE_SUBJECTS, type SubjectKey } from './samples';
import { enqueue, type JobHandler } from './jobs';
import {
	addVersion,
	attachJob,
	currentVersions,
	deleteScope,
	dropPending,
	ensureItem,
	finishVersion,
	itemsIn,
	startVersion,
	VersionError,
	type Access,
	type ItemView
} from './versions';
import { scopeOf, slot, slotKey, slotKeyOf, type Scope, type SlotRef } from './pipeline/ids';
import { engine } from './pipeline/engine';
import type { PipelineState, Stage, StepOutput, StepRun } from './pipeline/registry';

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

export { SAMPLE_SUBJECTS, type SubjectKey } from './samples';

export const SAMPLE_SIZE = 1024;

/** What each kind of input is called when saying why something is out of date. */
const INPUT_LABELS: Record<string, string> = {
	description: 'the description',
	avoid: 'the keep-out list',
	color: 'the color mode',
	prompt: 'the style prompt',
	scene: 'the scene'
};

export function isColorMode(value: string): value is ColorMode {
	return value in COLOR_MODES;
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

export const styleScope = scopeOf.style;

/** Everything a style's next prompt, scene or picture would be made from. */
interface StyleState extends PipelineState {
	scope: Scope<'style'>;
	style: Style;
	description: string;
	avoid: string;
	prompt: string;
	promptVersionId: number | null;
	scenes: Partial<Record<string, string>>;
}

const descriptionSlot = slot('description');
const avoidSlot = slot('avoid');
const questionsSlot = slot('questions');
const promptSlot = slot('prompt');
const sceneSlot = (key: string) => slot('scene', key);
const pictureSlot = (key: string) => slot('picture', key);

function stateOf(db: Db, style: Style): StyleState {
	const scope = styleScope(style.id);
	const current = currentVersions(db, scope);
	const prompt = current.get(slotKey(promptSlot));
	return {
		id: style.id,
		ownerId: style.ownerId,
		scope,
		style,
		description: current.get(slotKey(descriptionSlot))?.text ?? '',
		avoid: current.get(slotKey(avoidSlot))?.text ?? '',
		prompt: prompt?.text ?? '',
		promptVersionId: prompt?.id ?? null,
		scenes: Object.fromEntries(
			SAMPLE_SUBJECTS.map((s) => [s.key, current.get(slotKeyOf('scene', s.key))?.text ?? ''])
		),
		current
	};
}

function loadState(db: Db, styleId: number): StyleState | undefined {
	const style = db.select().from(styles).where(eq(styles.id, styleId)).get();
	return style ? stateOf(db, style) : undefined;
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
	color: s.style.colorMode
});

const questionInputs = (s: StyleState) => ({ description: s.description });

/** The subjects in their order, for sorting slots. */
const subjectOrder = (ref: SlotRef) => SAMPLE_SUBJECTS.findIndex((s) => s.key === ref.key);

// ---------------------------------------------------------------------------
// Pipeline

const promptStage: Stage<StyleState> = {
	id: 'prompt',
	kind: 'ai-text',
	kinds: ['prompt'],
	slots: () => [promptSlot],
	inputs: promptInputs,
	upstream: () => [descriptionSlot, avoidSlot],
	job: { kind: 'style.prompt', per: 'slot', payload: 'ids', run: (ctx) => promptRun(ctx) },
	cascades: false
};

const scenesStage: Stage<StyleState> = {
	id: 'scenes',
	kind: 'ai-text',
	kinds: ['scene'],
	slots: () => SAMPLE_SUBJECTS.map((s) => sceneSlot(s.key)),
	inputs: sceneInputs,
	upstream: () => [descriptionSlot, avoidSlot],
	job: { kind: 'style.scenes', per: 'stage', payload: 'ids', run: (ctx) => scenesRun(ctx) },
	cascades: false
};

/**
 * Sample pictures. A request for one picture uses the seed, guidance and
 * model it was given (a new seed when none); a request for several redraws
 * each with its current seed and guidance and the style's model.
 */
const picturesStage: Stage<StyleState> = {
	id: 'pictures',
	kind: 'ai-image',
	kinds: ['picture'],
	slots: () => SAMPLE_SUBJECTS.map((s) => pictureSlot(s.key)),
	inputs: (s, ref) => pictureInputs(s, ref.key ?? ''),
	upstream: (_s, ref) => [promptSlot, sceneSlot(ref.key ?? '')],
	prepare: ({ db, state: s, slots, opts }) => {
		const model = styleImageModel(db, s.ownerId, s.id, opts.model);
		return slots.map((ref) => {
			const current = s.current.get(slotKey(ref));
			return {
				seed: opts.seed ?? current?.seed ?? randomSeed(),
				guidance: opts.guidance ?? current?.guidance ?? '',
				model
			};
		});
	},
	job: { kind: 'style.picture', per: 'slot', payload: 'ids', run: (ctx) => pictureRun(ctx) },
	cascades: false
};

const flow = engine<StyleState>({
	domain: 'style',
	load: loadState,
	stages: [promptStage, scenesStage, picturesStage],
	labels: INPUT_LABELS,
	// The questions are made by the clarify flow, beside the engine.
	inputsOutside: (s, ref) => (ref.kind === 'questions' ? questionInputs(s) : null),
	// The description and keep-out list hold back what follows only while
	// the AI folds answers into the description.
	anchoredOutside: (view) => !view?.pending,
	error: (message) => new StyleError(message)
});

/**
 * Missing, or made from inputs that have changed since: what a request for
 * the "outdated" items of a stage picks. Only an item's own inputs count,
 * not whether an earlier step is out of date.
 */
function isOutOfDate(state: StyleState, ref: SlotRef): boolean {
	const version = state.current.get(slotKey(ref));
	if (!version) return true;
	const now = flow.inputsFor(state, ref);
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
	return SAMPLE_SUBJECTS.map(
		(s) => state.current.get(slotKeyOf('picture', s.key))?.thumbHash
	).filter((h): h is string => Boolean(h));
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

/** What the rest of the manga is drawn in: the current prompt and color mode. */
export interface DrawingStyle {
	styleId: number;
	description: string;
	colorMode: ColorMode;
	prompt: string;
	promptVersionId: number | null;
	ready: boolean;
}

export function drawingStyle(db: Db, styleId: number): DrawingStyle | undefined {
	const state = loadState(db, styleId);
	if (!state) return undefined;
	return {
		styleId,
		description: state.description,
		colorMode: state.style.colorMode,
		prompt: state.prompt,
		promptVersionId: state.promptVersionId,
		ready: isReady(state)
	};
}

const emptyView = (ref: SlotRef): ItemView => ({
	id: 0,
	kind: ref.kind,
	key: ref.key ?? '',
	locked: false,
	versions: [],
	currentId: null,
	pending: false,
	error: null
});

/**
 * Everything the style page shows. The prompt, each scene and each picture
 * also carry their status (see `Status`): "upstream" when an earlier step
 * is out of date or being rewritten, so nothing redraws it until asked.
 */
export function getStyle(db: Db, ownerId: number, styleId: number) {
	const style = ownedStyle(db, ownerId, styleId);
	const state = stateOf(db, style);
	const { views, status } = flow.describe(db, state, INPUT_LABELS);
	const view = (ref: SlotRef) => views.get(slotKey(ref)) ?? emptyView(ref);
	const all = [...views.values()];
	const questions = view(questionsSlot);
	return {
		style,
		description: view(descriptionSlot),
		questions: { item: questions, list: openQuestions(questions) },
		avoid: view(avoidSlot),
		promptStatus: status(slotKey(promptSlot)),
		prompt: view(promptSlot),
		scenes: SAMPLE_SUBJECTS.map((s) => ({
			...s,
			status: status(slotKeyOf('scene', s.key)),
			item: view(sceneSlot(s.key))
		})),
		pictures: SAMPLE_SUBJECTS.map((s) => ({
			...s,
			status: status(slotKeyOf('picture', s.key)),
			item: view(pictureSlot(s.key))
		})),
		ready: isReady(state),
		busy: all.some((v) => v.pending)
	};
}

export type StyleDetail = ReturnType<typeof getStyle>;

// ---------------------------------------------------------------------------
// Commands

export interface StyleInput {
	name: string;
	description: string;
	colorMode: ColorMode;
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
			createdAt: new Date()
		})
		.returning()
		.get();
	addVersion(db, ensureItem(db, ownerId, styleScope(style.id), descriptionSlot.kind), {
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
				createdAt: new Date()
			})
			.returning()
			.get();
		for (const item of itemsIn(db, styleScope(source.id))) {
			const version = state.current.get(slotKeyOf(item.kind, item.key));
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
				guidance: version.guidance,
				model: version.model
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

/** Change the color mode. It is a setting, not versioned. */
export function saveSettings(
	db: Db,
	ownerId: number,
	styleId: number,
	settings: { colorMode: ColorMode }
): void {
	ownedStyle(db, ownerId, styleId);
	db.update(styles).set(settings).where(eq(styles.id, styleId)).run();
}

export type TextKind = 'description' | 'avoid' | 'prompt' | 'scene';

export function isTextKind(value: string): value is TextKind {
	return ['description', 'avoid', 'prompt', 'scene'].includes(value);
}

/**
 * Save the user's own wording of a piece of text as a new version, if it
 * changed. What the AI writes (the prompt, a scene) is kept from then on
 * unless `keep` is false, so the user's edit isn't regenerated away.
 */
export function saveText(
	db: Db,
	ownerId: number,
	styleId: number,
	kind: TextKind,
	key: string,
	text: string,
	keep = true
): void {
	const style = ownedStyle(db, ownerId, styleId);
	if (kind === 'scene' && !isSubject(key)) throw new StyleError('Unknown scene.');
	const ref = kind === 'scene' ? sceneSlot(key) : slot(kind);
	const value = text.trim();
	if (!value && kind !== 'avoid') throw new StyleError('It cannot be empty.');
	const state = stateOf(db, style);
	const item = flow.item(db, state, ref);
	const generated = kind === 'prompt' || kind === 'scene';
	if (value === (state.current.get(slotKey(ref))?.text ?? '')) {
		if (generated && item.currentVersionId !== null && item.locked !== keep) {
			db.update(itemsTable).set({ locked: keep }).where(eq(itemsTable.id, item.id)).run();
			if (keep) dropPending(db, [item.id]);
		}
		return;
	}
	addVersion(
		db,
		item,
		{ origin: 'user', text: value, inputs: flow.inputsFor(state, ref) ?? {} },
		generated ? { keep } : {}
	);
	if (kind === 'description') requestQuestions(db, ownerId, styleId);
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
	const state = stateOf(db, ownedStyle(db, ownerId, styleId));
	flow.start(db, state, 'prompt', [promptSlot], { guidance });
}

/**
 * Which items of a stage to regenerate: the unlocked ones that are missing
 * or out of date, every unlocked one, or one in particular.
 */
export type Which = 'outdated' | 'all' | SubjectKey;

/** One picture asked for by name: its own seed, guidance and model apply. */
const single = (which: Which) => which !== 'all' && which !== 'outdated';

/**
 * The slots of a stage a request picks, in subject order: one by name (a
 * locked one is refused when started), or the unlocked ones that are
 * missing or out of date by their own inputs ('outdated'), or all unlocked.
 * Every subject's item is made, picked or not.
 */
function chooseSubjects(
	db: Db,
	state: StyleState,
	kind: 'scene' | 'picture',
	which: Which
): SlotRef[] {
	return SAMPLE_SUBJECTS.filter((s) => !single(which) || which === s.key)
		.map((s) => {
			const ref = slot(kind, s.key);
			return { ref, item: flow.item(db, state, ref) };
		})
		.filter(({ ref, item }) => {
			if (single(which)) return true; // locked: startVersion refuses
			return !item.locked && (which === 'all' || isOutOfDate(state, ref));
		})
		.map(({ ref }) => ref);
}

/** Ask the AI for new sample scenes; returns how many it will write. */
export function requestScenes(
	db: Db,
	ownerId: number,
	styleId: number,
	which: Which,
	guidance = ''
): number {
	const state = stateOf(db, ownedStyle(db, ownerId, styleId));
	const chosen = chooseSubjects(db, state, 'scene', which);
	return flow.start(db, state, 'scenes', chosen, { guidance });
}

/**
 * Draw new sample pictures; returns how many. Each keeps the seed (and the
 * guidance) of its current version unless given new ones, so a redraw shows
 * what the changed prompt or scene did. A missing prompt or scene is
 * written first; the pictures are queued right away, behind it.
 */
export function requestPictures(
	db: Db,
	ownerId: number,
	styleId: number,
	which: Which,
	opts: { seed?: number; guidance?: string; model?: string } = {}
): number {
	const style = ownedStyle(db, ownerId, styleId);
	let state = stateOf(db, style);
	const chosen = chooseSubjects(db, state, 'picture', which);
	if (!chosen.length) return 0;
	const waiting = (ref: SlotRef) =>
		flow.item(db, state, ref).locked || flow.describe(db, state).views.get(slotKey(ref))?.pending;
	if (!state.prompt && !waiting(promptSlot)) requestPrompt(db, ownerId, styleId);
	const unwritten = chosen
		.map((ref) => ref.key as SubjectKey)
		.filter((key) => !state.scenes[key] && !waiting(sceneSlot(key)));
	for (const key of unwritten) requestScenes(db, ownerId, styleId, key);
	state = stateOf(db, style);
	const one = single(which);
	return flow.start(db, state, 'pictures', chosen, {
		seed: one ? opts.seed : undefined,
		guidance: one ? (opts.guidance ?? '') : undefined,
		model: one ? opts.model : undefined
	});
}

// ---------------------------------------------------------------------------
// Clarify
//
// When the user describes the style, the art director can ask what the
// description leaves out: `requestQuestions` makes a "questions" item (job
// `style.questions`) from the description, unless that item is kept;
// `answerQuestions` starts a new version of the description with the
// answers as its guidance, which the AI folds in (job `style.fold`), and
// then puts the questions away with an empty user version ("[]"), unless
// kept; `skipQuestions` puts them away unanswered. Questions about a
// description that has changed since are out of date and not shown.
//
// This runs beside the engine, not as a stage: nothing is made from the
// questions, and the fold writes the user's own description. Plots have the
// same flow on their notes, but it differs in ways a shared version would
// change: plots refuse a kept questions item where styles skip it quietly,
// plots refuse to ask without an idea, and the jobs read their own domain's
// context. So each domain keeps its own.

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

/** Ask the AI whether the description leaves out anything that would change the pictures. */
export function requestQuestions(db: Db, ownerId: number, styleId: number): void {
	ownedStyle(db, ownerId, styleId);
	const item = ensureItem(db, ownerId, styleScope(styleId), questionsSlot.kind);
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
	const asked = parseQuestions(state.current.get(slotKey(questionsSlot))?.text ?? '[]');
	const answered = asked
		.map((q, i) => ({ question: q.question, answer: answers[i]?.trim() ?? '' }))
		.filter((qa) => qa.answer);
	if (!answered.length) throw new StyleError('Answer at least one question, or skip them.');
	const item = ensureItem(db, ownerId, styleScope(styleId), descriptionSlot.kind);
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
	const item = ensureItem(db, ownerId, styleScope(styleId), questionsSlot.kind);
	run(() => addVersion(db, item, { origin: 'user', text: '[]', inputs: questionInputs(state) }));
}

// ---------------------------------------------------------------------------
// What the AI is asked (its system prompts are in prompts/style.ts)

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
	return [{ role: 'user' as const, content: lines.join('\n') }];
}

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
	return [{ role: 'user' as const, content: lines.join('\n') }];
}

const questionsReply = z.object({ questions: z.array(question).max(6).default([]) });

export function questionMessages(state: StyleState) {
	const lines = [
		`The user's description of the look they want: ${state.description}`,
		`Color mode: ${COLOR_MODES[state.style.colorMode].label}`
	];
	if (state.avoid) lines.push(`Keep out of every image: ${state.avoid}`);
	return [{ role: 'user' as const, content: lines.join('\n') }];
}

const foldReply = z.object({ description: z.string().min(1) });

export function foldMessages(description: string, answers: string) {
	return [
		{
			role: 'user' as const,
			content: `The user's description: ${description}\nYour questions and their answers:\n${answers}`
		}
	];
}

// ---------------------------------------------------------------------------
// Jobs

const promptRun: StepRun<StyleState> = async ({ ai, signal, state, slots: [{ ref, version }] }) => {
	const { value: reply, prompt } = await askJson(
		ai,
		'style.prompt',
		promptMessages(state, version!.guidance),
		promptReply,
		signal
	);
	return new Map([
		[
			slotKey(ref),
			{
				text: positiveOnly(reply.prompt.trim()),
				notes: reply.notes.trim(),
				model: ai.text.name,
				...prompt
			}
		]
	]);
};

/**
 * The scenes asked for that are still pending, in subject order, each with
 * its own guidance. If the AI leaves one out, the ones it wrote are kept,
 * the rest stay pending and the job fails, saying which: an escape hatch
 * from the engine, which finishes a job's versions only when it succeeds.
 */
const scenesRun: StepRun<StyleState> = async ({ db, ai, signal, state, slots }) => {
	const targets = slots
		.filter((x) => x.version?.status === 'pending')
		.sort((a, b) => subjectOrder(a.ref) - subjectOrder(b.ref));
	if (!targets.length) return null;
	const { value: reply, prompt } = await askJson(
		ai,
		'style.scenes',
		sceneMessages(
			state,
			targets.map((t) => ({ key: t.ref.key ?? '', guidance: t.version!.guidance }))
		),
		scenesReply,
		signal
	);
	const made = new Map<string, StepOutput>();
	const missing: string[] = [];
	for (const { ref } of targets) {
		const scene = cleanAiScene(ref.key ?? '', reply.scenes[ref.key ?? ''] ?? '');
		if (scene) made.set(slotKey(ref), { text: scene, model: ai.text.name, ...prompt });
		else missing.push(ref.key ?? '');
	}
	if (!missing.length) return made;
	for (const { ref, version } of targets) {
		const content = made.get(slotKey(ref));
		if (content) finishVersion(db, version!.id, { ...content, inputs: sceneInputs(state) });
	}
	throw new Error(`The AI did not write the ${missing.join(', ')} scene.`);
};

const pictureRun: StepRun<StyleState> = async ({
	db,
	ai,
	signal,
	state,
	slots: [{ ref, version }]
}) => {
	const key = ref.key ?? '';
	if (!state.prompt) throw new Error('The style prompt has not been written.');
	if (!state.scenes[key]) throw new Error('The scene has not been written.');
	const seed = version!.seed ?? randomSeed();
	const prompt = picturePrompt(
		{ colorMode: state.style.colorMode, prompt: state.prompt },
		state.scenes[key]!,
		version!.guidance
	);
	const model = isImageModel(version!.model)
		? version!.model
		: styleImageModel(db, state.ownerId, state.id);
	const result = await ai.image.generate(
		{
			model,
			prompt,
			negative: negativeFor(model, seriesOfStyle(db, state.id)),
			seed,
			width: SAMPLE_SIZE,
			height: SAMPLE_SIZE
		},
		signal
	);
	const { hash, thumbHash } = await putImage(db, result.png);
	return new Map([
		[slotKey(ref), { text: prompt, assetHash: hash, thumbHash, seed, model: result.model }]
	]);
};

// The clarify flow's jobs (see "Clarify").

/** The style a clarify job works on, and its pending version, if both are still there. */
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

const questionsHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { styleId, versionId } = job.payload as { styleId: number; versionId: number };
	const target = jobTarget(db, styleId, versionId);
	if (!target) return;
	const state = stateOf(db, target.style);
	const { value: reply, prompt } = await askJson(
		ai,
		'style.questions',
		questionMessages(state),
		questionsReply,
		signal
	);
	const list = reply.questions.slice(0, 4).map((q) => ({
		question: q.question.trim(),
		suggestions: q.suggestions
			.map((s) => s.trim())
			.filter(Boolean)
			.slice(0, 4)
	}));
	finishVersion(db, versionId, {
		text: JSON.stringify(list),
		inputs: questionInputs(state),
		model: ai.text.name,
		...prompt
	});
};

const foldHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { styleId, versionId } = job.payload as { styleId: number; versionId: number };
	const target = jobTarget(db, styleId, versionId);
	if (!target) return;
	const state = stateOf(db, target.style);
	const { value: reply, prompt } = await askJson(
		ai,
		'style.fold',
		foldMessages(state.description, target.version.guidance),
		foldReply,
		signal
	);
	finishVersion(db, versionId, {
		text: reply.description.trim(),
		notes: 'Your answers, folded into the description.',
		model: ai.text.name,
		...prompt
	});
	// The questions were about the old description; they are now answered.
	const questions = ensureItem(db, target.item.ownerId, styleScope(styleId), questionsSlot.kind);
	if (!questions.locked) {
		addVersion(db, questions, {
			origin: 'user',
			text: '[]',
			inputs: questionInputs(stateOf(db, target.style))
		});
	}
};

export const styleJobHandlers: Record<string, JobHandler> = {
	...flow.handlers(),
	'style.questions': questionsHandler,
	'style.fold': foldHandler
};
