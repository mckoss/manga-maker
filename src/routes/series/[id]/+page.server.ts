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
import {
	seriesAvoid,
	setSeriesAvoid,
	setSeriesImageModel,
	userImageModel
} from '#lib/server/models.js';
import { IMAGE_MODELS, isImageModel } from '#lib/models.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => ({
	directions: Object.entries(READING_DIRECTIONS).map(([value, d]) => ({ value, ...d })),
	userImageModel: IMAGE_MODELS[userImageModel(getDb(), locals.user!.id)].label,
	avoid: seriesAvoid((await parent()).series)
});

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const form = await request.formData();
		const readingDirection = String(form.get('readingDirection') ?? '');
		if (!isReadingDirection(readingDirection)) {
			return fail(400, { error: 'Choose a reading direction.' });
		}
		const imageModel = String(form.get('imageModel') ?? '');
		try {
			const db = getDb();
			updateSeries(db, locals.user!.id, Number(params.id), {
				title: String(form.get('title') ?? ''),
				logline: String(form.get('logline') ?? ''),
				readingDirection
			});
			// updateSeries checked the owner. Empty goes back to the user's default.
			setSeriesImageModel(db, Number(params.id), isImageModel(imageModel) ? imageModel : null);
			setSeriesAvoid(db, Number(params.id), String(form.get('avoid') ?? ''));
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
