import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

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

/** A drawing style in a user's library. Only approved versions are used for work. */
export const styles = sqliteTable('styles', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ownerId: integer('owner_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	/** The approved version in use; null until the first approval. */
	activeVersionId: integer('active_version_id'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export type ColorMode = 'bw' | 'greyscale' | 'limited' | 'color';
export type StyleVersionStatus = 'draft' | 'approved' | 'superseded' | 'discarded';

export const styleVersions = sqliteTable('style_versions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	styleId: integer('style_id')
		.notNull()
		.references(() => styles.id, { onDelete: 'cascade' }),
	number: integer('number').notNull(),
	status: text('status').$type<StyleVersionStatus>().notNull(),
	/** The user's plain-language description of the look they want. */
	description: text('description').notNull(),
	colorMode: text('color_mode').$type<ColorMode>().notNull(),
	/** Style fragment prepended to every image prompt (subject excluded). */
	prompt: text('prompt').notNull(),
	/**
	 * Things the user wants kept out of every image. The image models ignore
	 * negative prompts, so the AI works these into the prompt and scenes.
	 */
	avoid: text('negative_prompt').notNull().default(''),
	/** Sample scene per subject key, written by the AI to suit the style's setting. */
	scenes: text('scenes', { mode: 'json' }).$type<Record<string, string>>().notNull().default({}),
	model: text('model').notNull(),
	/** Sample seeds derive from this, so versions can be compared like for like. */
	seed: integer('seed').notNull(),
	/** The mentor's explanation of the latest prompt revision. */
	notes: text('notes').notNull().default(''),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	approvedAt: integer('approved_at', { mode: 'timestamp_ms' })
});

export type StyleVersion = typeof styleVersions.$inferSelect;

/** One generated test image for a style version. */
export const styleSamples = sqliteTable('style_samples', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	versionId: integer('version_id')
		.notNull()
		.references(() => styleVersions.id, { onDelete: 'cascade' }),
	subject: text('subject').notNull(),
	/** The full prompt sent to the model, to detect samples made from an older prompt. */
	prompt: text('prompt').notNull(),
	seed: integer('seed').notNull(),
	jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
	assetHash: text('asset_hash').references(() => assets.hash),
	thumbHash: text('thumb_hash').references(() => assets.hash),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export type StyleSample = typeof styleSamples.$inferSelect;

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
	/** The style version it was drawn in, to flag pictures from an older style. */
	styleVersionId: integer('style_version_id').references(() => styleVersions.id, {
		onDelete: 'set null'
	}),
	jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
	assetHash: text('asset_hash').references(() => assets.hash),
	thumbHash: text('thumb_hash').references(() => assets.hash),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export type CharacterImage = typeof characterImages.$inferSelect;
