import { and, asc, eq, inArray, lt, notInArray } from 'drizzle-orm';
import type { Db } from './db';
import { items, jobLanes, jobs, versions, type Job, type JobLane } from './db/schema';
import type { AiServices } from './ai';

export interface JobContext {
	db: Db;
	ai: AiServices;
	signal: AbortSignal;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<void>;

export const LANES: readonly JobLane[] = ['text', 'image'];

/**
 * The job kinds that draw pictures (ComfyUI). Every other kind is text (the
 * LLM). A kind belongs to one lane: no job both writes and draws. The worker
 * spec checks every registered handler is classified on purpose.
 */
export const IMAGE_JOB_KINDS: ReadonlySet<string> = new Set([
	'style.picture',
	'character.picture',
	'character.sheet',
	'location.picture',
	'location.sheet',
	'series.logo'
]);

export const laneOf = (kind: string): JobLane => (IMAGE_JOB_KINDS.has(kind) ? 'image' : 'text');

const IMAGE_KINDS = [...IMAGE_JOB_KINDS];

/** The condition picking a lane's jobs. */
const inLane = (lane: JobLane) =>
	lane === 'image' ? inArray(jobs.kind, IMAGE_KINDS) : notInArray(jobs.kind, IMAGE_KINDS);

/** The scopes ("character:12") of the items a job is making. */
function jobScopes(db: Db, jobId: number): string[] {
	return [
		...new Set(
			db
				.select({ scope: items.scope })
				.from(versions)
				.innerJoin(items, eq(versions.itemId, items.id))
				.where(eq(versions.jobId, jobId))
				.all()
				.map((r) => r.scope)
		)
	];
}

/**
 * The older unfinished jobs in the other lane that a job waits for: those
 * making items in the same scope (a picture queued right behind the text
 * job writing its prompt). With one lane, order alone kept them in turn;
 * with two, a job waits for these, oldest first. A paused one holds it too.
 */
export function blockersOf(db: Db, job: Pick<Job, 'id' | 'kind'>): number[] {
	const scopes = jobScopes(db, job.id);
	if (!scopes.length) return [];
	const other: JobLane = laneOf(job.kind) === 'image' ? 'text' : 'image';
	return [
		...new Set(
			db
				.select({ id: jobs.id })
				.from(jobs)
				.innerJoin(versions, eq(versions.jobId, jobs.id))
				.innerJoin(items, eq(versions.itemId, items.id))
				.where(
					and(
						lt(jobs.id, job.id),
						inArray(jobs.status, ['queued', 'paused', 'running']),
						inLane(other),
						inArray(items.scope, scopes)
					)
				)
				.orderBy(asc(jobs.id))
				.all()
				.map((r) => r.id)
		)
	];
}

const listeners = new Set<() => void>();

const notify = () => {
	for (const listener of listeners) listener();
};

export function enqueue(db: Db, userId: number, kind: string, payload: unknown): Job {
	const job = db
		.insert(jobs)
		.values({ userId, kind, payload, status: 'queued', createdAt: new Date() })
		.returning()
		.get();
	notify();
	return job;
}

/** Mark jobs canceled; a running one is aborted by the worker. */
export function cancelJobs(db: Db, ids: number[]): void {
	if (!ids.length) return;
	db.update(jobs)
		.set({ status: 'canceled', finishedAt: new Date() })
		.where(and(inArray(jobs.id, ids), inArray(jobs.status, ['queued', 'paused', 'running'])))
		.run();
}

/**
 * Pause a job: a queued one waits until resumed; a running one is stopped
 * and waits too, starting over from the beginning when resumed. Returns
 * whether it was paused.
 */
export function pauseJob(db: Db, id: number): boolean {
	return (
		db
			.update(jobs)
			.set({ status: 'paused', startedAt: null })
			.where(and(eq(jobs.id, id), inArray(jobs.status, ['queued', 'running'])))
			.run().changes > 0
	);
}

/** Queue a paused job again, in its original place (oldest first). */
export function resumeJob(db: Db, id: number): boolean {
	const changed =
		db
			.update(jobs)
			.set({ status: 'queued' })
			.where(and(eq(jobs.id, id), eq(jobs.status, 'paused')))
			.run().changes > 0;
	if (changed) notify();
	return changed;
}

export function lanePaused(db: Db, lane: JobLane): boolean {
	return db.select().from(jobLanes).where(eq(jobLanes.lane, lane)).get()?.paused ?? false;
}

/** Pause or resume a lane: a paused lane starts nothing new; a running job finishes. */
export function setLanePaused(db: Db, lane: JobLane, paused: boolean): void {
	db.insert(jobLanes)
		.values({ lane, paused })
		.onConflictDoUpdate({ target: jobLanes.lane, set: { paused } })
		.run();
	if (!paused) notify();
}

interface LaneState {
	running: boolean;
	current: { id: number; abort: AbortController } | undefined;
}

/**
 * Runs queued jobs oldest first, one at a time in each lane: a text job (the
 * LLM) can run while a picture is drawn, but two pictures never draw at once,
 * nor do two text jobs. Jobs left running by a crash or restart are queued
 * again.
 */
export class Worker {
	private stopped = false;
	private lanes: Record<JobLane, LaneState> = {
		text: { running: false, current: undefined },
		image: { running: false, current: undefined }
	};
	private timer: NodeJS.Timeout | undefined;

