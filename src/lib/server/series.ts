import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from './db';
import { chapters, characters, series, type ReadingDirection } from './db/schema';
import { deleteScope } from './versions';
import { copyStyle, createStyle, deleteStyle, listStyles, type StyleInput } from './styles';

export class SeriesError extends Error {}

export const READING_DIRECTIONS: Record<ReadingDirection, { label: string; hint: string }> = {
	rtl: { label: 'Right to left', hint: 'Traditional manga: pages and panels read right to left.' },
	ltr: { label: 'Left to right', hint: 'Western comics: pages and panels read left to right.' }
};

export function isReadingDirection(value: string): value is ReadingDirection {
	return value in READING_DIRECTIONS;
}

/** none: not started; started: no sample picture yet; ready: the rest can be drawn. */
export type StyleStatus = 'none' | 'started' | 'ready';

export function ownedSeries(db: Db, ownerId: number, seriesId: number) {
	const row = db
		.select()
		.from(series)
		.where(and(eq(series.id, seriesId), eq(series.ownerId, ownerId)))
		.get();
	if (!row) throw new SeriesError('Series not found.');
	return row;
}

function touch(db: Db, seriesId: number): void {
	db.update(series).set({ updatedAt: new Date() }).where(eq(series.id, seriesId)).run();
}

/** The user's series, most recently changed first, each with a cover thumbnail if it has one. */
export function listSeries(db: Db, ownerId: number) {
	const styles = new Map(listStyles(db, ownerId).map((s) => [s.id, s]));
	const chapterCounts = new Map(
		db
			.select({ seriesId: chapters.seriesId, count: sql<number>`count(*)` })
			.from(chapters)
			.groupBy(chapters.seriesId)
			.all()
			.map((r) => [r.seriesId, r.count])
	);
	return db
		.select()
		.from(series)
		.where(eq(series.ownerId, ownerId))
		.orderBy(desc(series.updatedAt), desc(series.id))
		.all()
		.map((row) => {
			const style = row.styleId ? styles.get(row.styleId) : undefined;
			return {
				...row,
				chapterCount: chapterCounts.get(row.id) ?? 0,
				styleStatus: (style?.ready ? 'ready' : style ? 'started' : 'none') as StyleStatus,
				// Until there is a cover, the style's figure sample stands in for one.
				thumb: style?.thumbs[0] ?? null
			};
		});
}

export function getSeries(db: Db, ownerId: number, seriesId: number) {
	const row = listSeries(db, ownerId).find((s) => s.id === seriesId);
	if (!row) throw new SeriesError('Series not found.');
	return row;
}

export interface SeriesInput {
	title: string;
	logline: string;
	readingDirection: ReadingDirection;
}

function clean(input: SeriesInput): SeriesInput {
	const title = input.title.trim();
	if (!title) throw new SeriesError('Give your series a title.');
	return { title, logline: input.logline.trim(), readingDirection: input.readingDirection };
}

/** Start a series with its first chapter; returns the series id. */
export function createSeries(db: Db, ownerId: number, input: SeriesInput): number {
	const now = new Date();
	const values = clean(input);
	return db.transaction(() => {
		const id = db
			.insert(series)
			.values({ ownerId, ...values, createdAt: now, updatedAt: now })
			.returning()
			.get().id;
		db.insert(chapters)
			.values({ seriesId: id, number: 1, logline: values.logline, createdAt: now, updatedAt: now })
			.run();
		return id;
	});
}

export function updateSeries(db: Db, ownerId: number, seriesId: number, input: SeriesInput): void {
	ownedSeries(db, ownerId, seriesId);
	db.update(series)
		.set({ ...clean(input), updatedAt: new Date() })
		.where(eq(series.id, seriesId))
		.run();
}

export function deleteSeries(db: Db, ownerId: number, seriesId: number): void {
	const row = ownedSeries(db, ownerId, seriesId);
	db.transaction(() => {
		if (row.styleId) deleteStyle(db, ownerId, row.styleId);
		// The characters' rows go with the series; their items are kept by scope.
		for (const { id } of db
			.select({ id: characters.id })
			.from(characters)
			.where(eq(characters.seriesId, seriesId))
			.all()) {
			deleteScope(db, `character:${id}`);
		}
		db.delete(series).where(eq(series.id, seriesId)).run();
	});
}

function requireNoStyle(row: { styleId: number | null }) {
	if (row.styleId) throw new SeriesError('This series already has a style.');
}

/** Start the series' style from a description; the AI writes its prompt and scenes. */
export function startStyle(
	db: Db,
	ownerId: number,
	seriesId: number,
	input: Omit<StyleInput, 'name'>
): number {
	const row = ownedSeries(db, ownerId, seriesId);
	requireNoStyle(row);
	const styleId = createStyle(db, ownerId, { ...input, name: row.title });
	db.update(series).set({ styleId, updatedAt: new Date() }).where(eq(series.id, seriesId)).run();
	return styleId;
}

/** Give the series a copy of another series' style. */
export function reuseStyle(db: Db, ownerId: number, seriesId: number, fromStyleId: number): number {
	const row = ownedSeries(db, ownerId, seriesId);
	requireNoStyle(row);
	const styleId = copyStyle(db, ownerId, fromStyleId, row.title);
	db.update(series).set({ styleId, updatedAt: new Date() }).where(eq(series.id, seriesId)).run();
	return styleId;
}

/** Throw away the series' style so it can start again. */
export function removeStyle(db: Db, ownerId: number, seriesId: number): void {
	const row = ownedSeries(db, ownerId, seriesId);
	if (!row.styleId) return;
	deleteStyle(db, ownerId, row.styleId);
	touch(db, seriesId);
}

/** Ready styles of the user's other series, to start this one's from. */
export function reusableStyles(db: Db, ownerId: number, seriesId: number) {
	const titles = new Map(
		db
			.select({ styleId: series.styleId, title: series.title, id: series.id })
			.from(series)
			.where(eq(series.ownerId, ownerId))
			.all()
			.filter((s) => s.id !== seriesId && s.styleId !== null)
			.map((s) => [s.styleId!, s.title])
	);
	return listStyles(db, ownerId)
		.filter((s) => s.ready && titles.has(s.id))
		.map((s) => ({ id: s.id, title: titles.get(s.id)!, thumbs: s.thumbs }));
}

/** The series' style id, or an error if it has none yet. */
export function seriesStyleId(db: Db, ownerId: number, seriesId: number): number {
	const row = ownedSeries(db, ownerId, seriesId);
	if (!row.styleId) throw new SeriesError('This series has no style yet.');
	return row.styleId;
}

export { touch as touchSeries };
