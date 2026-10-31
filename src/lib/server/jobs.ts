import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from './db';
import { jobs, type Job } from './db/schema';
import type { AiServices } from './ai';

export interface JobContext {
	db: Db;
	ai: AiServices;
	signal: AbortSignal;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<void>;

const listeners = new Set<() => void>();

export function enqueue(db: Db, userId: number, kind: string, payload: unknown): Job {
	const job = db
		.insert(jobs)
		.values({ userId, kind, payload, status: 'queued', createdAt: new Date() })
		.returning()
		.get();
	for (const listener of listeners) listener();
	return job;
}

/** Mark queued jobs canceled; a running one is aborted by the worker. */
export function cancelJobs(db: Db, ids: number[]): void {
	if (!ids.length) return;
	db.update(jobs)
		.set({ status: 'canceled', finishedAt: new Date() })
		.where(and(inArray(jobs.id, ids), inArray(jobs.status, ['queued', 'running'])))
		.run();
}

/**
 * Runs queued jobs one at a time, oldest first: the GPU is a single shared
 * resource. Jobs left running by a crash or restart are queued again.
 */
export class Worker {
	private running = false;
	private stopped = false;
	private current: { id: number; abort: AbortController } | undefined;
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
		this.current?.abort.abort();
	}

	/** Start processing if idle. Call after enqueueing for an immediate start. */
	kick(): void {
		if (this.running || this.stopped) return;
		this.running = true;
		void this.drain().finally(() => (this.running = false));
	}

	/** Run jobs until the queue is empty. Resolves when idle (used by tests). */
	async drain(): Promise<void> {
		while (!this.stopped && (await this.runNext()));
	}

	/** Abort the running job if it has been canceled in the database. */
	private checkCanceled(): void {
		if (!this.current) return;
		const row = this.db
			.select({ status: jobs.status })
			.from(jobs)
			.where(eq(jobs.id, this.current.id))
			.get();
		if (row?.status !== 'running') this.current.abort.abort();
	}

	private async runNext(): Promise<boolean> {
		const job = this.db
			.select()
			.from(jobs)
			.where(eq(jobs.status, 'queued'))
			.orderBy(asc(jobs.id))
			.limit(1)
			.get();
		if (!job) return false;

		const handler = this.handlers[job.kind];
		const abort = new AbortController();
		this.current = { id: job.id, abort };
		const watch = setInterval(() => this.checkCanceled(), 1000);
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
			this.current = undefined;
		}
		return true;
	}

	private finish(id: number, status: 'done' | 'failed' | 'canceled', error?: string): void {
		this.db
			.update(jobs)
			.set({ status, error: error ?? null, finishedAt: new Date() })
			// Don't overwrite a cancellation that arrived while the job ran.
			.where(and(eq(jobs.id, id), eq(jobs.status, 'running')))
			.run();
	}
}
