import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from './db';
import { items, jobs, versions, type Item, type Version, type VersionOrigin } from './db/schema';
import { cancelJobs } from './jobs';

/**
 * Versioned items: anything the user and the AI make in rounds (a prompt, a
 * scene, a picture) keeps every round as a version. The newest is current
 * unless the user goes back to an older one; a locked item is never
 * regenerated; each version records what it was made from, so it can say
 * when it is out of date. Domain modules (styles, characters) decide what
 * the items are and what they are made from.
 */

export class VersionError extends Error {}

/** The out-of-date reason for a version whose inputs were never recorded. */
export const UNRECORDED = 'unrecorded';

/** Inputs that differ between what a version was made from and what is current now. */
export function changedInputs(
	made: Record<string, string | null>,
	now: Record<string, string>
): string[] {
	return Object.keys(now).filter((name) => (made[name] ?? null) !== now[name]);
}

/** The item for a slot, created on first use. */
export function ensureItem(db: Db, ownerId: number, scope: string, kind: string, key = ''): Item {
	const found = db
		.select()
		.from(items)
		.where(and(eq(items.scope, scope), eq(items.kind, kind), eq(items.key, key)))
		.get();
	if (found) return found;
	return db
		.insert(items)
		.values({ ownerId, scope, kind, key, createdAt: new Date() })
		.returning()
		.get();
}

export function itemsIn(db: Db, scope: string): Item[] {
	return db.select().from(items).where(eq(items.scope, scope)).orderBy(asc(items.id)).all();
}

export function currentVersion(db: Db, item: Pick<Item, 'currentVersionId'>): Version | undefined {
	if (item.currentVersionId === null) return undefined;
	return db.select().from(versions).where(eq(versions.id, item.currentVersionId)).get();
}

/** The current versions of the items in a scope, keyed "kind" or "kind:key". */
export function currentVersions(db: Db, scope: string): Map<string, Version> {
	const all = itemsIn(db, scope);
	const ids = all.map((i) => i.currentVersionId).filter((id): id is number => id !== null);
	const byId = new Map(
		ids.length
			? db
					.select()
					.from(versions)
					.where(inArray(versions.id, ids))
					.all()
					.map((v) => [v.id, v])
			: []
	);
	const out = new Map<string, Version>();
	for (const item of all) {
		const version = item.currentVersionId !== null ? byId.get(item.currentVersionId) : undefined;
		if (version) out.set(slotKey(item), version);
	}
	return out;
}

export const slotKey = (item: Pick<Item, 'kind' | 'key'>) =>
	item.key ? `${item.kind}:${item.key}` : item.kind;

export interface VersionContent {
	origin: VersionOrigin;
	text?: string;
	assetHash?: string | null;
	thumbHash?: string | null;
	seed?: number | null;
	inputs?: Record<string, string>;
	notes?: string;
	guidance?: string;
}

/** Add a finished version (an edit by the user, say) and make it current. */
export function addVersion(db: Db, item: Item, content: VersionContent): Version {
	if (item.locked) throw new VersionError('It is kept. Stop keeping it to change it.');
	return db.transaction((tx) => {
		const version = tx
			.insert(versions)
			.values({ itemId: item.id, status: 'ready', ...content, createdAt: new Date() })
			.returning()
			.get();
		tx.update(items).set({ currentVersionId: version.id }).where(eq(items.id, item.id)).run();
		return version;
	});
}

/**
 * Start a version a job will make. Unfinished or failed attempts at the same
 * item are dropped first. Call `attachJob` once the job is queued.
 */
export function startVersion(
	db: Db,
	item: Item,
	opts: { seed?: number | null; guidance?: string } = {}
): Version {
	if (item.locked) throw new VersionError('It is kept. Stop keeping it to regenerate it.');
	dropPending(db, [item.id]);
	return db
		.insert(versions)
		.values({
			itemId: item.id,
			status: 'pending',
			origin: 'ai',
			seed: opts.seed ?? null,
			guidance: opts.guidance?.trim() ?? '',
			createdAt: new Date()
		})
		.returning()
		.get();
}

