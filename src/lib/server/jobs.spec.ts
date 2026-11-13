import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './db';
import { jobs, type Job } from './db/schema';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import { fakeReply } from './ai';
import { createUser } from './auth/users';
import {
	blockersOf,
	enqueue,
	IMAGE_JOB_KINDS,
	laneOf,
	pauseJob,
	resumeJob,
	setLanePaused,
	Worker,
	type JobHandler
} from './jobs';
import { ensureItem, startVersion, attachJob } from './versions';
import { styleJobHandlers } from './styles';
import { characterJobHandlers } from './characters';
import { logoJobHandlers } from './logos';
import { locationJobHandlers } from './locations';
import { plotJobHandlers } from './plots';
import { scriptJobHandlers } from './scripts';
import { getQueue, setModel, stop, pause, resume, QueueError } from './queue';

let db: Db;
let owner: number;
let other: number;

beforeEach(async () => {
	db = openDb(':memory:');
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-jobs-'));
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	other = (await createUser(db, 'yuki', 'a long enough password')).id;
});

const ai = () => ({ image: new FakeImageModel(), text: new FakeTextModel(fakeReply) });
const status = (id: number) => db.select().from(jobs).where(eq(jobs.id, id)).get()!.status;

/** A promise to release by hand, to hold a job running. */
function gate() {
	let open!: () => void;
	const promise = new Promise<void>((r) => (open = r));
	return { promise, open };
}

/** A job making an item in a scope, as the domains queue them. */
function queued(kind: string, scope: string, key = '') {
	const item = ensureItem(db, owner, scope, kind.split('.')[1]!, key);
	const version = startVersion(db, item);
	const job = enqueue(db, owner, kind, { versionId: version.id });
	attachJob(db, [version.id], job.id);
	return job;
}

describe('job lanes', () => {
	it('classifies every registered job kind on purpose', () => {
		const kinds = Object.keys({
			...styleJobHandlers,
			...characterJobHandlers,
			...logoJobHandlers,
			...locationJobHandlers,
			...plotJobHandlers,
			...scriptJobHandlers
		});
		const images = kinds.filter((k) => laneOf(k) === 'image').sort();
		expect(images).toEqual([...IMAGE_JOB_KINDS].sort());
		// Every image kind has a handler (no stale names in the list).
		for (const k of IMAGE_JOB_KINDS) expect(kinds).toContain(k);
		expect(laneOf('plot.beats')).toBe('text');
	});

	it('runs a text job while a picture is drawing, but one at a time in each lane', async () => {
		const drawing = gate();
		const order: string[] = [];
		let running = 0;
		let most = 0;
		const track =
			(name: string, wait?: Promise<void>): JobHandler =>
			async () => {
				running++;
				most = Math.max(most, running);
				order.push(`start ${name}`);
				await wait;
				order.push(`end ${name}`);
				running--;
			};
		const worker = new Worker(db, ai(), {
			'style.picture': track('picture', drawing.promise),
			'character.picture': track('picture2'),
			'plot.beats': track('beats'),
			'plot.review': track('review')
		});
		enqueue(db, owner, 'style.picture', {});
		enqueue(db, owner, 'character.picture', {});
		enqueue(db, owner, 'plot.beats', {});
		enqueue(db, owner, 'plot.review', {});
		const done = worker.drain();
		// The text lane gets through both its jobs while the first picture is held.
		await new Promise((r) => setTimeout(r, 20));
		expect(order).toContain('start picture');
		expect(order).not.toContain('end picture');
		expect(order.filter((o) => !o.includes('picture'))).toEqual([
			'start beats',
			'end beats',
			'start review',
			'end review'
		]);
		drawing.open();
		await done;
		expect(order.slice(-3)).toEqual(['end picture', 'start picture2', 'end picture2']);
		expect(most).toBe(2);
	});

	it('holds a job until older jobs in the other lane for the same thing finish', async () => {
		const order: string[] = [];
		const handler =
			(name: string): JobHandler =>
			async () => {
				order.push(name);
			};
		const worker = new Worker(db, ai(), {
			'style.prompt': handler('prompt'),
			'style.picture': handler('picture'),
			'character.picture': handler('other picture')
		});
		const slow = gate();
		// Something else holds the text lane, so the prompt waits behind it.
		const busy = enqueue(db, owner, 'plot.review', {});
		const prompt = queued('style.prompt', 'style:1');
		const picture = queued('style.picture', 'style:1', 'face');
		const unrelated = queued('character.picture', 'character:9', '1');
		expect(blockersOf(db, picture)).toEqual([prompt.id]);
		expect(blockersOf(db, unrelated)).toEqual([]);
		expect(blockersOf(db, prompt)).toEqual([]);
		const handlers = (worker as unknown as { handlers: Record<string, JobHandler> }).handlers;
		handlers['plot.review'] = async () => {
			order.push('review');
			await slow.promise;
		};
		const done = worker.drain();
		await new Promise((r) => setTimeout(r, 20));
		// The unrelated picture drew; the style's picture waits for its prompt.
		expect(order).toEqual(['review', 'other picture']);
		expect(status(picture.id)).toBe('queued');
		slow.open();
		await done;
		expect(order).toEqual(['review', 'other picture', 'prompt', 'picture']);
		expect(status(busy.id)).toBe('done');
	});

	it('skips paused jobs and lanes until resumed', async () => {
		const ran: number[] = [];
		const worker = new Worker(db, ai(), {
			'plot.beats': async (job: Job) => {
				ran.push(job.id);
			},
			'style.picture': async (job: Job) => {
				ran.push(job.id);
			}
		});
		const a = enqueue(db, owner, 'plot.beats', {});
		const b = enqueue(db, owner, 'plot.beats', {});
		const pic = enqueue(db, owner, 'style.picture', {});
		expect(pauseJob(db, a.id)).toBe(true);
		setLanePaused(db, 'image', true);
		await worker.drain();
		expect(ran).toEqual([b.id]);
		expect(status(a.id)).toBe('paused');
		expect(status(pic.id)).toBe('queued');
		expect(resumeJob(db, a.id)).toBe(true);
		setLanePaused(db, 'image', false);
		await worker.drain();
		expect(ran).toEqual([b.id, a.id, pic.id]);
	});

	it('pausing a running job stops it; resumed, it starts over', async () => {
		let calls = 0;
		const worker = new Worker(db, ai(), {
			'plot.beats': async (_job, { signal }) => {
				calls++;
				if (calls > 1) return;
				// The first run waits until aborted, as a long AI call would.
				await new Promise((_, reject) =>
					signal.addEventListener('abort', () => reject(new Error('aborted')))
				);
			}
		});
		const job = enqueue(db, owner, 'plot.beats', {});
		const done = worker.drain();
		await new Promise((r) => setTimeout(r, 20));
		expect(status(job.id)).toBe('running');
		pauseJob(db, job.id);
		await done; // the worker notices within a second and aborts it
		expect(status(job.id)).toBe('paused');
		resumeJob(db, job.id);
		await worker.drain();
		expect(status(job.id)).toBe('done');
		expect(calls).toBe(2);
	});
});

