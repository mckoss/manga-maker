import { and, eq, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db';
import {
	chapterCast,
	chapters,
	characterImages,
	characters,
	jobs,
	series,
	type Character,
	type CharacterImage,
	type ColorMode,
	type Job,
	type Series
} from './db/schema';
import { randomSeed } from './ai/image';
import { putImage, readAsset } from './assets';
import { cancelJobs, enqueue, type JobHandler } from './jobs';
import { ownedSeries, touchSeries } from './series';
import {
	COLOR_MODES,
	compilePrompt,
	drawingStyle,
	positiveOnly,
	sentence,
	TONE_REMINDER,
	toneOnly,
	type DrawingStyle
} from './styles';

export class CharacterError extends Error {}

export const ROLES = {
	protagonist: 'Protagonist',
	antagonist: 'Antagonist',
	supporting: 'Supporting',
	minor: 'Minor'
} as const;

export type Role = keyof typeof ROLES;

export function isRole(value: string): value is Role {
	return value in ROLES;
}

/** How many design options each round of candidates offers. */
export const CANDIDATE_COUNT = 4;
/** Tall portrait (about 9:16, one megapixel): a full figure, hat to feet, fits. */
export const CANDIDATE_SIZE = { width: 768, height: 1344 };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const uncapitalize = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The full image prompt for a full-body design picture of a character. The
 * framing is stated before and after the description, as a wide shot: a
 * detailed face description otherwise makes Qwen-Image frame a medium shot
 * and crop at the thighs.
 */
export function characterPrompt(
	style: Pick<DrawingStyle, 'colorMode' | 'prompt'>,
	character: Pick<Character, 'age' | 'appearance' | 'outfit'>
): string {
	const subject = [
		'Wide shot, full-body character design sheet: one character standing in a relaxed neutral pose, facing the viewer, small in the frame with empty space above the head and below the feet.',
		sentence(capitalize(character.age.trim())),
		sentence(character.appearance),
		character.outfit.trim() ? sentence(`Wearing ${uncapitalize(character.outfit.trim())}`) : '',
		'The whole figure is shown from head to feet, with both feet on the ground, against a plain white background.',
		TONE_REMINDER[style.colorMode]
	]
		.filter(Boolean)
		.join(' ');
	return compilePrompt(style, subject);
}

const KEEP = 'Keep the same character, face, hair, outfit, drawing style, line work and shading.';
const BODY = 'Full body from head to feet, plain white background.';
const FACE = 'Close-up of the face and shoulders, plain white background.';

/**
 * The character sheet: views and expressions redrawn from the reference
 * picture with the edit model, so later panels can draw the character from
 * any angle and in any mood.
 */
export const SHEET_VIEWS = [
	{
		key: 'three-quarter',
		label: 'Three-quarter',
		instruction: `Show this character turned three-quarters to the left. ${BODY}`
	},
	{
		key: 'side',
		label: 'Side',
		instruction: `Show this character from the side, in profile, facing left. ${BODY}`
	},
	{ key: 'back', label: 'Back', instruction: `Show this character from behind. ${BODY}` },
	{ key: 'neutral', label: 'Neutral', instruction: `${FACE} Calm, neutral expression.` },
	{ key: 'happy', label: 'Happy', instruction: `${FACE} Laughing happily.` },
	{ key: 'angry', label: 'Angry', instruction: `${FACE} Furious, shouting.` },
	{ key: 'sad', label: 'Sad', instruction: `${FACE} Sad, on the verge of tears.` },
	{ key: 'surprised', label: 'Surprised', instruction: `${FACE} Shocked and surprised, eyes wide.` }
] as const;

export type SheetView = (typeof SHEET_VIEWS)[number]['key'];

export function isSheetView(value: string): value is SheetView {
	return SHEET_VIEWS.some((v) => v.key === value);
}

/**
 * The edit instruction for one sheet view, in the series' color mode, with
 * the user's guidance for that one redraw ("looking over her shoulder").
 */
export function sheetPrompt(colorMode: ColorMode, view: SheetView, guidance = ''): string {
	const { instruction } = SHEET_VIEWS.find((v) => v.key === view)!;
	return toneOnly(
		colorMode,
		[instruction, sentence(guidance), KEEP, TONE_REMINDER[colorMode]].filter(Boolean).join(' ')
	);
}

// ---------------------------------------------------------------------------
// Queries

function ownedCharacter(db: Db, ownerId: number, characterId: number) {
	const row = db
		.select({ character: characters, series })
		.from(characters)
		.innerJoin(series, eq(characters.seriesId, series.id))
		.where(eq(characters.id, characterId))
		.get();
	if (!row || row.series.ownerId !== ownerId) throw new CharacterError('Character not found.');
	return row;
}

/**
 * The series' style, which every character picture is drawn in, once it is
 * ready (it has a prompt and a sample picture).
 */
export function readyStyle(db: Db, owner: Pick<Series, 'styleId'>): DrawingStyle | undefined {
	const style = owner.styleId ? drawingStyle(db, owner.styleId) : undefined;
	return style?.ready ? style : undefined;
}

/** The style that tells the AI about the series' setting, ready or not. */
function styleForContext(db: Db, owner: Pick<Series, 'styleId'>): DrawingStyle | undefined {
	return owner.styleId ? drawingStyle(db, owner.styleId) : undefined;
}

const NO_STYLE = 'Draw at least one sample picture of the series’ style before drawing characters.';

/** Unfinished jobs for the given characters. */
function pendingJobs(db: Db, characterIds: number[]): Job[] {
	if (!characterIds.length) return [];
	return db
		.select()
		.from(jobs)
		.where(inArray(jobs.status, ['queued', 'running']))
		.all()
		.filter((job) =>
			characterIds.includes((job.payload as { characterId?: number }).characterId ?? -1)
		);
}

function imagesOf(db: Db, characterId: number): CharacterImage[] {
	return db
		.select()
		.from(characterImages)
		.where(eq(characterImages.characterId, characterId))
		.orderBy(characterImages.id)
		.all();
}

export function listCharacters(db: Db, ownerId: number, seriesId: number) {
	ownedSeries(db, ownerId, seriesId);
	const cast = db
		.select()
		.from(characters)
		.where(eq(characters.seriesId, seriesId))
		.orderBy(characters.id)
		.all();
	const refs = new Map(
		db
			.select()
			.from(characterImages)
			.where(
				inArray(
					characterImages.id,
					cast.map((c) => c.referenceImageId).filter((id): id is number => id !== null)
				)
			)
			.all()
			.map((img) => [img.id, img])
	);
	return cast.map((c) => ({
		...c,
		thumb: (c.referenceImageId && refs.get(c.referenceImageId)?.thumbHash) || null
	}));
}

export function getCharacter(db: Db, ownerId: number, characterId: number) {
	const { character, series } = ownedCharacter(db, ownerId, characterId);
	const style = readyStyle(db, series);
	const pending = pendingJobs(db, [characterId]);
	const pendingIds = new Set(pending.map((j) => j.id));
	const images = imagesOf(db, characterId);
	const jobIds = images.map((i) => i.jobId).filter((id): id is number => id !== null);
	const failed = new Map(
		jobIds.length
			? db
					.select({ id: jobs.id, error: jobs.error })
					.from(jobs)
					.where(and(inArray(jobs.id, jobIds), eq(jobs.status, 'failed')))
					.all()
					.map((j) => [j.id, j.error] as const)
			: []
	);
	const current = style ? characterPrompt(style, character) : null;
	const develop = db
		.select()
		.from(jobs)
		.where(eq(jobs.kind, 'character.develop'))
		.all()
		.filter((j) => (j.payload as { characterId: number }).characterId === characterId)
		.at(-1);
	const decorated = images.map((img) => ({
		...img,
		pending: img.jobId !== null && pendingIds.has(img.jobId),
		error: img.jobId !== null ? (failed.get(img.jobId) ?? null) : null,
		/** Drawn from an older description than the current one. */
		stale: current !== null && img.prompt !== current,
		/** Drawn from a style prompt other than the current one. */
		oldStyle: style !== undefined && img.stylePromptVersionId !== style.promptVersionId
	}));
	const sheet = SHEET_VIEWS.map((view) => {
		const image = decorated.findLast((img) => img.kind === 'sheet' && img.view === view.key);
		return {
			view: view.key,
			label: view.label,
			image: image
				? {
						...image,
						/** Redrawn from a reference that is no longer the chosen one. */
						outdated: image.sourceImageId !== character.referenceImageId
					}
				: null
		};
	});
	return {
		character,
		series,
		style: style ?? null,
		reference: decorated.find((img) => img.id === character.referenceImageId) ?? null,
		candidates: decorated.filter((img) => img.kind === 'candidate'),
		sheet,
		developing: pending.some((j) => j.kind === 'character.develop'),
		developError: develop?.status === 'failed' ? develop.error : null,
		busy: pending.length > 0
	};
}

// ---------------------------------------------------------------------------
// Commands

export interface NewCharacter {
	name: string;
	role: Role;
	brief: string;
}

/**
 * Add a character to a series and ask the AI to develop a profile from the
 * brief. Made while working on a chapter, it joins that chapter's cast too.
 */
export function createCharacter(
	db: Db,
	ownerId: number,
	seriesId: number,
	input: NewCharacter,
	chapterId?: number
): number {
	ownedSeries(db, ownerId, seriesId);
	if (chapterId !== undefined) {
		const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).get();
		if (chapter?.seriesId !== seriesId) throw new CharacterError('Chapter not found.');
	}
	const name = input.name.trim();
	const brief = input.brief.trim();
	if (!name && !brief) throw new CharacterError('Give the character a name or a description.');
	const now = new Date();
	const character = db
		.insert(characters)
		.values({
			seriesId,
			name,
			role: input.role,
			brief,
			seed: randomSeed(),
			createdAt: now,
			updatedAt: now
		})
		.returning()
		.get();
	if (chapterId !== undefined) {
		db.insert(chapterCast).values({ chapterId, characterId: character.id, createdAt: now }).run();
	}
	touchSeries(db, seriesId);
	enqueue(db, ownerId, 'character.develop', { characterId: character.id, feedback: '' });
	return character.id;
}

