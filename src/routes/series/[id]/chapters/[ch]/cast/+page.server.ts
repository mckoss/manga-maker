import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	addToCast,
	ChapterError,
	chapterCastView,
	removeFromCast,
	useNewestDesign
} from '#lib/server/chapters.js';
import { CharacterError, createCharacter, isRole, ROLES } from '#lib/server/characters.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { series, chapter } = await parent();
	return {
		cast: chapterCastView(getDb(), locals.user!.id, series.id, chapter.id),
		roles: Object.entries(ROLES).map(([value, label]) => ({ value, label }))
	};
};

type CastChange = typeof addToCast;

/** Apply a cast change to the character named in the form. */
async function change(
	fn: CastChange,
	{
		request,
		locals,
		params
	}: { request: Request; locals: App.Locals; params: Record<string, string> }
) {
	const form = await request.formData();
	try {
		fn(
			getDb(),
			locals.user!.id,
			Number(params.id),
			Number(params.ch),
			Number(form.get('character'))
		);
	} catch (e) {
		if (e instanceof ChapterError) return fail(400, { error: e.message });
		throw e;
	}
}

export const actions: Actions = {
	add: (event) => change(addToCast, event),
	remove: (event) => change(removeFromCast, event),
	useNewest: (event) => change(useNewestDesign, event),
	create: async ({ request, locals, params }) => {
		const form = await request.formData();
		const values = {
			name: String(form.get('name') ?? ''),
			role: String(form.get('role') ?? ''),
			brief: String(form.get('brief') ?? '')
		};
		if (!isRole(values.role)) return fail(400, { ...values, error: 'Choose a role.' });
		let id: number;
		try {
			id = createCharacter(
				getDb(),
				locals.user!.id,
				Number(params.id),
				{ ...values, role: values.role },
				Number(params.ch)
			);
		} catch (e) {
			if (e instanceof CharacterError) return fail(400, { ...values, error: e.message });
			throw e;
		}
		redirect(303, `/series/${params.id}/characters/${id}`);
	}
};
