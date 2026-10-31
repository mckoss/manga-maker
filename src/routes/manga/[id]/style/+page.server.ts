import { fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { IMAGE_MODELS } from '#lib/server/ai/image.js';
import {
	mangaStyleId,
	MangaError,
	removeStyle,
	reusableStyles,
	reuseStyle,
	startStyle
} from '#lib/server/mangas.js';
import {
	COLOR_MODES,
	getStyle,
	isColorMode,
	isImageModel,
	isSubject,
	requestPictures,
	requestPrompt,
	requestScenes,
	isTextKind,
	saveSettings,
	saveText,
	styleAccess,
	StyleError,
	type Which
} from '#lib/server/styles.js';
import {
	deleteOtherVersions,
	deleteVersion,
	setLocked,
	useVersion,
	VersionError
} from '#lib/server/versions.js';
import type { Actions, PageServerLoad } from './$types';

const colorModes = Object.entries(COLOR_MODES).map(([value, m]) => ({ value, label: m.label }));
const models = Object.entries(IMAGE_MODELS).map(([value, m]) => ({ value, label: m.label }));

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	const { manga } = await parent();
	const db = getDb();
	const ownerId = locals.user!.id;
	return {
		editor: manga.styleId ? getStyle(db, ownerId, manga.styleId) : null,
		colorModes,
		models,
		reusable: manga.styleId ? [] : reusableStyles(db, ownerId, Number(params.id))
	};
};

/** Run a command; expected errors become a form failure shown on the page. */
async function run(fn: () => unknown, message?: string | ((result: unknown) => string)) {
	try {
		const result = await fn();
		const text = typeof message === 'function' ? message(result) : message;
		return text ? { message: text } : undefined;
	} catch (e) {
		if (e instanceof StyleError || e instanceof MangaError || e instanceof VersionError) {
			return fail(400, { error: e.message });
		}
		throw e;
	}
}

const num = (form: FormData, key: string) => Number(form.get(key));
const str = (form: FormData, key: string) => String(form.get(key) ?? '');

function which(form: FormData): Which {
	const value = str(form, 'which');
	if (value === 'all' || value === 'outdated' || isSubject(value)) return value;
	throw new StyleError('Choose what to regenerate.');
}

/** The style of the manga in the URL, and access to its items. */
function access(locals: App.Locals, params: { id: string }) {
	const db = getDb();
	const styleId = mangaStyleId(db, locals.user!.id, Number(params.id));
	return { db, styleId, access: styleAccess(db, locals.user!.id, styleId) };
}

const count = (n: unknown, what: string) =>
	n === 0 ? `Nothing to do: every unlocked ${what} is up to date.` : '';

export const actions: Actions = {
	start: async ({ request, locals, params }) => {
		const form = await request.formData();
		const colorMode = str(form, 'colorMode');
		const model = str(form, 'model');
		if (!isColorMode(colorMode) || !isImageModel(model)) {
			return fail(400, { error: 'Choose a color mode and a model.' });
		}
		return run(() =>
			startStyle(getDb(), locals.user!.id, Number(params.id), {
				description: str(form, 'description'),
				colorMode,
				model
			})
		);
	},
	reuse: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(
			() => reuseStyle(getDb(), locals.user!.id, Number(params.id), num(form, 'styleId')),
			'Style copied. Change anything you like; it only affects this manga.'
		);
	},
	saveSettings: async ({ request, locals, params }) => {
		const form = await request.formData();
		const colorMode = str(form, 'colorMode');
		const model = str(form, 'model');
		if (!isColorMode(colorMode) || !isImageModel(model)) {
			return fail(400, { error: 'Choose a color mode and a model.' });
		}
		return run(() => {
			const { db, styleId } = access(locals, params);
			saveSettings(db, locals.user!.id, styleId, { colorMode, model });
		}, 'Saved.');
	},
	saveText: async ({ request, locals, params }) => {
		const form = await request.formData();
		const kind = str(form, 'kind');
		if (!isTextKind(kind)) return fail(400, { error: 'Unknown item.' });
		return run(() => {
			const { db, styleId } = access(locals, params);
			saveText(db, locals.user!.id, styleId, kind, str(form, 'key'), str(form, 'text'));
		}, 'Saved.');
	},
	writePrompt: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => {
			const { db, styleId } = access(locals, params);
			requestPrompt(db, locals.user!.id, styleId, str(form, 'guidance'));
		});
	},
	writeScenes: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(
			() => {
				const { db, styleId } = access(locals, params);
				return requestScenes(db, locals.user!.id, styleId, which(form), str(form, 'guidance'));
			},
			(n) => count(n, 'scene')
		);
	},
	drawPictures: async ({ request, locals, params }) => {
		const form = await request.formData();
		const seed = form.get('seed') ? Number(form.get('seed')) : undefined;
		return run(
			() => {
				const { db, styleId } = access(locals, params);
				if (seed !== undefined && !Number.isSafeInteger(seed)) {
					throw new StyleError('The seed must be a whole number.');
				}
				return requestPictures(db, locals.user!.id, styleId, which(form), {
					seed,
					guidance: str(form, 'guidance')
				});
			},
			(n) => count(n, 'picture')
		);
	},
	useVersion: async ({ request, locals, params }) => {
		const form = await request.formData();
		const lock = form.get('lock') === 'on';
		return run(
			() => {
				const { db, access: a } = access(locals, params);
				useVersion(db, a, num(form, 'versionId'), { lock });
			},
			lock ? 'Using that version, locked.' : 'Using that version.'
		);
	},
	lock: async ({ request, locals, params }) => {
		const form = await request.formData();
		const locked = form.get('locked') === 'on';
		return run(() => {
			const { db, access: a } = access(locals, params);
			setLocked(db, a, num(form, 'itemId'), locked);
		});
	},
	deleteVersion: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => {
			const { db, access: a } = access(locals, params);
			deleteVersion(db, a, num(form, 'versionId'));
		}, 'Version deleted.');
	},
	deleteOthers: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(
			() => {
				const { db, access: a } = access(locals, params);
				return deleteOtherVersions(db, a, num(form, 'itemId'));
			},
			(n) => `Deleted ${n} older version${n === 1 ? '' : 's'}.`
		);
	},
	startOver: async ({ locals, params }) =>
		run(() => removeStyle(getDb(), locals.user!.id, Number(params.id)), 'Style removed.')
};
