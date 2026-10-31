import { redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { deleteChapter, updateChapter } from '#lib/server/chapters.js';
import type { Actions } from './$types';

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const form = await request.formData();
		updateChapter(getDb(), locals.user!.id, Number(params.id), Number(params.ch), {
			title: String(form.get('title') ?? ''),
			logline: String(form.get('logline') ?? '')
		});
		return { message: 'Saved.' };
	},
	delete: async ({ locals, params }) => {
		deleteChapter(getDb(), locals.user!.id, Number(params.id), Number(params.ch));
		redirect(303, `/series/${params.id}`);
	}
};