describe('the queue page', () => {
	it('shows each lane, hides other users’ jobs, and controls only the viewer’s', () => {
		const pic = queued('style.picture', 'style:1', 'face');
		const theirs = enqueue(db, other, 'plot.beats', {});
		const me = { id: owner, isAdmin: false };
		const q = getQueue(db, me);
		const image = q.lanes.find((l) => l.lane === 'image')!;
		expect(image.waiting.map((j) => j.id)).toEqual([pic.id]);
		expect(image.waiting[0]).toMatchObject({ mine: true, label: 'Sample picture', count: 1 });
		const text = q.lanes.find((l) => l.lane === 'text')!;
		expect(text.waiting[0]).toMatchObject({ mine: false, label: 'Another user’s job', what: null });
		expect(q.busy).toBe(true);
		expect(() => stop(db, me, theirs.id)).toThrow(QueueError);
		// An admin sees and controls everyone's.
		const admin = getQueue(db, { id: owner, isAdmin: true });
		expect(admin.lanes.find((l) => l.lane === 'text')!.waiting[0]).toMatchObject({
			mine: true,
			owner: 'yuki',
			label: 'Beat outline'
		});
	});

	it('pauses, resumes and stops a job, and switches a waiting picture’s model', () => {
		const me = { id: owner, isAdmin: false };
		const pic = queued('style.picture', 'style:1', 'face');
		setModel(db, me, pic.id, 'z-image');
		expect(getQueue(db, me).lanes[1]!.waiting[0]!.model).toBe('z-image');
		expect(() => setModel(db, me, pic.id, 'nonsense')).toThrow(QueueError);
		pause(db, me, pic.id);
		expect(status(pic.id)).toBe('paused');
		expect(() => pause(db, me, pic.id)).toThrow(QueueError);
		resume(db, me, pic.id);
		expect(status(pic.id)).toBe('queued');
		stop(db, me, pic.id);
		expect(status(pic.id)).toBe('canceled');
		const q = getQueue(db, me);
		expect(q.busy).toBe(false);
		expect(q.recent[0]).toMatchObject({ id: pic.id, status: 'canceled' });
		const beats = enqueue(db, owner, 'plot.beats', {});
		expect(() => setModel(db, me, beats.id, 'z-image')).toThrow(QueueError);
	});
});
