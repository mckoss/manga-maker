import { getDb } from '#lib/server/db/index.js';
import { listSeries } from '#lib/server/series.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => ({
	series: listSeries(getDb(), locals.user!.id)
});
