import { getDb } from '#lib/server/db/index.js';
import { listMangas } from '#lib/server/mangas.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	mangas: listMangas(getDb(), locals.user!.id)
});