	constructor(
		private db: Db,
		private ai: AiServices,
		private handlers: Record<string, JobHandler>,
		private pollMs = 2000
	) {}

	private onEnqueue = () => this.kick();

	/** Queue again any job a crash or restart left marked running. */
	recover(): void {
		this.db.update(jobs).set({ status: 'queued' }).where(eq(jobs.status, 'running')).run();
	}

	start(): void {
		this.recover();
		listeners.add(this.onEnqueue);
		this.timer = setInterval(() => this.kick(), this.pollMs);
		this.kick();
	}

	stop(): void {
		this.stopped = true;
		listeners.delete(this.onEnqueue);
		clearInterval(this.timer);
		for (const lane of LANES) this.lanes[lane].current?.abort.abort();
	}

	/** Start processing any idle lane. Call after enqueueing for an immediate start. */
	kick(): void {
		for (const lane of LANES) {
			const state = this.lanes[lane];
			if (state.running || this.stopped) continue;
			state.running = true;
			void this.drainLane(lane).finally(() => (state.running = false));
		}
	}

	/**
	 * Run jobs until every lane is empty (or paused), the lanes side by side.
	 * Resolves when idle (used by tests). A job in one lane may queue work in
	 * the other, so it goes round until a pass finds nothing to do.
	 */
	async drain(): Promise<void> {
		for (;;) {
			const ran = await Promise.all(LANES.map((lane) => this.drainLane(lane)));
			if (this.stopped || !ran.some(Boolean)) return;
		}
	}

	/** Run one lane's jobs until it is empty or paused. Returns whether it ran any. */
	private async drainLane(lane: JobLane): Promise<boolean> {
		let ran = false;
		while (!this.stopped && (await this.runNext(lane))) ran = true;
		return ran;
	}

	/** Abort a lane's running job if it was canceled or paused in the database. */
	private checkCanceled(lane: JobLane): void {
		const current = this.lanes[lane].current;
		if (!current) return;
		const row = this.db
			.select({ status: jobs.status })
			.from(jobs)
			.where(eq(jobs.id, current.id))
			.get();
		if (row?.status !== 'running') current.abort.abort();
	}

	private async runNext(lane: JobLane): Promise<boolean> {
		if (lanePaused(this.db, lane)) return false;
		// The oldest queued job not waiting on the other lane.
		const job = this.db
			.select()
			.from(jobs)
			.where(and(eq(jobs.status, 'queued'), inLane(lane)))
			.orderBy(asc(jobs.id))
			.all()
			.find((j) => !blockersOf(this.db, j).length);
		if (!job) return false;

		const handler = this.handlers[job.kind];
		const abort = new AbortController();
		const state = this.lanes[lane];
		state.current = { id: job.id, abort };
		const watch = setInterval(() => this.checkCanceled(lane), 1000);
		this.db
			.update(jobs)
			.set({ status: 'running', startedAt: new Date() })
			.where(eq(jobs.id, job.id))
			.run();
		try {
			if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
			await handler(job, { db: this.db, ai: this.ai, signal: abort.signal });
			this.finish(job.id, 'done');
		} catch (e) {
			if (abort.signal.aborted) this.finish(job.id, 'canceled');
			else this.finish(job.id, 'failed', (e as Error).message);
		} finally {
			clearInterval(watch);
			state.current = undefined;
		}
		// A job in the other lane may have been waiting on this one.
		notify();
		return true;
	}

	private finish(id: number, status: 'done' | 'failed' | 'canceled', error?: string): void {
		this.db
			.update(jobs)
			.set({ status, error: error ?? null, finishedAt: new Date() })
			// Don't overwrite a cancellation (or a pause) that arrived while the job ran.
			.where(and(eq(jobs.id, id), eq(jobs.status, 'running')))
			.run();
	}
}
