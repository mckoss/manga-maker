import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '../db';
import { items, jobs, versions } from '../db/schema';
import type { AiServices } from '../ai';
import { Worker } from '../jobs';
import { createUser } from '../auth/users';
import { addVersion, currentVersions, ensureItem, setLocked } from '../versions';
import { scopeOf, slot, slotKey, type SlotRef } from './ids';
import { engine } from './engine';
import type { Pipeline, PipelineState, Stage, StepOutput, StepRun } from './registry';

/**
 * A tiny synthetic pipeline:
 *
 *   src (the user's) → a → b:1, b:2 → c → d (own staleness, no cascade) → e
 *
 * Each step writes its inputs joined, so a change upstream changes it.
 */

class TestError extends Error {}

let db: Db;
let owner: number;
let ready: boolean;
let anchorA: boolean;
/** Slots whose run returns null (abandon) or leaves out. */
let refuse: Set<string>;
let runs: { stage: string; slots: string[] }[];
let finished: { stage: string; slots: string[] }[];

const ID = 1;
const scope = scopeOf.chapter(ID);
type S = PipelineState;

const text = (s: S, key: string) => s.current.get(key)?.text ?? '';

const run =
	(stage: string): StepRun<S> =>
	async ({ state, slots }) => {
		runs.push({ stage, slots: slots.map((x) => slotKey(x.ref)) });
		const out = new Map<string, StepOutput | null>();
		for (const { ref } of slots) {
			const key = slotKey(ref);
			if (refuse.has(`${key}:null`)) out.set(key, null);
			else if (!refuse.has(`${key}:omit`)) {
				const inputs = pipeline.stages
					.find((st) => st.kinds.includes(ref.kind))!
					.inputs(state, ref);
				out.set(key, { text: `${key}<${Object.values(inputs).join('|')}>` });
			}
		}
		return out;
	};

function step(
	id: string,
	refs: SlotRef[],
	upstream: (ref: SlotRef) => SlotRef[],
	extra: Partial<Stage<S>> = {}
): Stage<S> {
	return {
		id,
		kind: 'ai-text',
		kinds: [id],
		slots: () => refs,
		inputs: (s, ref) =>
			Object.fromEntries(upstream(ref).map((u) => [slotKey(u), text(s, slotKey(u))])),
		upstream: (_s, ref) => upstream(ref),
		job: { kind: `test.${id}`, per: 'stage', run: run(id) },
		afterFinish: (_db, _s, slots) => finished.push({ stage: id, slots: slots.map(slotKey) }),
		...extra
	};
}

const pipeline: Pipeline<S> = {
	domain: 'chapter',
	load: (database, id) => ({
		id,
		ownerId: owner,
		scope: scopeOf.chapter(id),
		current: currentVersions(database, scopeOf.chapter(id))
	}),
	stages: [
		step('a', [slot('a')], () => [slot('src')], {
			ready: () => ready,
			anchored: () => anchorA
		}),
		step('b', [slot('b', '1'), slot('b', '2')], () => [slot('a')], {
			job: { kind: 'test.b', per: 'slot', run: run('b') }
		}),
		step('c', [slot('c')], () => [slot('b', '1')]),
		step('d', [slot('d')], () => [slot('c')], { staleness: 'own', cascades: false }),
		step('e', [slot('e')], () => [slot('d')])
	],
	labels: { src: 'the source' },
	error: (message) => new TestError(message)
};

const flow = engine(pipeline);
const ALL = ['a', 'b', 'c', 'd', 'e'];
const UP_TO_D = ['a', 'b', 'c', 'd'];

const state = () => pipeline.load(db, ID)!;
const snap = () => flow.describe(db, state(), pipeline.labels);
const statusOf = (...keys: string[]) => keys.map((k) => snap().status(k));
const itemOf = (kind: string, key = '') => ensureItem(db, owner, scope, kind, key);
const access = () => ({ ownerId: owner, scope });

function setSource(value: string) {
	addVersion(db, itemOf('src'), { origin: 'user', text: value });
}

async function drain() {
	await new Worker(db, {} as AiServices, flow.handlers()).drain();
}

beforeEach(async () => {
	db = openDb(':memory:');
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	ready = true;
	anchorA = false;
	refuse = new Set();
	runs = [];
	finished = [];
	setSource('one');
});

/** Everything made once, up to d (d doesn't cascade on to e). */
async function built() {
	flow.advance(db, ID, ALL);
	await drain();
	runs = [];
	finished = [];
}