export const PROFILE_FIELDS = [
	'name',
	'role',
	'brief',
	'personality',
	'motivation',
	'backstory',
	'speech',
	'age',
	'appearance',
	'outfit'
] as const;

export type Profile = Record<(typeof PROFILE_FIELDS)[number], string>;

export function updateCharacter(
	db: Db,
	ownerId: number,
	characterId: number,
	profile: Profile
): void {
	const { character } = ownedCharacter(db, ownerId, characterId);
	if (!isRole(profile.role)) throw new CharacterError('Choose a role.');
	const values = Object.fromEntries(PROFILE_FIELDS.map((k) => [k, profile[k].trim()])) as Profile;
	if (!values.name) throw new CharacterError('Give the character a name.');
	db.update(characters)
		.set({ ...values, updatedAt: new Date() })
		.where(eq(characters.id, characterId))
		.run();
	touchSeries(db, character.seriesId);
}

/** Ask the AI to revise the profile, taking the user's feedback into account. */
export function requestDevelop(
	db: Db,
	ownerId: number,
	characterId: number,
	feedback: string
): void {
	ownedCharacter(db, ownerId, characterId);
	enqueue(db, ownerId, 'character.develop', { characterId, feedback: feedback.trim() });
}

/**
 * Draw a fresh set of design candidates in the series' style. The
 * chosen reference is kept; other candidates are replaced.
 */
