import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const sessions = sqliteTable('sessions', {
	/** SHA-256 of the session token; the token itself is only in the cookie. */
	id: text('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
});

export type User = typeof users.$inferSelect;

/** Content-addressed files under data/assets; the hash is the SHA-256 of the bytes. */
export const assets = sqliteTable('assets', {
	hash: text('hash').primaryKey(),
	mime: text('mime').notNull(),
	size: integer('size').notNull(),
	width: integer('width'),
	height: integer('height'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

/** Background work (AI calls), run one at a time by the worker. */
export const jobs = sqliteTable('jobs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	kind: text('kind').notNull(),
	payload: text('payload', { mode: 'json' }).notNull(),
	status: text('status').$type<JobStatus>().notNull().default('queued'),
	error: text('error'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	startedAt: integer('started_at', { mode: 'timestamp_ms' }),
	finishedAt: integer('finished_at', { mode: 'timestamp_ms' })
});

export type Job = typeof jobs.$inferSelect;

export type ColorMode = 'bw' | 'grayscale' | 'limited' | 'color';

/**
 * A manga's drawing style. Its description, prompt, scenes and sample
 * pictures are versioned items (see `items`) scoped "style:<id>".
 */
export const styles = sqliteTable('styles', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ownerId: integer('owner_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	colorMode: text('color_mode').$type<ColorMode>().notNull().default('bw'),
	model: text('model').notNull().default('qwen-image'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export type Style = typeof styles.$inferSelect;

/**
 * Something made in rounds that keeps every round: a style prompt, a sample
 * scene, a sample picture. One item per slot; its versions are the rounds.
 */
export const items = sqliteTable(
	'items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ownerId: integer('owner_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** What the item belongs to, as "<table>:<id>", for example "style:3". */
		scope: text('scope').notNull(),
		/** What it is within the scope, for example "prompt", "scene" or "picture". */
		kind: text('kind').notNull(),
		/** Which one, when a scope has several of a kind (for example "exterior"). */
		key: text('key').notNull().default(''),
		/** The version in use: the newest, unless the user went back to an older one. */
		currentVersionId: integer('current_version_id'),
		/** Fixed by the user: never regenerated until unlocked. */
		locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [uniqueIndex('items_slot').on(t.scope, t.kind, t.key)]
);

export type Item = typeof items.$inferSelect;

/** ai: generated; user: typed or edited by the user; import: from before versioning. */
export type VersionOrigin = 'ai' | 'user' | 'import';
/** pending: a job is making it; ready: made. A failed job leaves it pending (see jobId). */
export type VersionStatus = 'pending' | 'ready';

export const versions = sqliteTable('versions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	itemId: integer('item_id')
		.notNull()
		.references(() => items.id, { onDelete: 'cascade' }),
	status: text('status').$type<VersionStatus>().notNull(),
	origin: text('origin').$type<VersionOrigin>().notNull(),
	/** The content of a text item; for a picture, the full prompt it was drawn from. */
	text: text('text').notNull().default(''),
	assetHash: text('asset_hash').references(() => assets.hash),
	thumbHash: text('thumb_hash').references(() => assets.hash),
	seed: integer('seed'),
	/**
	 * What it was made from (input name to value), to tell when it is out of
	 * date. Inputs that could not be recorded are missing.
	 */
	inputs: text('inputs', { mode: 'json' }).$type<Record<string, string>>().notNull().default({}),
	/** The AI's explanation of what it made and why. */
	notes: text('notes').notNull().default(''),
	/** The user's instructions for this one round ("make her look over her shoulder"). */
	guidance: text('guidance').notNull().default(''),
	jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export type Version = typeof versions.$inferSelect;

export type ReadingDirection = 'rtl' | 'ltr';

/** A comic: the top-level thing a user works on. Everything else belongs to one. */
export const mangas = sqliteTable('mangas', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ownerId: integer('owner_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	/** One or two sentences: what the story is about. */
	logline: text('logline').notNull().default(''),
	readingDirection: text('reading_direction').$type<ReadingDirection>().notNull().default('rtl'),
	/** This manga's own style; null until one is started. */
	styleId: integer('style_id').references(() => styles.id, { onDelete: 'set null' }),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export type Manga = typeof mangas.$inferSelect;

/** A member of a manga's cast. The look fields drive every picture of them. */
export const characters = sqliteTable('characters', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	mangaId: integer('manga_id')
		.notNull()
		.references(() => mangas.id, { onDelete: 'cascade' }),
	name: text('name').notNull().default(''),
	/** protagonist | antagonist | supporting | minor */
	role: text('role').notNull().default('supporting'),
	/** The user's own words about the character, which the AI develops. */
	brief: text('brief').notNull().default(''),
	personality: text('personality').notNull().default(''),
	motivation: text('motivation').notNull().default(''),
	backstory: text('backstory').notNull().default(''),
	speech: text('speech').notNull().default(''),
	age: text('age').notNull().default(''),
	/** Body, face and hair, as words an image model can draw. */
	appearance: text('appearance').notNull().default(''),
	outfit: text('outfit').notNull().default(''),
	/** The AI's explanation of its latest draft. */
	notes: text('notes').notNull().default(''),
	/** Candidate seeds derive from this, so redraws after edits compare like for like. */
	seed: integer('seed').notNull(),
	/** The chosen picture every later image of this character is drawn from. */
	referenceImageId: integer('reference_image_id'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export type Character = typeof characters.$inferSelect;

/** A generated picture of a character. */
export const characterImages = sqliteTable('character_images', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	characterId: integer('character_id')
		.notNull()
		.references(() => characters.id, { onDelete: 'cascade' }),
	/**
	 * candidate: a full-body design option to choose the reference from.
	 * sheet: a view or expression redrawn from the reference (see `view`).
	 */
	kind: text('kind').notNull(),
	/** For sheet pictures, which view or expression (see SHEET_VIEWS). */
	view: text('view'),
	/** For sheet pictures, the reference picture they were redrawn from. */
	sourceImageId: integer('source_image_id'),
	prompt: text('prompt').notNull(),
	seed: integer('seed').notNull(),
	/** The style prompt version it was drawn in, to flag pictures from an older style. */
	stylePromptVersionId: integer('style_prompt_version_id').references(() => versions.id, {
		onDelete: 'set null'
	}),
	jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
	assetHash: text('asset_hash').references(() => assets.hash),
	thumbHash: text('thumb_hash').references(() => assets.hash),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export type CharacterImage = typeof characterImages.$inferSelect;
