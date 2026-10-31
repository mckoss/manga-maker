import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getManga, MangaError } from '#lib/server/mangas.js';
import { listCharacters } from '#lib/server/characters.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ params, locals }) => {
	try {
		const db = getDb();
		const ownerId = locals.user!.id;
		const manga = getManga(db, ownerId, Number(params.id));
		const cast = listCharacters(db, ownerId, manga.id);
		return {
			manga,
			castSize: cast.length,
			castReady: cast.filter((c) => c.referenceImageId).length
		};
	} catch (e) {
		if (e instanceof MangaError) error(404, e.message);
		throw e;
	}
};
