import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	CharacterError,
	chooseReference,
	deleteCharacter,
	drawDesign,
	getCharacter,
	isSheetView,
	PROFILE_FIELDS,
	requestCandidates,
	requestDesigns,
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
	if (detail.series.id !== Number(params.id)) error(404, 'Character not found.');
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
		try {
			const { redesigned } = updateCharacter(getDb(), locals.user!.id, Number(params.cid), profile);
			return {
				saved: redesigned
					? 'Saved. The look changed, so the AI is writing new design options.'
					: 'Saved.'
			};
		} catch (e) {
			if (e instanceof CharacterError) return fail(400, { saveError: e.message });
			throw e;
		}
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
	draw: async ({ locals, params }) =>
		run(() => requestCandidates(getDb(), locals.user!.id, Number(params.cid))),
	designs: async ({ locals, params }) =>
		run(() => requestDesigns(getDb(), locals.user!.id, Number(params.cid))),
	drawDesign: async ({ request, locals, params }) => {
		const form = await request.formData();
		const imageId = Number(form.get('imageId'));
		try {
			drawDesign(getDb(), locals.user!.id, Number(params.cid), imageId, {
				variant: String(form.get('variant') ?? ''),
				appearance: String(form.get('appearance') ?? ''),
				outfit: String(form.get('outfit') ?? '')
			});
		} catch (e) {
			if (e instanceof CharacterError) return fail(400, { designError: e.message, imageId });
			throw e;
		}
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
		redirect(303, `/series/${params.id}/characters`);
	}
};
