import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const SERIES_STEPS = new Set(['style', 'characters', 'locations']);

// Each manga became a series with the same id; old links go to the same place
// in the series, or to the series itself for steps that moved into chapters.
export const GET: RequestHandler = ({ params }) => {
	const [id, step, ...rest] = params.rest.split('/');
	if (id === 'new') redirect(308, '/series/new');
	if (!/^\d+$/.test(id ?? '')) redirect(308, '/');
	const tail = step && SERIES_STEPS.has(step) ? ['', step, ...rest].join('/') : '';
	redirect(308, `/series/${id}${tail}`);
};
