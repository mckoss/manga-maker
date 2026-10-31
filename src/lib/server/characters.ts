import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db';
import {
	characterImages,
	characters,
	jobs,
	mangas,
	styles,
	styleVersions,
	type Character,
	type CharacterImage,
	type ColorMode,
	type Job,
	type Manga,
	type StyleVersion
} from './db/schema';
import { randomSeed, type ImageModelId } from './ai/image';
import { putImage } from './assets';
import { cancelJobs, enqueue, type JobHandler } from './jobs';
import { ownedManga, touchManga } from './mangas';
import { COLOR_MODES, compilePrompt, positiveOnly, sentence } from './styles';

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

/**
 * Restated at the end of character prompts: a long description pulls the
 * image toward colour ("indigo kimono") unless the tones are repeated.
 */
const TONE_REMINDER: Record<ColorMode, string> = {
	bw: 'Drawn entirely in black ink on white paper.',
	greyscale: 'Drawn entirely in shades of grey.',
	limited: '',
	color: ''
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const uncapitalize = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The full image prompt for a full-body design picture of a character. The
 * framing is stated before and after the description, as a wide shot: a
 * detailed face description otherwise makes Qwen-Image frame a medium shot
 * and crop at the thighs.
 */
export function characterPrompt(
	style: Pick<StyleVersion, 'colorMode' | 'prompt'>,
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

// ---------------------------------------------------------------------------
// Queries

function ownedCharacter(db: Db, ownerId: number, characterId: number) {
	const row = db
		.select({ character: characters, manga: mangas })
		.from(characters)
		.innerJoin(mangas, eq(characters.mangaId, mangas.id))
		.where(eq(characters.id, characterId))
		.get();
	if (!row || row.manga.ownerId !== ownerId) throw new CharacterError('Character not found.');
	return row;
}

/** The manga's approved style version, which every character picture is drawn in. */
export function approvedStyle(db: Db, manga: Pick<Manga, 'styleId'>): StyleVersion | undefined {
	if (!manga.styleId) return undefined;
	const style = db.select().from(styles).where(eq(styles.id, manga.styleId)).get();
	if (!style?.activeVersionId) return undefined;
	return db.select().from(styleVersions).where(eq(styleVersions.id, style.activeVersionId)).get();
}

/**
 * The style version that tells the AI about the manga's setting: the approved
 * one, or the draft while there is none yet.
 */
function styleForContext(db: Db, manga: Pick<Manga, 'styleId'>): StyleVersion | undefined {
	if (!manga.styleId) return undefined;
	return (
		approvedStyle(db, manga) ??
		db
			.select()
			.from(styleVersions)
			.where(and(eq(styleVersions.styleId, manga.styleId), eq(styleVersions.status, 'draft')))
			.get()
	);
}

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

export function listCharacters(db: Db, ownerId: number, mangaId: number) {
	ownedManga(db, ownerId, mangaId);
	const cast = db
		.select()
		.from(characters)
		.where(eq(characters.mangaId, mangaId))
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
	const { character, manga } = ownedCharacter(db, ownerId, characterId);
	const style = approvedStyle(db, manga);
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
		/** Drawn in a style version other than the approved one. */
		oldStyle: style !== undefined && img.styleVersionId !== style.id
	}));
	return {
		character,
		manga,
		style: style ?? null,
		reference: decorated.find((img) => img.id === character.referenceImageId) ?? null,
		candidates: decorated.filter((img) => img.kind === 'candidate'),
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

/** Add a character to a manga and ask the AI to develop a profile from the brief. */
export function createCharacter(
	db: Db,
	ownerId: number,
	mangaId: number,
	input: NewCharacter
): number {
	ownedManga(db, ownerId, mangaId);
	const name = input.name.trim();
	const brief = input.brief.trim();
	if (!name && !brief) throw new CharacterError('Give the character a name or a description.');
	const now = new Date();
	const character = db
		.insert(characters)
		.values({
			mangaId,
			name,
			role: input.role,
			brief,
			seed: randomSeed(),
			createdAt: now,
			updatedAt: now
		})
		.returning()
		.get();
	touchManga(db, mangaId);
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
	touchManga(db, character.mangaId);
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
 * Draw a fresh set of design candidates in the manga's approved style. The
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
	const style = approvedStyle(db, owned.manga);
	if (!style) throw new CharacterError('Approve the manga’s style before drawing characters.');
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
	const keep = character.referenceImageId ?? -1;
	db.delete(characterImages)
		.where(
			and(
				eq(characterImages.characterId, characterId),
				eq(characterImages.kind, 'candidate'),
				ne(characterImages.id, keep)
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
				styleVersionId: style.id,
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
	if (!image || image.characterId !== characterId || !image.assetHash) {
		throw new CharacterError('That picture is not ready.');
	}
	db.update(characters)
		.set({ referenceImageId: imageId, updatedAt: new Date() })
		.where(eq(characters.id, characterId))
		.run();
	touchManga(db, character.mangaId);
}

export function deleteCharacter(db: Db, ownerId: number, characterId: number): void {
	const { character } = ownedCharacter(db, ownerId, characterId);
	cancelJobs(
		db,
		pendingJobs(db, [characterId]).map((j) => j.id)
	);
	db.delete(characters).where(eq(characters.id, characterId)).run();
	touchManga(db, character.mangaId);
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
- "appearance": 25 to 60 words an image model can draw: build and height, face, eyes, hair (style and colour), skin, distinguishing marks. Physical and visible only; no personality.
- "outfit": 15 to 40 words: their usual clothes and any signature props, right for the setting and era.
- "notes": two or three plain-language sentences to the user about the choices you made and what they might decide next.

The image model reads negation as a request ("no hat" draws a hat), so never write "no", "not" or "without" in "appearance" or "outfit": describe only what is there.

When the manga is not in full colour, describe hair, eyes, skin and clothing in tones (black, white, dark, pale, light grey) and patterns, never in hues: a word like "indigo" or "red" makes the image model paint in colour.`;

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
	manga: Manga,
	style: StyleVersion | undefined,
	cast: Character[],
	feedback: string
) {
	const lines = [`Manga title: ${manga.title}`];
	if (manga.logline) lines.push(`Logline: ${manga.logline}`);
	if (style) {
		lines.push(
			`Setting and look of the manga: ${style.description}`,
			`Colour: ${COLOR_MODES[style.colorMode].label}`
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
		.select({ character: characters, manga: mangas })
		.from(characters)
		.innerJoin(mangas, eq(characters.mangaId, mangas.id))
		.where(eq(characters.id, characterId))
		.get();
	if (!row) return; // deleted meanwhile
	const cast = db.select().from(characters).where(eq(characters.mangaId, row.manga.id)).all();
	const reply = await ai.text.json(
		developMessages(row.character, row.manga, styleForContext(db, row.manga), cast, feedback),
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
		.select({ image: characterImages, version: styleVersions })
		.from(characterImages)
		.innerJoin(styleVersions, eq(characterImages.styleVersionId, styleVersions.id))
		.where(eq(characterImages.id, imageId))
		.get();
	if (!row) return; // replaced by a newer set
	const result = await ai.image.generate(
		{
			model: row.version.model as ImageModelId,
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

export const characterJobHandlers: Record<string, JobHandler> = {
	'character.develop': developHandler,
	'character.candidate': candidateHandler
};