export function requestCandidates(
	db: Db,
	ownerId: number,
	characterId: number,
	opts: { newSeed?: boolean } = {}
): void {
	const owned = ownedCharacter(db, ownerId, characterId);
	let character = owned.character;
	const style = readyStyle(db, owned.series);
	if (!style) throw new CharacterError(NO_STYLE);
	if (!character.appearance) throw new CharacterError('Describe how the character looks first.');
	cancelJobs(
		db,
		pendingJobs(db, [characterId])
			.filter((j) => j.kind === 'character.candidate')
			.map((j) => j.id)
	);
	if (opts.newSeed) {
		character = db
			.update(characters)
			.set({ seed: randomSeed() })
			.where(eq(characters.id, characterId))
			.returning()
			.get();
	}
	// Keep the reference, and any design a chapter is pinned to.
	const keep = [
		character.referenceImageId ?? -1,
		...db
			.select({ id: chapterCast.pinnedImageId })
			.from(chapterCast)
			.where(and(eq(chapterCast.characterId, characterId), isNotNull(chapterCast.pinnedImageId)))
			.all()
			.map((r) => r.id!)
	];
	db.delete(characterImages)
		.where(
			and(
				eq(characterImages.characterId, characterId),
				eq(characterImages.kind, 'candidate'),
				notInArray(characterImages.id, keep)
			)
		)
		.run();
	const prompt = characterPrompt(style, character);
	for (let i = 0; i < CANDIDATE_COUNT; i++) {
		const image = db
			.insert(characterImages)
			.values({
				characterId,
				kind: 'candidate',
				prompt,
				seed: character.seed + i,
				stylePromptVersionId: style.promptVersionId,
				createdAt: new Date()
			})
			.returning()
			.get();
		const job = enqueue(db, ownerId, 'character.candidate', { characterId, imageId: image.id });
		db.update(characterImages).set({ jobId: job.id }).where(eq(characterImages.id, image.id)).run();
	}
}