export function attachJob(db: Db, versionIds: number[], jobId: number): void {
	if (!versionIds.length) return;
	db.update(versions).set({ jobId }).where(inArray(versions.id, versionIds)).run();
}

/**
 * A job finished making a version: fill it in and make it current, unless
 * the item was locked meanwhile (it then stays in the history, not current).
 * Returns false if the version is gone (deleted or superseded meanwhile).
 */
export function finishVersion(
	db: Db,
	versionId: number,
	content: Omit<VersionContent, 'origin'>
): boolean {
	return db.transaction((tx) => {
		const version = tx.select().from(versions).where(eq(versions.id, versionId)).get();
		if (version?.status !== 'pending') return false;
		tx.update(versions)
			.set({ ...content, status: 'ready', createdAt: new Date() })
			.where(eq(versions.id, versionId))
			.run();
		tx.update(items)
			.set({ currentVersionId: versionId })
			.where(and(eq(items.id, version.itemId), eq(items.locked, false)))
			.run();
		return true;
	});
}

/** A pending version the job decided not to make after all. */
export function abandonVersion(db: Db, versionId: number): void {
	db.delete(versions)
		.where(and(eq(versions.id, versionId), eq(versions.status, 'pending')))
		.run();
}

/** Cancel the jobs making these items and drop their unfinished versions. */
export function dropPending(db: Db, itemIds: number[]): void {
	if (!itemIds.length) return;
	const pending = db
		.select()
		.from(versions)
		.where(and(inArray(versions.itemId, itemIds), eq(versions.status, 'pending')))
		.all();
	if (!pending.length) return;
	db.delete(versions)
		.where(
			inArray(
				versions.id,
				pending.map((v) => v.id)
			)
		)
		.run();
	// A job may make several items (all the scenes at once); cancel it only
	// when no other item is still waiting on it.
	const jobIds = [
		...new Set(pending.map((v) => v.jobId).filter((id): id is number => id !== null))
	];
	const stillWanted = new Set(
		jobIds.length
			? db
					.select({ jobId: versions.jobId })
					.from(versions)
					.where(and(inArray(versions.jobId, jobIds), eq(versions.status, 'pending')))
					.all()
					.map((v) => v.jobId)
			: []
	);
	cancelJobs(
		db,
		jobIds.filter((id) => !stillWanted.has(id))
	);
}

/** Who may change an item: its owner, working in the scope it belongs to. */
export interface Access {
	ownerId: number;
	scope: string;
}

/** An item the user may change, or an error. */
export function accessItem(db: Db, access: Access, itemId: number): Item {
	const item = db.select().from(items).where(eq(items.id, itemId)).get();
	if (!item || item.ownerId !== access.ownerId || item.scope !== access.scope) {
		throw new VersionError('Not found.');
	}
	return item;
}

function accessVersion(db: Db, access: Access, versionId: number) {
	const version = db.select().from(versions).where(eq(versions.id, versionId)).get();
	if (version?.status !== 'ready') throw new VersionError('That version is gone.');
	return { version, item: accessItem(db, access, version.itemId) };
}

/** Go back to an older version (or forward to a newer one), optionally locking it in. */
export function useVersion(
	db: Db,
	access: Access,
	versionId: number,
	opts: { lock?: boolean } = {}
): Item {
	const { item } = accessVersion(db, access, versionId);
	if (item.locked) throw new VersionError('It is kept. Stop keeping it to change it.');
	if (opts.lock) dropPending(db, [item.id]);
	return db
		.update(items)
		.set({ currentVersionId: versionId, locked: opts.lock ?? false })
		.where(eq(items.id, item.id))
		.returning()
		.get();
}

export function setLocked(db: Db, access: Access, itemId: number, locked: boolean): Item {
	const item = accessItem(db, access, itemId);
	if (locked && item.currentVersionId === null) {
		throw new VersionError('There is nothing to keep yet.');
	}
	if (locked) dropPending(db, [item.id]);
	return db.update(items).set({ locked }).where(eq(items.id, itemId)).returning().get();
}

/**
 * Delete one version. If it was current, the newest remaining version takes
 * its place; an item left with no versions is unlocked.
 */
