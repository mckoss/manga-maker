import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	characterAccess,
	CharacterError,
	chooseReference,
	deleteCharacter,
	getCharacter,
	isDesignKey,
	isProfileKind,
	isSheetView,
	isTextKind,
	requestDesigns,
	requestPictures,
	requestProfile,
	requestSheet,
	ROLES,
	saveDesign,
	saveText,
	STAGES,
	syncCharacter,
	updateOutdated,
	type Stage
} from '#lib/server/characters.js';
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

/** Run a command; expected errors become a form failure shown on the page. */
async function run(fn: () => unknown, message?: string | ((result: unknown) => string)) {
	try {
		const result = fn();
		const text = typeof message === 'function' ? message(result) : message;
		return text ? { message: text } : undefined;
	} catch (e) {
		if (e instanceof CharacterError || e instanceof VersionError) {
			return fail(400, { error: e.message });
		}
		throw e;
	}
}

const str = (form: FormData, key: string) => String(form.get(key) ?? '');
const ctx = (locals: App.Locals, params: { cid: string }) => ({
	db: getDb(),
	ownerId: locals.user!.id,
	id: Number(params.cid)
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
						outfit: str(form, 'outfit')
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
			requestPictures(db, ownerId, id, { keys: isDesignKey(key) ? [key] : undefined })
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
			requestSheet(db, ownerId, id, isSheetView(view) ? view : undefined, str(form, 'guidance'))
		);
	},
	// Version browsing (VersionNav). The name and role are copied to the
	// character row whenever their current version changes.
	useVersion: async ({ request, locals, params }) => {
		const form = await request.formData();
		const { db, ownerId, id } = ctx(locals, params);
		return run(() => {
			useVersion(db, characterAccess(db, ownerId, id), Number(form.get('versionId')), {
				lock: form.get('lock') === 'on'
			});
			syncCharacter(db, id);
		});
	},
	lock: async ({ request, locals, params }) => {
		const form = await request.formData();
		const { db, ownerId, id } = ctx(locals, params);
		return run(() =>
			setLocked(
				db,
				characterAccess(db, ownerId, id),
				Number(form.get('itemId')),
				form.get('locked') === 'on'
			)
		);
	},
	deleteVersion: async ({ request, locals, params }) => {
		const form = await request.formData();
		const { db, ownerId, id } = ctx(locals, params);
		return run(() => {
			deleteVersion(db, characterAccess(db, ownerId, id), Number(form.get('versionId')));
			syncCharacter(db, id);
		});
	},
	deleteOthers: async ({ request, locals, params }) => {
		const form = await request.formData();
		const { db, ownerId, id } = ctx(locals, params);
		return run(
			() => deleteOtherVersions(db, characterAccess(db, ownerId, id), Number(form.get('itemId'))),
			(n) => `Deleted ${n} older version${n === 1 ? '' : 's'}.`
		);
	},
	delete: async ({ locals, params }) => {
		const { db, ownerId, id } = ctx(locals, params);
		const result = await run(() => deleteCharacter(db, ownerId, id));
		if (result) return result;
		redirect(303, `/series/${params.id}/characters`);
	}
};
