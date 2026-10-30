import { getDb } from '#lib/server/db/index.js';
import { listStyles } from '#lib/server/styles.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	styles: listStyles(getDb(), locals.user!.id)
});
