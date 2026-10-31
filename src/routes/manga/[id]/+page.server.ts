import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	deleteManga,
	isReadingDirection,
	MangaError,
	READING_DIRECTIONS,
	updateManga
} from '#lib/server/mangas.js';
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
			updateManga(getDb(), locals.user!.id, Number(params.id), {
				title: String(form.get('title') ?? ''),
				logline: String(form.get('logline') ?? ''),
				readingDirection
			});
		} catch (e) {
			if (e instanceof MangaError) return fail(400, { error: e.message });
			throw e;
		}
		return { message: 'Saved.' };
	},
	delete: async ({ locals, params }) => {
		deleteManga(getDb(), locals.user!.id, Number(params.id));
		redirect(303, '/');
	}
};
