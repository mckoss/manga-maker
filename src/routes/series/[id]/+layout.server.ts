import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getSeries, SeriesError } from '#lib/server/series.js';
import { listChapters } from '#lib/server/chapters.js';
import { listCharacters } from '#lib/server/characters.js';
import { listLocations } from '#lib/server/locations.js';
import { seriesImageModel } from '#lib/server/models.js';
import { IMAGE_MODELS, imageModelOptions, isImageModel } from '#lib/models.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ params, locals }) => {
	try {
		const db = getDb();
		const ownerId = locals.user!.id;
		const series = getSeries(db, ownerId, Number(params.id));
		const cast = listCharacters(db, ownerId, series.id);
		const places = listLocations(db, ownerId, series.id);
		const model = seriesImageModel(db, series);
		return {
			/** What the series draws with, for the pages' Regenerate buttons. */
			imageModel: {
				value: model,
				label: IMAGE_MODELS[model].label,
				fromSeries: isImageModel(series.imageModel)
			},
			imageModels: imageModelOptions(),
			series,
			chapters: listChapters(db, ownerId, series.id),
			castSize: cast.length,
			castReady: cast.filter((c) => c.hasReference).length,
			placesSize: places.length,
			placesReady: places.filter((p) => p.hasReference).length
		};
	} catch (e) {
		if (e instanceof SeriesError) error(404, e.message);
		throw e;
	}
};
