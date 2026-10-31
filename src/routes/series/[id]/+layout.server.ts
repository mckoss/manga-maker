import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getSeries, SeriesError } from '#lib/server/series.js';
import { listChapters } from '#lib/server/chapters.js';
import { listCharacters } from '#lib/server/characters.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ params, locals }) => {
	try {
		const db = getDb();
		const ownerId = locals.user!.id;
		const series = getSeries(db, ownerId, Number(params.id));
		const cast = listCharacters(db, ownerId, series.id);
		return {
			series,
			chapters: listChapters(db, ownerId, series.id),
			castSize: cast.length,
			castReady: cast.filter((c) => c.referenceImageId).length
		};
	} catch (e) {
		if (e instanceof SeriesError) error(404, e.message);
		throw e;
	}
};
