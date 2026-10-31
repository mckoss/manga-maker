import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getManga, MangaError } from '#lib/server/mangas.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ params, locals }) => {
	try {
		return { manga: getManga(getDb(), locals.user!.id, Number(params.id)) };
	} catch (e) {
		if (e instanceof MangaError) error(404, e.message);
		throw e;
	}
};
