import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	CharacterError,
	createCharacter,
	isRole,
	listCharacters,
	readyStyle,
	ROLES
} from '#lib/server/characters.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { series } = await parent();
	const db = getDb();
	return {
		cast: listCharacters(db, locals.user!.id, series.id),
		roles: Object.entries(ROLES).map(([value, label]) => ({ value, label })),
		styleReady: Boolean(readyStyle(db, series))
	};
};

export const actions: Actions = {
	add: async ({ request, locals, params }) => {
		const form = await request.formData();
		const values = {
			name: String(form.get('name') ?? ''),
			role: String(form.get('role') ?? ''),
			brief: String(form.get('brief') ?? '')
		};
		if (!isRole(values.role)) return fail(400, { ...values, error: 'Choose a role.' });
		let id: number;
		try {
			id = createCharacter(getDb(), locals.user!.id, Number(params.id), {
				...values,
				role: values.role
			});
		} catch (e) {
			if (e instanceof CharacterError) return fail(400, { ...values, error: e.message });
			throw e;
		}
		redirect(303, `/series/${params.id}/characters/${id}`);
	}
};
