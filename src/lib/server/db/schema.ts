import { sqliteTable, text, integer, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

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
 * A series' drawing style. Its description, prompt, scenes and sample
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

/**
 * The top-level thing a user works on: one style and a cast shared by its
 * chapters. A one-off story is a series of one chapter.
 */
export const series = sqliteTable('series', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ownerId: integer('owner_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	/** One or two sentences: what the series is about. */
	logline: text('logline').notNull().default(''),
	readingDirection: text('reading_direction').$type<ReadingDirection>().notNull().default('rtl'),
	/** The series' own style; null until one is started. */
	styleId: integer('style_id').references(() => styles.id, { onDelete: 'set null' }),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export type Series = typeof series.$inferSelect;

/** One story of a series, with its own plot, script and pages. */
export const chapters = sqliteTable('chapters', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	seriesId: integer('series_id')
		.notNull()
		.references(() => series.id, { onDelete: 'cascade' }),
	/** Its place in the series, from 1. */
	number: integer('number').notNull(),
	/** Optional; shown as "Chapter <number>" when empty. */
	title: text('title').notNull().default(''),
	/** One or two sentences: what happens in this chapter. */
	logline: text('logline').notNull().default(''),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export type Chapter = typeof chapters.$inferSelect;

/**
 * A member of a series' cast. Everything about them (notes, profile,
 * designs, pictures, the reference and the sheet) is a versioned item in the
 * scope "character:<id>"; the name and role are copied here from their
 * current versions for lists.
 */
export const characters = sqliteTable('characters', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	seriesId: integer('series_id')
		.notNull()
		.references(() => series.id, { onDelete: 'cascade' }),
	name: text('name').notNull().default(''),
	/** protagonist | antagonist | supporting | minor */
	role: text('role').notNull().default('supporting'),
	/** Design picture seeds derive from this, so redraws after edits compare like for like. */
	seed: integer('seed').notNull(),
	/**
	 * What the AI found the latest designs could vary (free) and what the notes,
	 * age and setting decide (fixed), shown beside the designs.
	 */
	designTraits: text('design_traits', { mode: 'json' }).$type<{
		fixed: string[];
		free: string[];
	}>(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export type Character = typeof characters.$inferSelect;

/**
 * A character appearing in a chapter, drawn from the design (reference
 * picture) pinned when it joined, so a later redesign in the series does not
 * change the chapter until the user moves it to the newer design.
 */
export const chapterCast = sqliteTable(
	'chapter_cast',
	{
		chapterId: integer('chapter_id')
			.notNull()
			.references(() => chapters.id, { onDelete: 'cascade' }),
		characterId: integer('character_id')
			.notNull()
			.references(() => characters.id, { onDelete: 'cascade' }),
		/** A version of the character's reference; null until it has one. */
		pinnedVersionId: integer('pinned_version_id').references(() => versions.id, {
			onDelete: 'set null'
		}),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [primaryKey({ columns: [t.chapterId, t.characterId] })]
);