export function deleteVersion(db: Db, access: Access, versionId: number): Item {
	const { item } = accessVersion(db, access, versionId);
	return db.transaction((tx) => {
		tx.delete(versions).where(eq(versions.id, versionId)).run();
		if (item.currentVersionId !== versionId) return item;
		const next = tx
			.select({ id: versions.id })
			.from(versions)
			.where(and(eq(versions.itemId, item.id), eq(versions.status, 'ready')))
			.orderBy(asc(versions.createdAt), asc(versions.id))
			.all()
			.at(-1);
		return tx
			.update(items)
			.set({ currentVersionId: next?.id ?? null, locked: next ? item.locked : false })
			.where(eq(items.id, item.id))
			.returning()
			.get();
	});
}

/** Delete every finished version of an item except the current one. Returns how many. */
export function deleteOtherVersions(db: Db, access: Access, itemId: number): number {
	const item = accessItem(db, access, itemId);
	return db
		.delete(versions)
		.where(
			and(
				eq(versions.itemId, item.id),
				eq(versions.status, 'ready'),
				ne(versions.id, item.currentVersionId ?? -1)
			)
		)
		.run().changes;
}

export function deleteScope(db: Db, scope: string): void {
	const ids = itemsIn(db, scope).map((i) => i.id);
	dropPending(db, ids);
	if (ids.length) db.delete(items).where(inArray(items.id, ids)).run();
}

// ---------------------------------------------------------------------------
// Views

export interface VersionView {
	id: number;
	origin: VersionOrigin;
	text: string;
	assetHash: string | null;
	thumbHash: string | null;
	seed: number | null;
	notes: string;
	guidance: string;
	createdAt: Date;
	/** Labels of the inputs that changed since this version was made, or [UNRECORDED]. */
	outOfDate: string[];
}

export interface ItemView {
	id: number;
	kind: string;
	key: string;
	locked: boolean;
	/** Finished versions, oldest first. */
	versions: VersionView[];
	currentId: number | null;
	/** A job is making a new version. */
	pending: boolean;
	/** The last attempt failed with this error. */
	error: string | null;
}

/**
 * Every item in a scope with its versions, ready to show. `inputsFor` gives
 * the current inputs of an item (what a new version would be made from) and
 * `labels` names them, to say why a version is out of date.
 */
export function describeScope(
	db: Db,
	scope: string,
	inputsFor: (item: Item) => Record<string, string> | null,
	labels: Record<string, string>
): Map<string, ItemView> {
	const all = itemsIn(db, scope);
	const rows = all.length
		? db
				.select({ version: versions, jobStatus: jobs.status, jobError: jobs.error })
				.from(versions)
				.leftJoin(jobs, eq(versions.jobId, jobs.id))
				.where(
					inArray(
						versions.itemId,
						all.map((i) => i.id)
					)
				)
				.orderBy(asc(versions.createdAt), asc(versions.id))
				.all()
		: [];
	const out = new Map<string, ItemView>();
	for (const item of all) {
		const mine = rows.filter((r) => r.version.itemId === item.id);
		const now = inputsFor(item);
		const unfinished = mine.filter((r) => r.version.status === 'pending');
		const failed = unfinished.findLast((r) => r.jobStatus === 'failed');
		out.set(slotKey(item), {
			id: item.id,
			kind: item.kind,
			key: item.key,
			locked: item.locked,
			currentId: item.currentVersionId,
			versions: mine
				.filter((r) => r.version.status === 'ready')
				.map(({ version: v }) => ({
					id: v.id,
					origin: v.origin,
					text: v.text,
					assetHash: v.assetHash,
					thumbHash: v.thumbHash,
					seed: v.seed,
					notes: v.notes,
					guidance: v.guidance,
					createdAt: v.createdAt,
					outOfDate: !now
						? []
						: Object.keys(v.inputs).length
							? changedInputs(v.inputs, now).map((name) => labels[name] ?? name)
							: [UNRECORDED]
				})),
			pending: unfinished.some((r) => r.jobStatus === 'queued' || r.jobStatus === 'running'),
			error: failed ? (failed.jobError ?? 'It failed.') : null
		});
	}
	return out;
}