/** Make a finished candidate the character's reference picture. */
export function chooseReference(
	db: Db,
	ownerId: number,
	characterId: number,
	imageId: number
): void {
	const { character } = ownedCharacter(db, ownerId, characterId);
	const image = db.select().from(characterImages).where(eq(characterImages.id, imageId)).get();
	if (
		!image ||
		image.characterId !== characterId ||
		image.kind !== 'candidate' ||
		!image.assetHash
	) {
		throw new CharacterError('That picture is not ready.');
	}
	db.update(characters)
		.set({ referenceImageId: imageId, updatedAt: new Date() })
		.where(eq(characters.id, characterId))
		.run();
	// Chapters the character joined before it had a design take this one.
	db.update(chapterCast)
		.set({ pinnedImageId: imageId })
		.where(and(eq(chapterCast.characterId, characterId), isNull(chapterCast.pinnedImageId)))
		.run();
	touchSeries(db, character.seriesId);
}

/**
 * Redraw sheet views from the reference picture: every view, or just one,
 * with the user's guidance for it. Each round uses new seeds, so redrawing
 * one view gives a different result.
 */
export function requestSheet(
	db: Db,
	ownerId: number,
	characterId: number,
	only?: SheetView,
	guidance = ''
): void {
	const { character, series } = ownedCharacter(db, ownerId, characterId);
	const style = readyStyle(db, series);
	if (!style) throw new CharacterError(NO_STYLE);
	if (!character.referenceImageId) throw new CharacterError('Choose a reference picture first.');
	const views = only ? [only] : SHEET_VIEWS.map((v) => v.key);
	const old = db
		.select()
		.from(characterImages)
		.where(and(eq(characterImages.characterId, characterId), eq(characterImages.kind, 'sheet')))
		.all()
		.filter((img) => views.includes(img.view as SheetView));
	cancelJobs(
		db,
		old.map((img) => img.jobId).filter((id): id is number => id !== null)
	);
	if (old.length) {
		db.delete(characterImages)
			.where(
				inArray(
					characterImages.id,
					old.map((img) => img.id)
				)
			)
			.run();
	}
	const seed = randomSeed();
	views.forEach((view, i) => {
		const image = db
			.insert(characterImages)
			.values({
				characterId,
				kind: 'sheet',
				view,
				sourceImageId: character.referenceImageId,
				prompt: sheetPrompt(style.colorMode, view, only ? guidance : ''),
				seed: seed + i,
				stylePromptVersionId: style.promptVersionId,
				createdAt: new Date()
			})
			.returning()
			.get();
		const job = enqueue(db, ownerId, 'character.sheet', { characterId, imageId: image.id });
		db.update(characterImages).set({ jobId: job.id }).where(eq(characterImages.id, image.id)).run();
	});
}

