import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { IMAGE_MODELS } from '#lib/server/ai/image.js';
import {
	COLOR_MODES,
	createStyle,
	isColorMode,
	isImageModel,
	StyleError
} from '#lib/server/styles.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	colorModes: Object.entries(COLOR_MODES).map(([value, m]) => ({ value, label: m.label })),
	models: Object.entries(IMAGE_MODELS).map(([value, m]) => ({ value, label: m.label }))
});

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const values = {
			name: String(form.get('name') ?? ''),
			description: String(form.get('description') ?? ''),
			colorMode: String(form.get('colorMode') ?? ''),
			model: String(form.get('model') ?? '')
		};
		if (!isColorMode(values.colorMode) || !isImageModel(values.model)) {
			return fail(400, { ...values, error: 'Choose a colour mode and a model.' });
		}
		let id: number;
		try {
			id = createStyle(getDb(), locals.user!.id, {
				...values,
				colorMode: values.colorMode,
				model: values.model
			});
		} catch (e) {
			if (e instanceof StyleError) return fail(400, { ...values, error: e.message });
			throw e;
		}
		redirect(303, `/styles/${id}`);
	}
};
