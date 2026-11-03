import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { readyStyle } from '#lib/server/characters.js';
import {
	createLocation,
	listLocations,
	LocationError,
	setDefaultLocation
} from '#lib/server/locations.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, parent }) => {
	const { series } = await parent();
	const db = getDb();
	return {
		places: listLocations(db, locals.user!.id, series.id),
		styleReady: Boolean(readyStyle(db, series))
	};
};

export const actions: Actions = {
	add: async ({ request, locals, params }) => {
		const form = await request.formData();
		const values = {
			name: String(form.get('name') ?? ''),
			brief: String(form.get('brief') ?? '')
		};
		let id: number;
		try {
			id = createLocation(getDb(), locals.user!.id, Number(params.id), values);
		} catch (e) {
			if (e instanceof LocationError) return fail(400, { ...values, error: e.message });
			throw e;
		}
		redirect(303, `/series/${params.id}/locations/${id}`);
	},
	makeDefault: async ({ request, locals }) => {
		const form = await request.formData();
		try {
			setDefaultLocation(getDb(), locals.user!.id, Number(form.get('locationId')));
		} catch (e) {
			if (e instanceof LocationError) return fail(400, { error: e.message });
			throw e;
		}
	}
};
