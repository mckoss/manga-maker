import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	CharacterError,
	chooseReference,
	deleteCharacter,
	getCharacter,
	isSheetView,
	PROFILE_FIELDS,
	requestCandidates,
	requestDevelop,
	requestSheet,
	ROLES,
	updateCharacter,
	type Profile
} from '#lib/server/characters.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	let detail;
	try {
		detail = getCharacter(getDb(), locals.user!.id, Number(params.cid));
	} catch (e) {
		if (e instanceof CharacterError) error(404, e.message);
		throw e;
	}
	if (detail.manga.id !== Number(params.id)) error(404, 'Character not found.');
	return {
		...detail,
		roles: Object.entries(ROLES).map(([value, label]) => ({ value, label }))
	};
};

/** Run a character command; CharacterErrors become a form failure shown on the page. */
async function run(fn: () => void, message?: string) {
	try {
		fn();
		return message ? { message } : undefined;
	} catch (e) {
		if (e instanceof CharacterError) return fail(400, { error: e.message });
		throw e;
	}
}

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const form = await request.formData();
		const profile = Object.fromEntries(
			PROFILE_FIELDS.map((k) => [k, String(form.get(k) ?? '')])
		) as Profile;
		return run(
			() => updateCharacter(getDb(), locals.user!.id, Number(params.cid), profile),
			'Saved.'
		);
	},
	develop: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() =>
			requestDevelop(
				getDb(),
				locals.user!.id,
				Number(params.cid),
				String(form.get('feedback') ?? '')
			)
		);
	},
	draw: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() =>
			requestCandidates(getDb(), locals.user!.id, Number(params.cid), {
				newSeed: form.get('newSeed') === 'on'
			})
		);
	},
	choose: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(
			() =>
				chooseReference(getDb(), locals.user!.id, Number(params.cid), Number(form.get('imageId'))),
			'Reference picture chosen.'
		);
	},
	sheet: async ({ request, locals, params }) => {
		const form = await request.formData();
		const view = String(form.get('view') ?? '');
		return run(() =>
			requestSheet(
				getDb(),
				locals.user!.id,
				Number(params.cid),
				isSheetView(view) ? view : undefined,
				String(form.get('guidance') ?? '')
			)
		);
	},
	delete: async ({ locals, params }) => {
		const result = await run(() => deleteCharacter(getDb(), locals.user!.id, Number(params.cid)));
		if (result) return result;
		redirect(303, `/manga/${params.id}/characters`);
	}
};
