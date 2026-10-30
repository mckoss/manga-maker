import { and, desc, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db';
import {
	jobs,
	styles,
	styleSamples,
	styleVersions,
	type ColorMode,
	type Job,
	type StyleSample,
	type StyleVersion
} from './db/schema';
import { IMAGE_MODELS, randomSeed, type ImageModelId } from './ai/image';
import { putImage } from './assets';
import { cancelJobs, enqueue, type JobHandler } from './jobs';

export class StyleError extends Error {}

export const COLOR_MODES: Record<ColorMode, { label: string; phrase: string }> = {
	bw: {
		label: 'Black and white with screentones',
		phrase: 'Black and white manga art, black ink with screentone shading, no color.'
	},
	greyscale: {
		label: 'Greyscale',
		phrase: 'Greyscale manga art with ink outlines and soft grey shading, no color.'
	},
	limited: {
		label: 'Limited palette',
		phrase: 'Manga art in a limited palette of black ink plus one or two accent colors.'
	},
	color: { label: 'Full color', phrase: 'Full-color manga art.' }
};

/**
 * Added to the negative prompt for location shots. Genre words in a style
 * ("detective", "realistic human proportions") otherwise put people in them.
 */
const EMPTY_SCENE = 'people, person, human figure';

/**
 * The fixed test subjects every style is rendered with. Covering figures,
 * faces, places and motion shows how a style handles each kind of panel.
 */
export const SAMPLE_SUBJECTS = [
	{
		key: 'figure',
		label: 'Figure',
		prompt:
			'Full-body view of a teenage girl in a school uniform standing in a neutral pose, plain white background.'
	},
	{
		key: 'face',
		label: 'Face',
		prompt: "Close-up of a young man's face, determined expression, wind in his hair."
	},
	{
		key: 'interior',
		label: 'Interior',
		prompt:
			'The empty interior of a small ramen shop at night, counter seats, steam, hanging lanterns. No people.',
		avoid: EMPTY_SCENE
	},
	{
		key: 'exterior',
		label: 'Exterior',
		prompt:
			'An empty, quiet suburban street with power lines and a convenience store at dusk. No people.',
		avoid: EMPTY_SCENE
	},
	{
		key: 'action',
		label: 'Action',
		prompt: 'A boy leaping over a fence mid-air, dynamic speed lines, dramatic low angle.'
	}
] satisfies { key: string; label: string; prompt: string; avoid?: string }[];

export const SAMPLE_SIZE = 1024;

export function isColorMode(value: string): value is ColorMode {
	return value in COLOR_MODES;
}

export function isImageModel(value: string): value is ImageModelId {
	return value in IMAGE_MODELS;
}

/** End a prompt part with a full stop, so the next part starts a new sentence. */
function sentence(text: string): string {
	const t = text.trim();
	return !t || /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The full image prompt for one subject: colour mode, then style, then subject. */
export function compilePrompt(
	version: Pick<StyleVersion, 'colorMode' | 'prompt'>,
	subjectPrompt: string
): string {
	return [COLOR_MODES[version.colorMode].phrase, sentence(version.prompt), subjectPrompt]
		.filter(Boolean)
		.join(' ');
}

/** The negative prompt for one subject: the style's, plus the subject's own. */
export function compileNegative(negativePrompt: string, subjectKey: string): string {
	const subject = SAMPLE_SUBJECTS.find((s) => s.key === subjectKey);
	const avoid = subject && 'avoid' in subject ? subject.avoid : '';
	return [negativePrompt.trim(), avoid].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------------------
// Queries

function ownedStyle(db: Db, ownerId: number, styleId: number) {
	const style = db
		.select()
		.from(styles)
		.where(and(eq(styles.id, styleId), eq(styles.ownerId, ownerId)))
		.get();
	if (!style) throw new StyleError('Style not found.');
	return style;
}

function ownedVersion(db: Db, ownerId: number, versionId: number) {
	const row = db
		.select({ version: styleVersions, ownerId: styles.ownerId })
		.from(styleVersions)
		.innerJoin(styles, eq(styleVersions.styleId, styles.id))
		.where(eq(styleVersions.id, versionId))
		.get();
	if (!row || row.ownerId !== ownerId) throw new StyleError('Style version not found.');
	return row.version;
}

function ownedDraft(db: Db, ownerId: number, versionId: number) {
	const version = ownedVersion(db, ownerId, versionId);
	if (version.status !== 'draft') {
		throw new StyleError('Only a draft can be changed; start a revision first.');
	}
	return version;
}

function samplesFor(db: Db, versionIds: number[]): StyleSample[] {
	if (!versionIds.length) return [];
	return db
		.select()
		.from(styleSamples)
		.where(inArray(styleSamples.versionId, versionIds))
		.orderBy(styleSamples.id)
		.all();
}

/** Jobs for a style that have not finished, newest last. */
function pendingJobs(db: Db, versionIds: number[]): Job[] {
	if (!versionIds.length) return [];
	return db
		.select()
		.from(jobs)
		.where(inArray(jobs.status, ['queued', 'running']))
		.all()
		.filter((job) => versionIds.includes((job.payload as { versionId?: number }).versionId ?? -1));
}

/** The last refine job for a version, to report its failure if it failed. */
function lastRefine(db: Db, versionId: number): Job | undefined {
	return db
		.select()
		.from(jobs)
		.where(eq(jobs.kind, 'style.refine'))
		.orderBy(desc(jobs.id))
		.all()
		.find((job) => (job.payload as { versionId: number }).versionId === versionId);
}

export function listStyles(db: Db, ownerId: number) {
	const rows = db
		.select()
		.from(styles)
		.where(eq(styles.ownerId, ownerId))
		.orderBy(desc(styles.createdAt))
		.all();
	return rows.map((style) => {
		const versions = db
			.select()
			.from(styleVersions)
			.where(eq(styleVersions.styleId, style.id))
			.all();
		const active = versions.find((v) => v.id === style.activeVersionId);
		const draft = versions.find((v) => v.status === 'draft');
		const shown = active ?? draft;
		return {
			...style,
			active,
			hasDraft: Boolean(draft),
			thumbs: shown
				? samplesFor(db, [shown.id])
						.map((s) => s.thumbHash)
						.filter((h): h is string => Boolean(h))
				: []
		};
	});
}

export function getStyle(db: Db, ownerId: number, styleId: number) {
	const style = ownedStyle(db, ownerId, styleId);
	const versions = db
		.select()
		.from(styleVersions)
		.where(eq(styleVersions.styleId, styleId))
		.orderBy(desc(styleVersions.number))
		.all()
		.filter((v) => v.status !== 'discarded');
	const ids = versions.map((v) => v.id);
	const samples = samplesFor(db, ids);
	const pending = pendingJobs(db, ids);
	const pendingIds = new Set(pending.map((j) => j.id));
	const failedSampleJobs = new Map(
		ids.length
			? db
					.select({ id: jobs.id, error: jobs.error })
					.from(jobs)
					.where(and(eq(jobs.kind, 'style.sample'), eq(jobs.status, 'failed')))
					.all()
					.map((j) => [j.id, j.error] as const)
			: []
	);
	const draft = versions.find((v) => v.status === 'draft');
	const refine = draft ? lastRefine(db, draft.id) : undefined;

	return {
		style,
		active: versions.find((v) => v.id === style.activeVersionId),
		draft,
		history: versions.filter((v) => v.status === 'approved' || v.status === 'superseded'),
		samples: samples.map((s) => ({
			...s,
			pending: s.jobId !== null && pendingIds.has(s.jobId),
			error: s.jobId !== null ? (failedSampleJobs.get(s.jobId) ?? null) : null
		})),
		refining: pending.some((j) => j.kind === 'style.refine'),
		refineError: refine?.status === 'failed' ? refine.error : null,
		busy: pending.length > 0
	};
}

/** Whether a draft has a complete sample set made from its current prompt. */
export function readyToApprove(version: StyleVersion, samples: StyleSample[]): boolean {
	const mine = samples.filter((s) => s.versionId === version.id);
	return (
		mine.length === SAMPLE_SUBJECTS.length &&
		SAMPLE_SUBJECTS.every((subject) => {
			const sample = mine.find((s) => s.subject === subject.key);
			return sample?.assetHash && sample.prompt === compilePrompt(version, subject.prompt);
		})
	);
}

// ---------------------------------------------------------------------------
// Commands

export interface StyleInput {
	name: string;
	description: string;
	colorMode: ColorMode;
	model: ImageModelId;
}

/** Create a style with a first draft, and ask the AI to write its prompt. */
export function createStyle(db: Db, ownerId: number, input: StyleInput): number {
	const name = input.name.trim();
	const description = input.description.trim();
	if (!name) throw new StyleError('Give the style a name.');
	if (!description) throw new StyleError('Describe the look you want.');
	const now = new Date();
	const { styleId, versionId } = db.transaction((tx) => {
		const style = tx.insert(styles).values({ ownerId, name, createdAt: now }).returning().get();
		const version = tx
			.insert(styleVersions)
			.values({
				styleId: style.id,
				number: 1,
				status: 'draft',
				description,
				colorMode: input.colorMode,
				prompt: '',
				model: input.model,
				seed: randomSeed(),
				createdAt: now
			})
			.returning()
			.get();
		return { styleId: style.id, versionId: version.id };
	});
	enqueue(db, ownerId, 'style.refine', { versionId, feedback: '' });
	return styleId;
}

export function renameStyle(db: Db, ownerId: number, styleId: number, name: string): void {
	ownedStyle(db, ownerId, styleId);
	if (!name.trim()) throw new StyleError('Give the style a name.');
	db.update(styles).set({ name: name.trim() }).where(eq(styles.id, styleId)).run();
}

export function deleteStyle(db: Db, ownerId: number, styleId: number): void {
	ownedStyle(db, ownerId, styleId);
	const versionIds = db
		.select({ id: styleVersions.id })
		.from(styleVersions)
		.where(eq(styleVersions.styleId, styleId))
		.all()
		.map((v) => v.id);
	cancelJobs(
		db,
		pendingJobs(db, versionIds).map((j) => j.id)
	);
	db.delete(styles).where(eq(styles.id, styleId)).run();
}

export interface DraftInput {
	description: string;
	colorMode: ColorMode;
	prompt: string;
	negativePrompt: string;
	model: ImageModelId;
}

export function updateDraft(db: Db, ownerId: number, versionId: number, input: DraftInput): void {
	ownedDraft(db, ownerId, versionId);
	db.update(styleVersions)
		.set({
			description: input.description.trim(),
			colorMode: input.colorMode,
			prompt: input.prompt.trim(),
			negativePrompt: input.negativePrompt.trim(),
			model: input.model
		})
		.where(eq(styleVersions.id, versionId))
		.run();
}

/** Ask the AI to rewrite the draft's prompt, taking the user's feedback into account. */
export function requestRefine(db: Db, ownerId: number, versionId: number, feedback: string): void {
	ownedDraft(db, ownerId, versionId);
	enqueue(db, ownerId, 'style.refine', { versionId, feedback: feedback.trim() });
}

/** Replace the draft's samples with a fresh set rendered from its current prompt. */
export function requestSamples(
	db: Db,
	ownerId: number,
	versionId: number,
	opts: { newSeed?: boolean } = {}
): void {
	let version = ownedDraft(db, ownerId, versionId);
	if (!version.prompt) throw new StyleError('The draft has no prompt yet.');
	const old = samplesFor(db, [versionId]);
	cancelJobs(
		db,
		old.map((s) => s.jobId).filter((id): id is number => id !== null)
	);
	if (opts.newSeed) {
		version = db
			.update(styleVersions)
			.set({ seed: randomSeed() })
			.where(eq(styleVersions.id, versionId))
			.returning()
			.get();
	}
	db.delete(styleSamples).where(eq(styleSamples.versionId, versionId)).run();
	SAMPLE_SUBJECTS.forEach((subject, i) => {
		const sample = db
			.insert(styleSamples)
			.values({
				versionId,
				subject: subject.key,
				prompt: compilePrompt(version, subject.prompt),
				seed: version.seed + i,
				createdAt: new Date()
			})
			.returning()
			.get();
		const job = enqueue(db, ownerId, 'style.sample', { versionId, sampleId: sample.id });
		db.update(styleSamples).set({ jobId: job.id }).where(eq(styleSamples.id, sample.id)).run();
	});
}

/** Make the draft the style's active version, retiring the previous one. */
export function approveDraft(db: Db, ownerId: number, versionId: number): void {
	const version = ownedDraft(db, ownerId, versionId);
	if (!readyToApprove(version, samplesFor(db, [versionId]))) {
		throw new StyleError(
			'Generate a full set of samples from the current prompt before approving.'
		);
	}
	db.transaction((tx) => {
		tx.update(styleVersions)
			.set({ status: 'superseded' })
			.where(and(eq(styleVersions.styleId, version.styleId), eq(styleVersions.status, 'approved')))
			.run();
		tx.update(styleVersions)
			.set({ status: 'approved', approvedAt: new Date() })
			.where(eq(styleVersions.id, versionId))
			.run();
		tx.update(styles)
			.set({ activeVersionId: versionId })
			.where(eq(styles.id, version.styleId))
			.run();
	});
}

/**
 * Start a new draft from an approved or superseded version (the active one by
 * default). The style keeps using its active version until the draft is approved.
 */
export function startRevision(
	db: Db,
	ownerId: number,
	styleId: number,
	fromVersionId?: number
): number {
	const style = ownedStyle(db, ownerId, styleId);
	const existing = db
		.select()
		.from(styleVersions)
		.where(and(eq(styleVersions.styleId, styleId), eq(styleVersions.status, 'draft')))
		.get();
	if (existing) throw new StyleError('This style already has a draft in progress.');
	const sourceId = fromVersionId ?? style.activeVersionId;
	if (!sourceId) throw new StyleError('There is no approved version to revise.');
	const source = ownedVersion(db, ownerId, sourceId);
	if (source.styleId !== styleId) throw new StyleError('Style version not found.');
	const next =
		(db
			.select({ n: max(styleVersions.number) })
			.from(styleVersions)
			.where(eq(styleVersions.styleId, styleId))
			.get()?.n ?? 0) + 1;
	const draft = db
		.insert(styleVersions)
		.values({
			styleId,
			number: next,
			status: 'draft',
			description: source.description,
			colorMode: source.colorMode,
			prompt: source.prompt,
			negativePrompt: source.negativePrompt,
			model: source.model,
			seed: source.seed,
			notes: '',
			createdAt: new Date()
		})
		.returning()
		.get();
	return draft.id;
}

export function discardDraft(db: Db, ownerId: number, versionId: number): void {
	const version = ownedDraft(db, ownerId, versionId);
	const style = ownedStyle(db, ownerId, version.styleId);
	if (!style.activeVersionId) {
		throw new StyleError('This is the only version; delete the style instead.');
	}
	cancelJobs(
		db,
		pendingJobs(db, [versionId]).map((j) => j.id)
	);
	db.delete(styleVersions).where(eq(styleVersions.id, versionId)).run();
}

// ---------------------------------------------------------------------------
// Jobs

const REFINE_SYSTEM = `You are an experienced manga art director helping someone who may be new to comics define a drawing style for an AI image model.

Write the style as a prompt fragment that will be combined with many different subjects (characters, places, action scenes), so describe ONLY how things are drawn: medium, line work, inking, shading, tones and textures, level of detail, proportions, rendering, genre conventions and mood. Never describe a particular subject, character, setting or action. Write 25 to 70 words as comma-separated phrases or short sentences. Stay consistent with the color mode, which is added to the prompt separately.

Reply with only a JSON object with these keys:
- "prompt": the style fragment.
- "negativePrompt": a short comma-separated list of things the image model should avoid (for example photorealism or unwanted color), or "".
- "notes": two to four plain-language sentences to the user explaining what you wrote or changed and why, and what to look for in the sample images.`;

const refineReply = z.object({
	prompt: z.string().min(1),
	negativePrompt: z.string().default(''),
	notes: z.string().default('')
});

export function refineMessages(version: StyleVersion, feedback: string) {
	const lines = [
		`Description of the look the user wants: ${version.description}`,
		`Color mode: ${COLOR_MODES[version.colorMode].label}`
	];
	if (version.prompt) {
		lines.push(`Current style prompt: ${version.prompt}`);
		if (version.negativePrompt) lines.push(`Current negative prompt: ${version.negativePrompt}`);
	}
	lines.push(
		feedback
			? `The user's feedback on the current samples: ${feedback}`
			: version.prompt
				? 'Improve the current prompt so it matches the description more closely.'
				: 'Write the first version of the style prompt.'
	);
	return [
		{ role: 'system' as const, content: REFINE_SYSTEM },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

const refineHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { versionId, feedback } = job.payload as { versionId: number; feedback: string };
	const version = db.select().from(styleVersions).where(eq(styleVersions.id, versionId)).get();
	if (version?.status !== 'draft') return; // approved or discarded meanwhile
	const reply = await ai.text.json(refineMessages(version, feedback), refineReply, signal);
	db.update(styleVersions)
		.set({
			prompt: reply.prompt.trim(),
			negativePrompt: reply.negativePrompt.trim(),
			notes: reply.notes.trim()
		})
		.where(and(eq(styleVersions.id, versionId), eq(styleVersions.status, 'draft')))
		.run();
};

const sampleHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { sampleId } = job.payload as { sampleId: number };
	const row = db
		.select({ sample: styleSamples, version: styleVersions })
		.from(styleSamples)
		.innerJoin(styleVersions, eq(styleSamples.versionId, styleVersions.id))
		.where(eq(styleSamples.id, sampleId))
		.get();
	if (!row) return; // replaced by a newer sample set
	const { sample, version } = row;
	const model = version.model as ImageModelId;
	const result = await ai.image.generate(
		{
			model,
			prompt: sample.prompt,
			negativePrompt: IMAGE_MODELS[model].negativePrompt
				? compileNegative(version.negativePrompt, sample.subject)
				: undefined,
			seed: sample.seed,
			width: SAMPLE_SIZE,
			height: SAMPLE_SIZE
		},
		signal
	);
	const { hash, thumbHash } = await putImage(db, result.png);
	db.update(styleSamples)
		.set({ assetHash: hash, thumbHash })
		.where(eq(styleSamples.id, sampleId))
		.run();
};

export const styleJobHandlers: Record<string, JobHandler> = {
	'style.refine': refineHandler,
	'style.sample': sampleHandler
};
