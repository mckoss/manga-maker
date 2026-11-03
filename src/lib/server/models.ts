import { eq } from 'drizzle-orm';
import type { Db } from './db';
import { series, users, type Series } from './db/schema';
import { DEFAULT_IMAGE_MODEL, isImageModel, type ImageModelId } from '#lib/models.js';

/**
 * Which image model draws a picture: the one chosen for that picture, else
 * the series', else the user's default, else the app's.
 */

export function userImageModel(db: Db, userId: number): ImageModelId {
	const model = db.select({ m: users.imageModel }).from(users).where(eq(users.id, userId)).get()?.m;
	return isImageModel(model) ? model : DEFAULT_IMAGE_MODEL;
}

export function seriesImageModel(
	db: Db,
	owner: Pick<Series, 'ownerId' | 'imageModel'>
): ImageModelId {
	return isImageModel(owner.imageModel) ? owner.imageModel : userImageModel(db, owner.ownerId);
}

/** The model for a new picture: `chosen` (from a Regenerate form) when it names one. */
export function pictureModel(
	db: Db,
	owner: Pick<Series, 'ownerId' | 'imageModel'>,
	chosen?: unknown
): ImageModelId {
	return isImageModel(chosen) ? chosen : seriesImageModel(db, owner);
}

/** The series a style draws for (its first, if several share it); none for a loose style. */
export function seriesOfStyle(db: Db, styleId: number): Series | undefined {
	return db.select().from(series).where(eq(series.styleId, styleId)).orderBy(series.id).get();
}

/** The model a style's sample pictures are drawn with. */
export function styleImageModel(db: Db, ownerId: number, styleId: number, chosen?: unknown) {
	const owner = seriesOfStyle(db, styleId);
	if (isImageModel(chosen)) return chosen;
	return owner ? seriesImageModel(db, owner) : userImageModel(db, ownerId);
}

export function setUserImageModel(db: Db, userId: number, model: ImageModelId): void {
	db.update(users).set({ imageModel: model }).where(eq(users.id, userId)).run();
}

/** Null goes back to the owner's default. */
export function setSeriesImageModel(db: Db, seriesId: number, model: ImageModelId | null): void {
	db.update(series).set({ imageModel: model }).where(eq(series.id, seriesId)).run();
}
