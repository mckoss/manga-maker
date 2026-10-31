import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	deleteSeries,
	isReadingDirection,
	SeriesError,
	READING_DIRECTIONS,
	updateSeries
} from '#lib/server/series.js';
import { createChapter } from '#lib/server/chapters.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	directions: Object.entries(READING_DIRECTIONS).map(([value, d]) => ({ value, ...d }))
});

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const form = await request.formData();
		const readingDirection = String(form.get('readingDirection') ?? '');
		if (!isReadingDirection(readingDirection)) {
			return fail(400, { error: 'Choose a reading direction.' });
		}
		try {
			updateSeries(getDb(), locals.user!.id, Number(params.id), {
				title: String(form.get('title') ?? ''),
				logline: String(form.get('logline') ?? ''),
				readingDirection
			});
		} catch (e) {
			if (e instanceof SeriesError) return fail(400, { error: e.message });
			throw e;
		}
		return { message: 'Saved.' };
	},
	addChapter: async ({ request, locals, params }) => {
		const form = await request.formData();
		const ch = createChapter(getDb(), locals.user!.id, Number(params.id), {
			title: String(form.get('title') ?? ''),
			logline: String(form.get('logline') ?? '')
		});
		redirect(303, `/series/${params.id}/chapters/${ch}/cast`);
	},
	delete: async ({ locals, params }) => {
		deleteSeries(getDb(), locals.user!.id, Number(params.id));
		redirect(303, '/');
	}
};
