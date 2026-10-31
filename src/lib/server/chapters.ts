import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Db } from './db';
import { chapterCast, chapters, characterImages, characters, type Chapter } from './db/schema';
import { ownedSeries, touchSeries } from './series';

export class ChapterError extends Error {}

/** What a chapter is called: its title, or its number when it has none. */
export function chapterName(chapter: Pick<Chapter, 'number' | 'title'>): string {
	return chapter.title || `Chapter ${chapter.number}`;
}

export function listChapters(db: Db, ownerId: number, seriesId: number) {
	ownedSeries(db, ownerId, seriesId);
	const castSizes = new Map(
		db
			.select({ chapterId: chapterCast.chapterId, count: sql<number>`count(*)` })
			.from(chapterCast)
			.innerJoin(chapters, eq(chapterCast.chapterId, chapters.id))
			.where(eq(chapters.seriesId, seriesId))
			.groupBy(chapterCast.chapterId)
			.all()
			.map((r) => [r.chapterId, r.count])
	);
	return db
		.select()
		.from(chapters)
		.where(eq(chapters.seriesId, seriesId))
		.orderBy(asc(chapters.number))
		.all()
		.map((c) => ({ ...c, name: chapterName(c), castSize: castSizes.get(c.id) ?? 0 }));
}

/** The user's chapter, checked to belong to the given series. */
export function ownedChapter(db: Db, ownerId: number, seriesId: number, chapterId: number) {
	ownedSeries(db, ownerId, seriesId);
	const chapter = db
		.select()
		.from(chapters)
		.where(and(eq(chapters.id, chapterId), eq(chapters.seriesId, seriesId)))
		.get();
	if (!chapter) throw new ChapterError('Chapter not found.');
	return { ...chapter, name: chapterName(chapter) };
}

export interface ChapterInput {
	title: string;
	logline: string;
}

const clean = (input: ChapterInput): ChapterInput => ({
	title: input.title.trim(),
	logline: input.logline.trim()
});

/** Add a chapter at the end of the series. */
export function createChapter(db: Db, ownerId: number, seriesId: number, input: ChapterInput) {
	ownedSeries(db, ownerId, seriesId);
	const last = db
		.select({ max: sql<number | null>`max(${chapters.number})` })
		.from(chapters)
		.where(eq(chapters.seriesId, seriesId))
		.get();
	const now = new Date();
	const id = db
		.insert(chapters)
		.values({
			seriesId,
			number: (last?.max ?? 0) + 1,
			...clean(input),
			createdAt: now,
			updatedAt: now
		})
		.returning()
		.get().id;
	touchSeries(db, seriesId);
	return id;
}

export function updateChapter(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	input: ChapterInput
): void {
	ownedChapter(db, ownerId, seriesId, chapterId);
	db.update(chapters)
		.set({ ...clean(input), updatedAt: new Date() })
		.where(eq(chapters.id, chapterId))
		.run();
	touchSeries(db, seriesId);
}

/** Delete a chapter; the ones after it move up a number. Its characters stay in the series. */
export function deleteChapter(db: Db, ownerId: number, seriesId: number, chapterId: number): void {
	const chapter = ownedChapter(db, ownerId, seriesId, chapterId);
	db.transaction(() => {
		db.delete(chapters).where(eq(chapters.id, chapterId)).run();
		db.update(chapters)
			.set({ number: sql`${chapters.number} - 1` })
			.where(and(eq(chapters.seriesId, seriesId), gt(chapters.number, chapter.number)))
			.run();
	});
	touchSeries(db, seriesId);
}

// ---------------------------------------------------------------------------
// Cast

/**
 * Every character in the series, saying whether it is in the chapter and,
 * if so, which design the chapter is pinned to and whether a newer one has
 * been chosen since.
 */
export function chapterCastView(db: Db, ownerId: number, seriesId: number, chapterId: number) {
	ownedChapter(db, ownerId, seriesId, chapterId);
	const all = db
		.select()
		.from(characters)
		.where(eq(characters.seriesId, seriesId))
		.orderBy(characters.id)
		.all();
	const members = new Map(
		db
			.select()
			.from(chapterCast)
			.where(eq(chapterCast.chapterId, chapterId))
			.all()
			.map((m) => [m.characterId, m])
	);
	const imageIds = [
		...all.map((c) => c.referenceImageId),
		...[...members.values()].map((m) => m.pinnedImageId)
	].filter((id): id is number => id !== null);
	const thumbs = new Map(
		imageIds.length
			? db
					.select({ id: characterImages.id, thumb: characterImages.thumbHash })
					.from(characterImages)
					.where(inArray(characterImages.id, imageIds))
					.all()
					.map((i) => [i.id, i.thumb])
			: []
	);
	const thumb = (id: number | null) => (id !== null ? (thumbs.get(id) ?? null) : null);
	return all.map((c) => {
		const member = members.get(c.id);
		return {
			id: c.id,
			name: c.name,
			role: c.role,
			inCast: member !== undefined,
			/** The design this chapter draws the character from. */
			pinnedThumb: member ? thumb(member.pinnedImageId) : null,
			/** The series' current design, when it differs from the pinned one. */
			newerThumb:
				member?.pinnedImageId != null &&
				c.referenceImageId !== null &&
				c.referenceImageId !== member.pinnedImageId
					? thumb(c.referenceImageId)
					: null,
			currentThumb: thumb(c.referenceImageId)
		};
	});
}

function seriesCharacter(db: Db, seriesId: number, characterId: number) {
	const character = db
		.select()
		.from(characters)
		.where(and(eq(characters.id, characterId), eq(characters.seriesId, seriesId)))
		.get();
	if (!character) throw new ChapterError('Character not found.');
	return character;
}

/** Bring a series character into the chapter, pinned to its current design. */
export function addToCast(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	characterId: number
): void {
	ownedChapter(db, ownerId, seriesId, chapterId);
	const character = seriesCharacter(db, seriesId, characterId);
	db.insert(chapterCast)
		.values({
			chapterId,
			characterId,
			pinnedImageId: character.referenceImageId,
			createdAt: new Date()
		})
		.onConflictDoNothing()
		.run();
}

/** Take a character out of the chapter; it stays in the series. */
export function removeFromCast(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	characterId: number
): void {
	ownedChapter(db, ownerId, seriesId, chapterId);
	db.delete(chapterCast)
		.where(and(eq(chapterCast.chapterId, chapterId), eq(chapterCast.characterId, characterId)))
		.run();
}

/** Move the chapter to the character's current design. */
export function useNewestDesign(
	db: Db,
	ownerId: number,
	seriesId: number,
	chapterId: number,
	characterId: number
): void {
	ownedChapter(db, ownerId, seriesId, chapterId);
	const character = seriesCharacter(db, seriesId, characterId);
	db.update(chapterCast)
		.set({ pinnedImageId: character.referenceImageId })
		.where(and(eq(chapterCast.chapterId, chapterId), eq(chapterCast.characterId, characterId)))
		.run();
}
