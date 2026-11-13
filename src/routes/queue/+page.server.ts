import { fail } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import {
	clearLane,
	getQueue,
	pause,
	QueueError,
	resume,
	setLane,
	setModel,
	stop,
	type Viewer
} from '#lib/server/queue.js';
import type { Actions, PageServerLoad } from './$types';

const viewerOf = (locals: App.Locals): Viewer => ({
	id: locals.user!.id,
	isAdmin: locals.user!.isAdmin
});

export const load: PageServerLoad = ({ locals }) => ({
	queue: getQueue(getDb(), viewerOf(locals))
});

/** Run a queue command, turning a QueueError into a form error. */
async function command(
	request: Request,
	locals: App.Locals,
	run: (viewer: Viewer, form: FormData) => void
) {
	const form = await request.formData();
	try {
		run(viewerOf(locals), form);
	} catch (e) {
		if (e instanceof QueueError) return fail(400, { error: e.message });
		throw e;
	}
}

const jobId = (form: FormData) => Number(form.get('id'));
const laneOf = (form: FormData) => {
	const lane = String(form.get('lane') ?? '');
	if (lane !== 'text' && lane !== 'image') throw new QueueError('Unknown lane.');
	return lane;
};

export const actions: Actions = {
	pause: ({ request, locals }) => command(request, locals, (v, f) => pause(getDb(), v, jobId(f))),
	resume: ({ request, locals }) => command(request, locals, (v, f) => resume(getDb(), v, jobId(f))),
	stop: ({ request, locals }) => command(request, locals, (v, f) => stop(getDb(), v, jobId(f))),
	clearLane: ({ request, locals }) =>
		command(request, locals, (v, f) => {
			clearLane(getDb(), v, laneOf(f));
		}),
	setModel: ({ request, locals }) =>
		command(request, locals, (v, f) =>
			setModel(getDb(), v, jobId(f), String(f.get('model') ?? ''))
		),
	setLane: ({ request, locals }) =>
		command(request, locals, (v, f) =>
			setLane(getDb(), v, String(f.get('lane') ?? ''), f.get('paused') === 'true')
		)
};