describe('pipeline engine', () => {
	it('starts what is missing, step by step, carrying the cascade on', async () => {
		expect(statusOf('a', 'b:1', 'c')).toEqual(['missing', 'missing', 'missing']);
		// Only a can start: the rest wait for it.
		expect(flow.advance(db, ID, ALL)).toBe(1);
		expect(statusOf('a', 'b:1')).toEqual(['pending', 'missing']);
		await drain();
		expect(runs.map((r) => r.stage)).toEqual(['a', 'b', 'b', 'c', 'd']);
		expect(statusOf('a', 'b:1', 'b:2', 'c', 'd')).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
		expect(text(state(), 'c')).toBe('c<b:1<a<one>>>');
		// d does not cascade: e waits until asked for.
		expect(statusOf('e')).toEqual(['missing']);
		expect(flow.advance(db, ID, ALL)).toBe(1);
		await drain();
		expect(statusOf('e')).toEqual(['ok']);
	});

	it('runs per-stage jobs once for all slots, per-slot jobs once each', async () => {
		flow.advance(db, ID, ['a']);
		await drain();
		flow.advance(db, ID, ['b']);
		const queued = db.select().from(jobs).all();
		expect(queued.map((j) => j.kind)).toEqual(['test.a', 'test.b', 'test.b']);
		expect(queued[0].payload).toMatchObject({
			chapterId: ID,
			versionIds: { a: expect.any(Number) }
		});
		expect(queued[1].payload).toMatchObject({
			chapterId: ID,
			versionId: expect.any(Number),
			key: '1'
		});
		await drain();
		expect(runs.map((r) => r.slots)).toEqual([['a'], ['b:1'], ['b:2']]);
		// Only the stages asked for: c waits.
		expect(statusOf('c')).toEqual(['missing']);
	});

	it('marks what changed out of date, and what is made from it upstream, transitively', async () => {
		await built();
		setSource('two');
		const s = snap();
		expect(s.status('a')).toBe('outdated');
		expect(s.outOfDate('a')).toEqual(['the source']);
		expect(statusOf('b:1', 'b:2', 'c')).toEqual(['upstream', 'upstream', 'upstream']);
		// d only counts its own inputs.
		expect(s.status('d')).toBe('ok');
		expect(s.due('a')).toBe(true);
		expect(s.due('b:1')).toBe(false);
		expect(s.settled('b:1')).toBe(false);

		flow.advance(db, ID, UP_TO_D);
		await drain();
		expect(runs.map((r) => r.stage)).toEqual(['a', 'b', 'b', 'c', 'd']);
		expect(text(state(), 'd')).toBe('d<c<b:1<a<two>>>>');
	});

	it('never regenerates a locked item, which anchors what follows', async () => {
		await built();
		setLocked(db, access(), itemOf('a').id, true);
		setSource('two');
		expect(statusOf('a', 'b:1', 'c')).toEqual(['outdated', 'ok', 'ok']);
		expect(flow.dueSlots(state(), 'a', snap())).toEqual([]);
		expect(flow.advance(db, ID, UP_TO_D)).toBe(0);
		// Asking for it by name is refused, with the domain's error.
		expect(() => flow.start(db, state(), 'a', [slot('a')])).toThrow(TestError);
	});

	it('lets a stage anchor its own items', async () => {
		await built();
		setSource('two');
		anchorA = true;
		expect(statusOf('a', 'b:1')).toEqual(['outdated', 'ok']);
		expect(snap().due('a')).toBe(true);
	});

	it('starts nothing in a stage that is not ready', () => {
		ready = false;
		expect(snap().due('a')).toBe(true);
		expect(flow.dueSlots(state(), 'a', snap())).toEqual([]);
		expect(flow.advance(db, ID, ALL)).toBe(0);
	});

	it('finishes only what is still pending, and current only where not locked', async () => {
		await built();
		setSource('two');
		flow.start(db, state(), 'b', [slot('b', '1')]);
		const pending = db.select().from(versions).where(eq(versions.status, 'pending')).get()!;
		db.delete(versions).where(eq(versions.id, pending.id)).run();
		await drain();
		// A per-slot job whose version is gone doesn't run at all.
		expect(runs).toEqual([]);

		const before = state().current.get('a')!.id;
		flow.start(db, state(), 'a', [slot('a')]);
		db.update(items)
			.set({ locked: true })
			.where(eq(items.id, itemOf('a').id))
			.run();
		await drain();
		expect(runs.map((r) => r.stage)).toEqual(['a']);
		// Made and kept in the history, but the locked item keeps its version.
		expect(state().current.get('a')!.id).toBe(before);
		expect(
			db
				.select()
				.from(versions)
				.where(eq(versions.itemId, itemOf('a').id))
				.all()
		).toHaveLength(2);
	});

	it('abandons a slot the job made nothing for, and calls afterFinish with the job’s slots', async () => {
		refuse = new Set(['a:null']);
		flow.advance(db, ID, ['a']);
		await drain();
		expect(statusOf('a')).toEqual(['missing']);
		expect(db.select().from(versions).where(eq(versions.status, 'pending')).all()).toEqual([]);
		expect(finished).toEqual([{ stage: 'a', slots: ['a'] }]);

		refuse = new Set(['b:2:omit']);
		flow.advance(db, ID, ['a', 'b']);
		await drain();
		expect(statusOf('a', 'b:1', 'b:2')).toEqual(['ok', 'ok', 'missing']);
		expect(finished.map((f) => f.stage)).toEqual(['a', 'a', 'b', 'b']);
	});

	it('accepts a per-stage payload keyed by slot keys of a keyed kind', async () => {
		flow.advance(db, ID, ['a']);
		await drain();
		// A per-stage job for a keyed kind: the payload names slots by key.
		const multi = engine({
			...pipeline,
			stages: pipeline.stages.map((st) =>
				st.id === 'b' ? { ...st, job: { ...st.job!, per: 'stage' as const } } : st
			)
		});
		multi.start(db, state(), 'b', [slot('b', '2'), slot('b', '1')]);
		const job = db.select().from(jobs).where(eq(jobs.kind, 'test.b')).get()!;
		expect(Object.keys((job.payload as { versionIds: object }).versionIds)).toEqual(['1', '2']);
		await new Worker(db, {} as AiServices, multi.handlers()).drain();
		// Run in slot order, whatever order they were asked for in.
		expect(runs.at(-1)!.slots).toEqual(['b:1', 'b:2']);
		expect(statusOf('b:1', 'b:2')).toEqual(['ok', 'ok']);
	});
});
