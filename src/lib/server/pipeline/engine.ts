import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { items, versions, type Item } from '../db/schema';
import { enqueue, type JobHandler } from '../jobs';
import {
	abandonVersion,
	attachJob,
	describeScope,
	ensureItem,
	finishVersion,
	startVersion,
	VersionError,
	type ItemView
} from '../versions';
import { parseSlot, slot, slotKey, type SlotRef } from './ids';
import type {
	Inputs,
	Pipeline,
	PipelineState,
	Snapshot,
	Stage,
	StartOpts,
	Status
} from './registry';

/** A job's payload: one per stage (`versionIds`) or one per slot (`versionId`). */
interface Payload {
	versionIds?: Record<string, number>;
	versionId?: number;
	guidance?: string;
	cascade?: string[];
	[idField: string]: unknown;
}

/**
 * The generic pipeline engine: everything that used to be copied into each
 * domain module. Given a pipeline it says where every item stands, what is
 * due, starts versions and their jobs, and runs the jobs: a job's versions
 * are finished only while still pending (and made current only where the
 * item isn't locked; see `finishVersion`), then the cascade carries on.
 */
export function engine<S extends PipelineState>(p: Pipeline<S>) {
	const idField = `${p.domain}Id`;
	const stageById = new Map(p.stages.map((st) => [st.id, st]));
	const stageOfKind = new Map<string, Stage<S>>();
	for (const st of p.stages) for (const k of st.kinds) stageOfKind.set(k, st);

	function stage(id: string): Stage<S> {
		const st = stageById.get(id);
		if (!st) throw new Error(`No stage ${p.domain}.${id}`);
		return st;
	}

	/** What a new version of a slot would be made from; null for the user's own inputs. */
	function inputsFor(s: S, ref: SlotRef): Inputs | null {
		const st = stageOfKind.get(ref.kind);
		return st ? st.inputs(s, ref) : (p.inputsOutside?.(s, ref) ?? null);
	}

	/** Where every item stands, from one scan of the scope; statuses are memoised. */
	function snapshotOf(s: S, views: Map<string, ItemView>): Snapshot {
		const memo = new Map<string, Status>();
		const upstream = (key: string) => {
			const ref = parseSlot(key);
			return (stageOfKind.get(ref.kind)?.upstream(s, ref) ?? []).map(slotKey);
		};
		/** An earlier step that won't change under what is made from it. */
		const anchored = (key: string) => {
			const v = views.get(key);
			if (v?.locked) return true;
			const ref = parseSlot(key);
			return Boolean(stageOfKind.get(ref.kind)?.anchored?.(v, ref));
		};
		const current = (key: string) => {
			const v = views.get(key);
			return v?.versions.find((x) => x.id === v.currentId);
		};
		const status = (key: string): Status => {
			const known = memo.get(key);
			if (known) return known;
			const v = views.get(key);
			const cur = current(key);
			let result: Status;
			if (v?.pending) result = 'pending';
			else if (!cur) result = 'missing';
			else if (cur.outOfDate.length) result = 'outdated';
			else if (stageOfKind.get(parseSlot(key).kind)?.staleness === 'own') result = 'ok';
			else {
				const changing = upstream(key).some((u) => !anchored(u) && status(u) !== 'ok');
				result = changing ? 'upstream' : 'ok';
			}
			memo.set(key, result);
			return result;
		};
		const settled = (key: string) => upstream(key).every((u) => anchored(u) || status(u) === 'ok');
		const due = (key: string) => {
			if (views.get(key)?.locked) return false;
			const st = status(key);
			return (st === 'missing' || st === 'outdated') && settled(key);
		};
		const outOfDate = (key: string) => current(key)?.outOfDate ?? [];
		return { views, status, settled, due, outOfDate };
	}

	/** Every item in the scope with its versions, and where each stands. */
	function describe(db: Db, s: S, labels: Record<string, string> = {}): Snapshot {
		const views = describeScope(
			db,
			s.scope,
			(it: Item) => inputsFor(s, slot(it.kind, it.key)),
			labels
		);
		return snapshotOf(s, views);
	}

	/** The slots of a stage that can be regenerated now. */
	function dueSlots(s: S, stageId: string, snap: Snapshot): SlotRef[] {
		const st = stage(stageId);
		if (st.ready && !st.ready(s)) return [];
		return st.slots(s).filter((ref) => snap.due(slotKey(ref)));
	}

	const item = (db: Db, s: S, ref: SlotRef) =>
		ensureItem(db, s.ownerId, s.scope, ref.kind, ref.key ?? '');

	/** Turn a VersionError into the domain's error. */
	function wrap<T>(fn: () => T): T {
		try {
			return fn();
		} catch (e) {
			if (e instanceof VersionError && p.error) throw p.error(e.message);
			throw e;
		}
	}

	/**
	 * A per-stage job's name for a slot, as its payload has always keyed
	 * them: the key when the stage's kind has keys ("1"), else the kind; or
	 * the whole slot ("beat:hook") where the stage says so.
	 */
	const labelOf = (st: Stage<S>, ref: SlotRef) =>
		st.job?.payloadKeys === 'slot' ? slotKey(ref) : (ref.key ?? ref.kind);
	const refOfLabel = (st: Stage<S>, label: string) =>
		label.includes(':')
			? parseSlot(label)
			: st.kinds.includes(label)
				? slot(label)
				: slot(st.kinds[0], label);

	/**
	 * Start versions of these slots and queue the job that makes them. The
	 * caller checks the stage can run (see `dueSlots`); returns how many.
	 */
	function start(db: Db, s: S, stageId: string, refs: SlotRef[], opts: StartOpts = {}): number {
		if (!refs.length) return 0;
		const st = stage(stageId);
		if (!st.job) throw new Error(`${p.domain}.${stageId} has no job.`);
		const job = st.job;
		let snap: Snapshot | undefined;
		const prepared =
			st.prepare?.({
				db,
				state: s,
				slots: refs,
				opts,
				snapshot: () => (snap ??= describe(db, s))
			}) ?? refs.map(() => ({ guidance: opts.guidance }));
		const cascade = opts.cascade ?? [];
		return wrap(() => {
			if (job.per === 'stage') {
				const started = refs.map(
					(ref, i) => [ref, startVersion(db, item(db, s, ref), prepared[i]).id] as const
				);
				const queued = enqueue(db, s.ownerId, job.kind, {
					[idField]: s.id,
					versionIds: Object.fromEntries(started.map(([ref, id]) => [labelOf(st, ref), id])),
					guidance: opts.guidance?.trim() ?? '',
					cascade
				});
				attachJob(
					db,
					started.map(([, id]) => id),
					queued.id
				);
			} else {
				refs.forEach((ref, i) => {
					const version = startVersion(db, item(db, s, ref), prepared[i]);
					const queued = enqueue(db, s.ownerId, job.kind, {
						[idField]: s.id,
						versionId: version.id,
						key: ref.key,
						cascade
					});
					attachJob(db, [version.id], queued.id);
				});
			}
			return refs.length;
		});
	}

	const order = (id: string) => p.stages.findIndex((st) => st.id === id);

	/** The stages after one, to carry a cascade on without redoing that stage. */
	const after = (stageId: string, cascade: readonly string[]) =>
		cascade.filter((st) => order(st) > order(stageId));

	/**
	 * Regenerate what is due in the given stages, in pipeline order, as far
	 * as the pipeline allows now: a stage waits for the earlier steps it is
	 * made from, so a step started here holds back what follows until its
	 * job finishes and carries the cascade on. Returns how many it started.
	 */
	function advance(db: Db, id: number, stages: readonly string[]): number {
		const s = p.load(db, id);
		if (!s) return 0;
		const cascade = [...stages];
		let started = 0;
		let snap: Snapshot | undefined;
		for (const stageId of stages) {
			if (!stage(stageId).job) continue;
			snap ??= describe(db, s);
			const n = start(db, s, stageId, dueSlots(s, stageId, snap), { cascade, advancing: true });
			// What was just started is pending: look again before the next stage.
			if (n) snap = undefined;
			started += n;
		}
		return started;
	}

	const versionById = (db: Db, id: number) =>
		db.select().from(versions).where(eq(versions.id, id)).get();

	function handler(st: Stage<S>): JobHandler {
		const job = st.job!;
		return async (queued, { db, ai, signal }) => {
			const payload = queued.payload as Payload;
			const id = payload[idField] as number;
			const state = p.load(db, id);
			let slots: { ref: SlotRef; id: number; version: ReturnType<typeof versionById> }[];
			if (payload.versionId !== undefined) {
				const version = versionById(db, payload.versionId);
				if (!state || version?.status !== 'pending') return; // deleted or superseded meanwhile
				const it = db.select().from(items).where(eq(items.id, version.itemId)).get()!;
				slots = [{ ref: slot(it.kind, it.key), id: version.id, version }];
			} else {
				if (!state) return; // deleted meanwhile
				const rank = (ref: SlotRef) => st.kinds.indexOf(ref.kind);
				slots = Object.entries(payload.versionIds ?? {})
					.map(([label, vid]) => ({
						ref: refOfLabel(st, label),
						id: vid,
						version: versionById(db, vid)
					}))
					.sort(
						(a, b) => rank(a.ref) - rank(b.ref) || (a.ref.key ?? '').localeCompare(b.ref.key ?? '')
					);
			}
			const made = await job.run({
				db,
				ai,
				signal,
				state,
				slots: slots.map(({ ref, version }) => ({ ref, version })),
				guidance: payload.guidance ?? ''
			});
			if (!made) return; // nothing to do: leave the versions, no cascade
			for (const { ref, id: versionId } of slots) {
				const content = made.get(slotKey(ref));
				if (content) finishVersion(db, versionId, { inputs: st.inputs(state, ref), ...content });
				else abandonVersion(db, versionId);
			}
			st.afterFinish?.(
				db,
				state,
				slots.map((x) => x.ref)
			);
			if (st.cascades !== false) advance(db, id, after(st.id, payload.cascade ?? []));
		};
	}

	/** The job handlers, by job kind, for the worker. */
	function handlers(): Record<string, JobHandler> {
		return Object.fromEntries(
			p.stages.filter((st) => st.job).map((st) => [st.job!.kind, handler(st)])
		);
	}

	return {
		pipeline: p,
		stage,
		inputsFor,
		describe,
		dueSlots,
		item,
		start,
		after,
		advance,
		handlers
	};
}

export type Engine<S extends PipelineState> = ReturnType<typeof engine<S>>;
