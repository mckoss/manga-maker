import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	locationAccess,
	LocationError,
	chooseReference,
	deleteLocation,
	getLocation,
	isDesignKey,
	isProfileKind,
	isSheetView,
	isTextKind,
	requestDesigns,
	requestPictures,
	requestProfile,
	requestSheet,
	stopSheet,
	saveDesign,
	setDefaultLocation,
	saveText,
	STAGES,
	syncLocation,
	updateOutdated,
	type Stage
} from '#lib/server/locations.js';
import {
	deleteOtherVersions,
	deleteVersion,
	setLocked,
	useVersion,
	VersionError
} from '#lib/server/versions.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	let detail;
	try {
		detail = getLocation(getDb(), locals.user!.id, Number(params.lid));
	} catch (e) {
		if (e instanceof LocationError) error(404, e.message);
		throw e;
	}
	if (detail.series.id !== Number(params.id)) error(404, 'Location not found.');
	return detail;
};

/** Run a command; expected errors become a form failure shown on the page. */
/** The seed the user typed, if any; a bad one is an error. */
function seedOf(form: FormData): number | null {
	const raw = String(form.get('seed') ?? '').trim();
	if (!raw) return null;
	const seed = Number(raw);
	if (!Number.isSafeInteger(seed) || seed < 0)
		throw new LocationError('The seed must be a whole number.');
	return seed;
}

async function run(fn: () => unknown, message?: string | ((result: unknown) => string)) {
	try {
		const result = fn();
		const text = typeof message === 'function' ? message(result) : message;
		return text ? { message: text } : undefined;
	} catch (e) {
		if (e instanceof LocationError || e instanceof VersionError) {
			return fail(400, { error: e.message });
		}
		throw e;
	}
}

const str = (form: FormData, key: string) => String(form.get(key) ?? '');
const ctx = (locals: App.Locals, params: { lid: string }) => ({
	db: getDb(),
	ownerId: locals.user!.id,
	id: Number(params.lid)
});

const started = (what: string) => (n: unknown) =>
	n === 0 ? `Nothing to do: every ${what} not kept is up to date.` : '';

export const actions: Actions = {
	saveText: async ({ request, locals, params }) => {
		const form = await request.formData();
		const kind = str(form, 'kind');
		if (!isTextKind(kind)) return fail(400, { error: 'Unknown field.' });
		const { db, ownerId, id } = ctx(locals, params);
		return run(
			() => saveText(db, ownerId, id, kind, str(form, 'text'), form.get('keep') === 'on'),
			'Saved.'
		);
	},
	saveDesign: async ({ request, locals, params }) => {
		const form = await request.formData();
		const { db, ownerId, id } = ctx(locals, params);
		return run(
			() =>
				saveDesign(
					db,
					ownerId,
					id,
					str(form, 'key'),
					{
						label: str(form, 'label'),
						appearance: str(form, 'appearance'),
						details: str(form, 'details')
					},
					form.get('keep') === 'on'
				),
			'Design saved.'
		);
	},
	update: async ({ request, locals, params }) => {
		const form = await request.formData();
		const stage = str(form, 'stage');
		const stages: Stage[] = (STAGES as readonly string[]).includes(stage)
			? [stage as Stage]
			: [...STAGES];
		const { db, ownerId, id } = ctx(locals, params);
		return run(() => updateOutdated(db, ownerId, id, stages), started('item'));
	},
	rewriteProfile: async ({ request, locals, params }) => {
		const form = await request.formData();
		const kind = str(form, 'which');
		const { db, ownerId, id } = ctx(locals, params);
		return run(() =>
			requestProfile(db, ownerId, id, {
				kinds: isProfileKind(kind) ? [kind] : undefined,
				guidance: str(form, 'guidance')
			})
		);
	},
	writeDesigns: async ({ request, locals, params }) => {
		const form = await request.formData();
		const key = str(form, 'which');
		const { db, ownerId, id } = ctx(locals, params);
		return run(() =>
			requestDesigns(db, ownerId, id, {
				keys: isDesignKey(key) ? [key] : undefined,
				guidance: str(form, 'guidance')
			})
		);
	},
	drawPictures: async ({ request, locals, params }) => {
		const form = await request.formData();
		const key = str(form, 'which');
		const { db, ownerId, id } = ctx(locals, params);
		return run(() =>
			requestPictures(db, ownerId, id, {
				keys: isDesignKey(key) ? [key] : undefined,
				guidance: str(form, 'guidance'),
				seed: seedOf(form)
			})
		);
	},
	choose: async ({ request, locals, params }) => {
		const form = await request.formData();
		const { db, ownerId, id } = ctx(locals, params);
		return run(
			() => chooseReference(db, ownerId, id, Number(form.get('versionId'))),
			'Reference picture chosen.'
		);
	},
	sheet: async ({ request, locals, params }) => {
		const form = await request.formData();
		const view = str(form, 'view');
		const { db, ownerId, id } = ctx(locals, params);
		return run(() =>
			requestSheet(
				db,
				ownerId,
				id,
				isSheetView(view) ? view : undefined,
				str(form, 'guidance'),
				seedOf(form)
			)
		);
	},
	stopSheet: async ({ locals, params }) => {
		const { db, ownerId, id } = ctx(locals, params);
		return run(() => stopSheet(db, ownerId, id), 'Stopped generating the sheet.');
	},
	// Version browsing (VersionNav). The name is copied to the
	// location row whenever their current version changes.
	useVersion: async ({ request, locals, params }) => {
		const form = await request.formData();
		const { db, ownerId, id } = ctx(locals, params);
		return run(() => {
			useVersion(db, locationAccess(db, ownerId, id), Number(form.get('versionId')), {
				lock: form.get('lock') === 'on'
			});
			syncLocation(db, id);
		});
	},
	lock: async ({ request, locals, params }) => {
		const form = await request.formData();
		const { db, ownerId, id } = ctx(locals, params);
		return run(() =>
			setLocked(
				db,
				locationAccess(db, ownerId, id),
				Number(form.get('itemId')),
				form.get('locked') === 'on'
			)
		);
	},
	deleteVersion: async ({ request, locals, params }) => {
		const form = await request.formData();
		const { db, ownerId, id } = ctx(locals, params);
		return run(() => {
			deleteVersion(db, locationAccess(db, ownerId, id), Number(form.get('versionId')));
			syncLocation(db, id);
		});
	},
	deleteOthers: async ({ request, locals, params }) => {
		const form = await request.formData();
		const { db, ownerId, id } = ctx(locals, params);
		return run(
			() => deleteOtherVersions(db, locationAccess(db, ownerId, id), Number(form.get('itemId'))),
			(n) => `Deleted ${n} older version${n === 1 ? '' : 's'}.`
		);
	},
	makeDefault: async ({ locals, params }) => {
		const { db, ownerId, id } = ctx(locals, params);
		return run(
			() => setDefaultLocation(db, ownerId, id),
			'This is now the default location for the series.'
		);
	},
	delete: async ({ locals, params }) => {
		const { db, ownerId, id } = ctx(locals, params);
		const result = await run(() => deleteLocation(db, ownerId, id));
		if (result) return result;
		redirect(303, `/series/${params.id}/locations`);
	}
};
