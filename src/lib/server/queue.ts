/**
 * The job queue as the user sees it: each lane's running job and what waits
 * behind it, recent results, and the controls to pause, resume or stop a
 * job, change a waiting picture's model, or (admins) pause a whole lane.
 *
 * A user sees and controls their own jobs; other users' jobs show only as
 * "Another user's job", so the wait is honest. An admin controls them all.
 */
import { and, desc, eq, inArray, notInArray, or } from 'drizzle-orm';
import type { Db } from './db';
import {
	chapters,
	characters,
	items,
	jobs,
	locations,
	series,
	users,
	versions,
	type Job,
	type JobLane,
	type JobStatus
} from './db/schema';
import {
	blockersOf,
	cancelJobs,
	lanePaused,
	laneOf,
	LANES,
	pauseJob,
	resumeJob,
	setLanePaused
} from './jobs';
import { parseScope } from './pipeline/ids';
import { IMAGE_MODELS, isImageModel, type ImageModelId } from '#lib/models.js';

export class QueueError extends Error {}

export interface Viewer {
	id: number;
	isAdmin: boolean;
}

/** What each kind of job makes, in a few words. */
const KIND_LABELS: Record<string, string> = {
	'style.prompt': 'Style prompt',
	'style.scenes': 'Sample scenes',
	'style.picture': 'Sample picture',
	'style.questions': 'Questions about the style',
	'style.fold': 'Folding in your answers',
	'character.develop': 'Character profile',
	'character.designs': 'Design options',
	'character.picture': 'Design picture',
	'character.sheet': 'Character sheet',
	'location.develop': 'Location profile',
	'location.designs': 'Location design options',
	'location.picture': 'Location picture',
	'location.sheet': 'Location sheet',
	'series.logo': 'Series logo',
	'plot.structure': 'Plot structure',
	'plot.elements': 'Story elements',
	'plot.beats': 'Beat outline',
	'plot.review': 'Editor’s review',
	'plot.questions': 'Questions about the chapter',
	'plot.fold': 'Folding in your answers',
	'script.layout': 'Laying out a beat',
	'script.fill': 'Filling in a page'
};

export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

export interface JobView {
	id: number;
	kind: string;
	label: string;
	lane: JobLane;
	status: JobStatus;
	createdAt: Date;
	startedAt: Date | null;
	finishedAt: Date | null;
	error: string | null;
	/** The viewer's own job (or any job, for an admin): details and controls shown. */
	mine: boolean;
	/** Whose job it is, for an admin looking at another user's. */
	owner: string | null;
	/** What it is making and where to see it, when known. */
	what: { title: string; href: string } | null;
	/** How many items it is making. */
	count: number;
	/** A picture's image model (the first of its pictures), when it has one. */
	model: ImageModelId | null;
	/** Older jobs in the other lane it waits for (ids). */
	waitingOn: number[];
}

export interface LaneView {
	lane: JobLane;
	label: string;
	paused: boolean;
	running: JobView | null;
	/** Queued and paused jobs, in the order they will run. */
	waiting: JobView[];
}

export interface QueueView {
	lanes: LaneView[];
	/** The viewer's jobs that finished, failed or were stopped, newest first. */
	recent: JobView[];
	/** The image models a waiting picture can switch to. */
	models: { id: ImageModelId; label: string }[];
	isAdmin: boolean;
	/** Some job is waiting or running: the page polls. */
	busy: boolean;
}

const ACTIVE: JobStatus[] = ['queued', 'paused', 'running'];
const LANE_LABELS: Record<JobLane, string> = {
	text: 'Writing (text model)',
	image: 'Drawing (image model)'
};

/** Where a scope's items are seen, and what to call them. */
function describeScopeOf(db: Db, scope: string): { title: string; href: string } | null {
	let ref;
	try {
		ref = parseScope(scope);
	} catch {
		return null;
	}
	switch (ref.kind) {
		case 'character': {
			const c = db.select().from(characters).where(eq(characters.id, ref.id)).get();
			return c
				? {
						title: c.name || 'Unnamed character',
						href: `/series/${c.seriesId}/characters/${c.id}`
					}
				: null;
		}
		case 'location': {
			const l = db.select().from(locations).where(eq(locations.id, ref.id)).get();
			return l
				? { title: l.name || 'Unnamed place', href: `/series/${l.seriesId}/locations/${l.id}` }
				: null;
		}
		case 'style': {
			const s = db.select().from(series).where(eq(series.styleId, ref.id)).get();
			return s ? { title: `${s.title}: style`, href: `/series/${s.id}/style` } : null;
		}
		case 'series': {
			const s = db.select().from(series).where(eq(series.id, ref.id)).get();
			return s ? { title: s.title, href: `/series/${s.id}` } : null;
		}
		case 'chapter':
		case 'script': {
			const c = db.select().from(chapters).where(eq(chapters.id, ref.id)).get();
			if (!c) return null;
			const name = c.title || `Chapter ${c.number}`;
			const step = ref.kind === 'chapter' ? 'plot' : 'script';
			return {
				title: `${name}: ${step}`,
				href: `/series/${c.seriesId}/chapters/${c.id}/${step}`
			};
		}
	}
}

