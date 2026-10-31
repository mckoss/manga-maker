import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './db';
import { mangas, type ReadingDirection } from './db/schema';
import { copyStyle, createStyle, deleteStyle, listStyles, type StyleInput } from './styles';

export class MangaError extends Error {}

export const READING_DIRECTIONS: Record<ReadingDirection, { label: string; hint: string }> = {
	rtl: { label: 'Right to left', hint: 'Traditional manga: pages and panels read right to left.' },
	ltr: { label: 'Left to right', hint: 'Western comics: pages and panels read left to right.' }
};

export function isReadingDirection(value: string): value is ReadingDirection {
	return value in READING_DIRECTIONS;
}

export type StyleStatus = 'none' | 'draft' | 'approved';

export function ownedManga(db: Db, ownerId: number, mangaId: number) {
	const manga = db
		.select()
		.from(mangas)
		.where(and(eq(mangas.id, mangaId), eq(mangas.ownerId, ownerId)))
		.get();
	if (!manga) throw new MangaError('Manga not found.');
	return manga;
}

function touch(db: Db, mangaId: number): void {
	db.update(mangas).set({ updatedAt: new Date() }).where(eq(mangas.id, mangaId)).run();
}

/** The user's manga, most recently changed first, each with a cover thumbnail if it has one. */
export function listMangas(db: Db, ownerId: number) {
	const styles = new Map(listStyles(db, ownerId).map((s) => [s.id, s]));
	return db
		.select()
		.from(mangas)
		.where(eq(mangas.ownerId, ownerId))
		.orderBy(desc(mangas.updatedAt), desc(mangas.id))
		.all()
		.map((manga) => {
			const style = manga.styleId ? styles.get(manga.styleId) : undefined;
			return {
				...manga,
				styleStatus: (style?.active ? 'approved' : style ? 'draft' : 'none') as StyleStatus,
				// Until there is a cover, the style's figure sample stands in for one.
				thumb: style?.thumbs[0] ?? null
			};
		});
}

export function getManga(db: Db, ownerId: number, mangaId: number) {
	const manga = listMangas(db, ownerId).find((m) => m.id === mangaId);
	if (!manga) throw new MangaError('Manga not found.');
	return manga;
}

export interface MangaInput {
	title: string;
	logline: string;
	readingDirection: ReadingDirection;
}

function clean(input: MangaInput): MangaInput {
	const title = input.title.trim();
	if (!title) throw new MangaError('Give your manga a title.');
	return { title, logline: input.logline.trim(), readingDirection: input.readingDirection };
}

export function createManga(db: Db, ownerId: number, input: MangaInput): number {
	const now = new Date();
	return db
		.insert(mangas)
		.values({ ownerId, ...clean(input), createdAt: now, updatedAt: now })
		.returning()
		.get().id;
}

export function updateManga(db: Db, ownerId: number, mangaId: number, input: MangaInput): void {
	ownedManga(db, ownerId, mangaId);
	db.update(mangas)
		.set({ ...clean(input), updatedAt: new Date() })
		.where(eq(mangas.id, mangaId))
		.run();
}

export function deleteManga(db: Db, ownerId: number, mangaId: number): void {
	const manga = ownedManga(db, ownerId, mangaId);
	db.transaction(() => {
		if (manga.styleId) deleteStyle(db, ownerId, manga.styleId);
		db.delete(mangas).where(eq(mangas.id, mangaId)).run();
	});
}

function requireNoStyle(manga: { styleId: number | null }) {
	if (manga.styleId) throw new MangaError('This manga already has a style.');
}

/** Start the manga's style from a description; the AI drafts its prompt. */
export function startStyle(
	db: Db,
	ownerId: number,
	mangaId: number,
	input: Omit<StyleInput, 'name'>
): number {
	const manga = ownedManga(db, ownerId, mangaId);
	requireNoStyle(manga);
	const styleId = createStyle(db, ownerId, { ...input, name: manga.title });
	db.update(mangas).set({ styleId, updatedAt: new Date() }).where(eq(mangas.id, mangaId)).run();
	return styleId;
}

/** Give the manga a copy of another manga's approved style. */
export function reuseStyle(db: Db, ownerId: number, mangaId: number, fromStyleId: number): number {
	const manga = ownedManga(db, ownerId, mangaId);
	requireNoStyle(manga);
	const styleId = copyStyle(db, ownerId, fromStyleId, manga.title);
	db.update(mangas).set({ styleId, updatedAt: new Date() }).where(eq(mangas.id, mangaId)).run();
	return styleId;
}

/** Throw away the manga's style so it can start again. */
export function removeStyle(db: Db, ownerId: number, mangaId: number): void {
	const manga = ownedManga(db, ownerId, mangaId);
	if (!manga.styleId) return;
	deleteStyle(db, ownerId, manga.styleId);
	touch(db, mangaId);
}

/** Approved styles of the user's other manga, to start this one's from. */
export function reusableStyles(db: Db, ownerId: number, mangaId: number) {
	const titles = new Map(
		db
			.select({ styleId: mangas.styleId, title: mangas.title, id: mangas.id })
			.from(mangas)
			.where(eq(mangas.ownerId, ownerId))
			.all()
			.filter((m) => m.id !== mangaId && m.styleId !== null)
			.map((m) => [m.styleId!, m.title])
	);
	return listStyles(db, ownerId)
		.filter((s) => s.active && titles.has(s.id))
		.map((s) => ({ id: s.id, title: titles.get(s.id)!, thumbs: s.thumbs }));
}

/** The manga's style id, or an error if it has none yet. */
export function mangaStyleId(db: Db, ownerId: number, mangaId: number): number {
	const manga = ownedManga(db, ownerId, mangaId);
	if (!manga.styleId) throw new MangaError('This manga has no style yet.');
	return manga.styleId;
}

export { touch as touchManga };