export function deleteCharacter(db: Db, ownerId: number, characterId: number): void {
	const { character } = ownedCharacter(db, ownerId, characterId);
	cancelJobs(
		db,
		pendingJobs(db, [characterId]).map((j) => j.id)
	);
	db.delete(characters).where(eq(characters.id, characterId)).run();
	touchSeries(db, character.seriesId);
}

// ---------------------------------------------------------------------------
// Jobs

const DEVELOP_SYSTEM = `You are an experienced manga story editor and character designer, helping someone who may be new to comics build the cast of a short manga (under 30 pages).

Develop the character from the user's notes into a profile. Keep everything the user has decided; fill gaps with choices that suit the story, its setting and era, and the character's role. Make the character distinct from the rest of the cast in personality and, above all, in silhouette and look, so readers can tell them apart at a glance in black and white.

Reply with only a JSON object with these keys (all strings):
- "name": the character's name (keep the user's if they gave one).
- "personality": two or three sentences, including one real flaw.
- "motivation": what they want, and what they need but don't see; one or two sentences.
- "backstory": two or three sentences of history that matters to the story.
- "speech": how they talk, in one sentence (vocabulary, rhythm, verbal habits).
- "age": a short phrase, for example "a woman in her early twenties".
- "appearance": 25 to 60 words an image model can draw: build and height, face, eyes, hair (style and color), skin, distinguishing marks. Physical and visible only; no personality.
- "outfit": 15 to 40 words: their usual clothes and any signature props, right for the setting and era.
- "notes": two or three plain-language sentences to the user about the choices you made and what they might decide next.

The image model reads negation as a request ("no hat" draws a hat), so never write "no", "not" or "without" in "appearance" or "outfit": describe only what is there.

When the manga is not in full color, describe hair, eyes, skin and clothing in tones (black, white, dark, pale, light gray) and patterns, never in hues: a word like "indigo" or "red" makes the image model paint in color.`;

const developReply = z.object({
	name: z.string().default(''),
	personality: z.string().default(''),
	motivation: z.string().default(''),
	backstory: z.string().default(''),
	speech: z.string().default(''),
	age: z.string().default(''),
	appearance: z.string().default(''),
	outfit: z.string().default(''),
	notes: z.string().default('')
});

export function developMessages(
	character: Character,
	owner: Series,
	style: DrawingStyle | undefined,
	cast: Character[],
	feedback: string
) {
	const lines = [`Series title: ${owner.title}`];
	if (owner.logline) lines.push(`Logline: ${owner.logline}`);
	if (style) {
		lines.push(
			`Setting and look of the series: ${style.description}`,
			`Color: ${COLOR_MODES[style.colorMode].label}`
		);
	}
	const others = cast.filter((c) => c.id !== character.id && c.name);
	if (others.length) {
		lines.push(
			'The rest of the cast:',
			...others.map((c) => `- ${c.name} (${c.role}): ${c.appearance || c.brief}`)
		);
	}
	lines.push(`This character's role: ${ROLES[character.role as Role] ?? character.role}`);
	if (character.brief) lines.push(`The user's notes on this character: ${character.brief}`);
	const current = (
		[
			'name',
			'personality',
			'motivation',
			'backstory',
			'speech',
			'age',
			'appearance',
			'outfit'
		] as const
	).filter((k) => character[k]);
	if (current.length) {
		lines.push(
			'The current profile (keep what fits, unless the feedback asks for a change):',
			...current.map((k) => `- ${k}: ${character[k]}`)
		);
	}
	lines.push(
		feedback
			? `The user's feedback: ${feedback}`
			: current.length > 1
				? 'Improve the profile where it is thin or inconsistent.'
				: 'Write the first version of the profile.'
	);
	return [
		{ role: 'system' as const, content: DEVELOP_SYSTEM },
		{ role: 'user' as const, content: lines.join('\n') }
	];
}

const developHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { characterId, feedback } = job.payload as { characterId: number; feedback: string };
	const row = db
		.select({ character: characters, series })
		.from(characters)
		.innerJoin(series, eq(characters.seriesId, series.id))
		.where(eq(characters.id, characterId))
		.get();
	if (!row) return; // deleted meanwhile
	const cast = db.select().from(characters).where(eq(characters.seriesId, row.series.id)).all();
	const reply = await ai.text.json(
		developMessages(row.character, row.series, styleForContext(db, row.series), cast, feedback),
		developReply,
		signal
	);
	const text = (value: string, visual = false) => {
		const t = value.trim();
		return visual ? positiveOnly(t) : t;
	};
	const update: Partial<Character> = { notes: reply.notes.trim(), updatedAt: new Date() };
	if (!row.character.name && reply.name.trim()) update.name = reply.name.trim();
	for (const key of ['personality', 'motivation', 'backstory', 'speech', 'age'] as const) {
		if (reply[key].trim()) update[key] = text(reply[key]);
	}
	for (const key of ['appearance', 'outfit'] as const) {
		if (reply[key].trim()) update[key] = text(reply[key], true);
	}
	db.update(characters).set(update).where(eq(characters.id, characterId)).run();
};

const candidateHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { imageId } = job.payload as { imageId: number };
	const row = db
		.select({ image: characterImages, series })
		.from(characterImages)
		.innerJoin(characters, eq(characterImages.characterId, characters.id))
		.innerJoin(series, eq(characters.seriesId, series.id))
		.where(eq(characterImages.id, imageId))
		.get();
	if (!row) return; // replaced by a newer set
	const style = styleForContext(db, row.series);
	if (!style) throw new Error('The series has no style.');
	const result = await ai.image.generate(
		{
			model: style.model,
			prompt: row.image.prompt,
			seed: row.image.seed,
			...CANDIDATE_SIZE
		},
		signal
	);
	const { hash, thumbHash } = await putImage(db, result.png);
	db.update(characterImages)
		.set({ assetHash: hash, thumbHash })
		.where(eq(characterImages.id, imageId))
		.run();
};

const sheetHandler: JobHandler = async (job, { db, ai, signal }) => {
	const { imageId } = job.payload as { imageId: number };
	const image = db.select().from(characterImages).where(eq(characterImages.id, imageId)).get();
	if (!image?.sourceImageId) return; // replaced by a newer one
	const source = db
		.select()
		.from(characterImages)
		.where(eq(characterImages.id, image.sourceImageId))
		.get();
	if (!source?.assetHash) throw new Error('The reference picture is missing.');
	const result = await ai.image.edit(
		{ prompt: image.prompt, images: [readAsset(source.assetHash)], seed: image.seed },
		signal
	);
	const { hash, thumbHash } = await putImage(db, result.png);
	db.update(characterImages)
		.set({ assetHash: hash, thumbHash })
		.where(eq(characterImages.id, imageId))
		.run();
};

export const characterJobHandlers: Record<string, JobHandler> = {
	'character.develop': developHandler,
	'character.candidate': candidateHandler,
	'character.sheet': sheetHandler
};
