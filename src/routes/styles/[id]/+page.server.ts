import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { IMAGE_MODELS } from '#lib/server/ai/image.js';
import {
	approveDraft,
	COLOR_MODES,
	compilePrompt,
	deleteStyle,
	discardDraft,
	getStyle,
	isColorMode,
	isImageModel,
	readyToApprove,
	renameStyle,
	requestRefine,
	requestSamples,
	SAMPLE_SUBJECTS,
	startRevision,
	StyleError,
	updateDraft
} from '#lib/server/styles.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	let detail;
	try {
		detail = getStyle(getDb(), locals.user!.id, Number(params.id));
	} catch (e) {
		if (e instanceof StyleError) error(404, e.message);
		throw e;
	}
	const { draft, samples } = detail;
	/** Samples for a version in subject order, flagging ones made from an older prompt. */
	const sampleRow = (versionId: number | undefined) =>
		SAMPLE_SUBJECTS.map((subject) => {
			const sample = samples.find((s) => s.versionId === versionId && s.subject === subject.key);
			const version = versionId === draft?.id ? draft : undefined;
			return {
				subject: subject.key,
				label: subject.label,
				sample: sample ?? null,
				stale: Boolean(
					sample && version && sample.prompt !== compilePrompt(version, subject.prompt)
				)
			};
		});
	return {
		...detail,
		colorModes: Object.entries(COLOR_MODES).map(([value, m]) => ({ value, label: m.label })),
		models: Object.entries(IMAGE_MODELS).map(([value, m]) => ({ value, label: m.label })),
		activeSamples: sampleRow(detail.active?.id),
		draftSamples: sampleRow(draft?.id),
		historySamples: Object.fromEntries(detail.history.map((v) => [v.id, sampleRow(v.id)])),
		canApprove: draft ? readyToApprove(draft, samples) : false,
		colorLabels: Object.fromEntries(Object.entries(COLOR_MODES).map(([k, m]) => [k, m.label]))
	};
};

/** Run a style command; StyleErrors become a form failure shown on the page. */
async function run(fn: () => void | Promise<void>, message?: string) {
	try {
		await fn();
		return message ? { message } : undefined;
	} catch (e) {
		if (e instanceof StyleError) return fail(400, { error: e.message });
		throw e;
	}
}

const num = (form: FormData, key: string) => Number(form.get(key));
const str = (form: FormData, key: string) => String(form.get(key) ?? '');

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const colorMode = str(form, 'colorMode');
		const model = str(form, 'model');
		if (!isColorMode(colorMode) || !isImageModel(model)) {
			return fail(400, { error: 'Choose a colour mode and a model.' });
		}
		return run(
			() =>
				updateDraft(getDb(), locals.user!.id, num(form, 'versionId'), {
					description: str(form, 'description'),
					prompt: str(form, 'prompt'),
					negativePrompt: str(form, 'negativePrompt'),
					colorMode,
					model
				}),
			'Draft saved.'
		);
	},
	refine: async ({ request, locals }) => {
		const form = await request.formData();
		return run(() =>
			requestRefine(getDb(), locals.user!.id, num(form, 'versionId'), str(form, 'feedback'))
		);
	},
	samples: async ({ request, locals }) => {
		const form = await request.formData();
		return run(() =>
			requestSamples(getDb(), locals.user!.id, num(form, 'versionId'), {
				newSeed: form.get('newSeed') === 'on'
			})
		);
	},
	approve: async ({ request, locals }) => {
		const form = await request.formData();
		return run(
			() => approveDraft(getDb(), locals.user!.id, num(form, 'versionId')),
			'Approved. This is now the style used for new work.'
		);
	},
	revise: async ({ request, locals, params }) => {
		const form = await request.formData();
		const from = form.get('fromVersionId');
		return run(() => {
			startRevision(getDb(), locals.user!.id, Number(params.id), from ? Number(from) : undefined);
		});
	},
	discard: async ({ request, locals }) => {
		const form = await request.formData();
		return run(
			() => discardDraft(getDb(), locals.user!.id, num(form, 'versionId')),
			'Draft discarded.'
		);
	},
	rename: async ({ request, locals, params }) => {
		const form = await request.formData();
		return run(
			() => renameStyle(getDb(), locals.user!.id, Number(params.id), str(form, 'name')),
			'Renamed.'
		);
	},
	delete: async ({ locals, params }) => {
		const result = await run(() => deleteStyle(getDb(), locals.user!.id, Number(params.id)));
		if (result) return result;
		redirect(303, '/styles');
	}
};
