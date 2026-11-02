import { fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { IMAGE_MODELS } from '#lib/server/ai/image.js';
import {
	ownedSeries,
	seriesScope,
	seriesStyleId,
	SeriesError,
	removeStyle,
	reusableStyles,
	reuseStyle,
	startStyle
} from '#lib/server/series.js';
import {
	answerQuestions,
	COLOR_MODES,
	getStyle,
	isColorMode,
	isImageModel,
	isSubject,
	requestPictures,
	requestPrompt,
	requestQuestions,
	requestScenes,
	isTextKind,
	saveSettings,
	saveText,
	skipQuestions,
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
import { getLogo, LogoError, requestLogo, stopLogo } from '#lib/server/logos.js';
import type { Actions, PageServerLoad } from './$types';

const colorModes = Object.entries(COLOR_MODES).map(([value, m]) => ({ value, label: m.label }));
const models = Object.entries(IMAGE_MODELS).map(([value, m]) => ({ value, label: m.label }));

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	const { series } = await parent();
	const db = getDb();
	const ownerId = locals.user!.id;
	return {
		editor: series.styleId ? getStyle(db, ownerId, series.styleId) : null,
		logo: series.styleId ? getLogo(db, ownerId, series.id) : null,
		colorModes,
		models,
		reusable: series.styleId ? [] : reusableStyles(db, ownerId, Number(params.id))
	};
};

/** Run a command; expected errors become a form failure shown on the page. */
async function run(fn: () => unknown, message?: string | ((result: unknown) => string)) {
	try {
		const result = await fn();
		const text = typeof message === 'function' ? message(result) : message;
		return text ? { message: text } : undefined;
	} catch (e) {
		if (
			e instanceof StyleError ||
			e instanceof SeriesError ||
			e instanceof VersionError ||
			e instanceof LogoError
		) {
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

/**
 * The style of the series in the URL, and access to its items: the style's,
 * or with `scope=series` in the form, the series' own (its logo).
 */
function access(locals: App.Locals, params: { id: string }, form?: FormData) {
	const db = getDb();
	const ownerId = locals.user!.id;
	const seriesId = Number(params.id);
	const styleId = seriesStyleId(db, ownerId, seriesId);
	if (form?.get('scope') === 'series') {
		ownedSeries(db, ownerId, seriesId);
		return { db, styleId, access: { ownerId, scope: seriesScope(seriesId) } };
	}
	return { db, styleId, access: styleAccess(db, ownerId, styleId) };
}

const count = (n: unknown, what: string) =>
	n === 0 ? `Nothing to do: every ${what} not kept is up to date.` : '';

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
			'Style copied. Change anything you like; it only affects this series.'
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
			saveText(
				db,
				locals.user!.id,
				styleId,
				kind,
				str(form, 'key'),
				str(form, 'text'),
				form.get('keep') === 'on'
			);
		}, 'Saved.');
	},
	askQuestions: async ({ locals, params }) =>
		run(() => {
			const { db, styleId } = access(locals, params);
			requestQuestions(db, locals.user!.id, styleId);
		}),
	answerQuestions: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => {
			const { db, styleId } = access(locals, params);
			answerQuestions(
				db,
				locals.user!.id,
				styleId,
				form.getAll('answer').map((a) => String(a))
			);
		});
	},
	skipQuestions: async ({ locals, params }) =>
		run(() => {
			const { db, styleId } = access(locals, params);
			skipQuestions(db, locals.user!.id, styleId);
		}),
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
				const { db, access: a } = access(locals, params, form);
				useVersion(db, a, num(form, 'versionId'), { lock });
			},
			lock ? 'Using that version, and keeping it.' : 'Using that version.'
		);
	},
	lock: async ({ request, locals, params }) => {
		const form = await request.formData();
		const locked = form.get('locked') === 'on';
		return run(() => {
			const { db, access: a } = access(locals, params, form);
			setLocked(db, a, num(form, 'itemId'), locked);
		});
	},
	deleteVersion: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(() => {
			const { db, access: a } = access(locals, params, form);
			deleteVersion(db, a, num(form, 'versionId'));
		}, 'Version deleted.');
	},
	deleteOthers: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(
			() => {
				const { db, access: a } = access(locals, params, form);
				return deleteOtherVersions(db, a, num(form, 'itemId'));
			},
			(n) => `Deleted ${n} older version${n === 1 ? '' : 's'}.`
		);
	},
	drawLogo: async ({ request, locals, params }) => {
		const form = await request.formData();
		const raw = str(form, 'seed').trim();
		const seed = raw ? Number(raw) : null;
		return run(() => {
			if (seed !== null && !Number.isSafeInteger(seed)) {
				throw new LogoError('The seed must be a whole number.');
			}
			requestLogo(getDb(), locals.user!.id, Number(params.id), {
				guidance: str(form, 'guidance'),
				seed
			});
		}, 'Drawing the logo.');
	},
	stopLogo: async ({ locals, params }) =>
		run(() => stopLogo(getDb(), locals.user!.id, Number(params.id)), 'Stopped drawing the logo.'),
	startOver: async ({ locals, params }) =>
		run(() => removeStyle(getDb(), locals.user!.id, Number(params.id)), 'Style removed.')
};