function view(db: Db, job: Job, viewer: Viewer, names: Map<number, string>): JobView {
	const mine = job.userId === viewer.id || viewer.isAdmin;
	const made = mine
		? db
				.select({ scope: items.scope, model: versions.model })
				.from(versions)
				.innerJoin(items, eq(versions.itemId, items.id))
				.where(eq(versions.jobId, job.id))
				.all()
		: [];
	const scope = made[0]?.scope;
	const model = made.map((m) => m.model).find(isImageModel) ?? null;
	return {
		id: job.id,
		kind: mine ? job.kind : '',
		label: mine ? kindLabel(job.kind) : 'Another user’s job',
		lane: laneOf(job.kind),
		status: job.status,
		createdAt: job.createdAt,
		startedAt: job.startedAt,
		finishedAt: job.finishedAt,
		error: mine ? job.error : null,
		mine,
		owner: viewer.isAdmin && job.userId !== viewer.id ? (names.get(job.userId) ?? null) : null,
		what: scope ? describeScopeOf(db, scope) : null,
		count: made.length,
		model: laneOf(job.kind) === 'image' ? model : null,
		waitingOn: job.status === 'running' ? [] : blockersOf(db, job)
	};
}

export function getQueue(db: Db, viewer: Viewer): QueueView {
	const names = new Map(
		db
			.select({ id: users.id, name: users.username })
			.from(users)
			.all()
			.map((u) => [u.id, u.name])
	);
	const active = db
		.select()
		.from(jobs)
		.where(inArray(jobs.status, ACTIVE))
		.orderBy(jobs.id)
		.all()
		.map((j) => view(db, j, viewer, names));
	const recent = db
		.select()
		.from(jobs)
		.where(
			and(notInArray(jobs.status, ACTIVE), viewer.isAdmin ? undefined : eq(jobs.userId, viewer.id))
		)
		.orderBy(desc(jobs.id))
		.limit(20)
		.all()
		.map((j) => view(db, j, viewer, names));
	return {
		lanes: LANES.map((lane) => {
			const mine = active.filter((j) => j.lane === lane);
			return {
				lane,
				label: LANE_LABELS[lane],
				paused: lanePaused(db, lane),
				running: mine.find((j) => j.status === 'running') ?? null,
				waiting: mine.filter((j) => j.status !== 'running')
			};
		}),
		recent,
		models: (Object.keys(IMAGE_MODELS) as ImageModelId[]).map((id) => ({
			id,
			label: IMAGE_MODELS[id].label
		})),
		isAdmin: viewer.isAdmin,
		busy: active.length > 0
	};
}

/** How many of the viewer's jobs are waiting or running (for the header). */
export function activeCount(db: Db, viewer: Viewer): number {
	return db
		.select({ id: jobs.id })
		.from(jobs)
		.where(and(inArray(jobs.status, ACTIVE), eq(jobs.userId, viewer.id)))
		.all().length;
}

/** A job the viewer may control: their own, or any for an admin. */
function ownJob(db: Db, viewer: Viewer, id: number): Job {
	const job = db.select().from(jobs).where(eq(jobs.id, id)).get();
	if (!job || (job.userId !== viewer.id && !viewer.isAdmin)) throw new QueueError('Not found.');
	return job;
}

export function pause(db: Db, viewer: Viewer, id: number): void {
	ownJob(db, viewer, id);
	if (!pauseJob(db, id)) throw new QueueError('Only a waiting or running job can be paused.');
}

export function resume(db: Db, viewer: Viewer, id: number): void {
	ownJob(db, viewer, id);
	if (!resumeJob(db, id)) throw new QueueError('Only a paused job can be resumed.');
}

/** Stop a job for good: it won't run, and what it was making is left as it was. */
export function stop(db: Db, viewer: Viewer, id: number): void {
	const job = ownJob(db, viewer, id);
	if (!ACTIVE.includes(job.status)) throw new QueueError('It has already finished.');
	cancelJobs(db, [id]);
}

/** Stop every waiting or paused job of the viewer's in a lane (the running one keeps going). */
export function clearLane(db: Db, viewer: Viewer, lane: JobLane): number {
	const ids = db
		.select({ id: jobs.id, kind: jobs.kind, userId: jobs.userId })
		.from(jobs)
		.where(
			and(
				or(eq(jobs.status, 'queued'), eq(jobs.status, 'paused')),
				viewer.isAdmin ? undefined : eq(jobs.userId, viewer.id)
			)
		)
		.all()
		.filter((j) => laneOf(j.kind) === lane)
		.map((j) => j.id);
	cancelJobs(db, ids);
	return ids.length;
}

/**
 * Draw a waiting (or paused) picture job with another image model: its
 * pictures' pending versions take the model, which the job reads when it
 * runs. A running job must be stopped or paused first.
 */
export function setModel(db: Db, viewer: Viewer, id: number, model: string): void {
	const job = ownJob(db, viewer, id);
	if (laneOf(job.kind) !== 'image') throw new QueueError('Only pictures have an image model.');
	if (!isImageModel(model)) throw new QueueError('Choose one of the image models.');
	if (job.status !== 'queued' && job.status !== 'paused') {
		throw new QueueError('Pause it first: a running picture keeps its model.');
	}
	db.update(versions)
		.set({ model })
		.where(and(eq(versions.jobId, id), eq(versions.status, 'pending')))
		.run();
}

/** Pause or resume a whole lane (admins only: it holds everyone's jobs). */
export function setLane(db: Db, viewer: Viewer, lane: string, paused: boolean): void {
	if (!viewer.isAdmin) throw new QueueError('Only an admin can pause a lane.');
	if (lane !== 'text' && lane !== 'image') throw new QueueError('Unknown lane.');
	setLanePaused(db, lane, paused);
}
