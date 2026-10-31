import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	createSeries,
	isReadingDirection,
	SeriesError,
	READING_DIRECTIONS
} from '#lib/server/series.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	directions: Object.entries(READING_DIRECTIONS).map(([value, d]) => ({ value, ...d }))
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const values = {
			title: String(form.get('title') ?? ''),
			logline: String(form.get('logline') ?? ''),
			readingDirection: String(form.get('readingDirection') ?? '')
		};
		if (!isReadingDirection(values.readingDirection)) {
			return fail(400, { ...values, error: 'Choose a reading direction.' });
		}
		let id: number;
		try {
			id = createSeries(getDb(), locals.user!.id, {
				...values,
				readingDirection: values.readingDirection
			});
		} catch (e) {
			if (e instanceof SeriesError) return fail(400, { ...values, error: e.message });
			throw e;
		}
		redirect(303, `/series/${id}/style`);
	}
};
