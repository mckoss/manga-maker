import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './db';
import { items, jobs, versions } from './db/schema';
import { enqueue } from './jobs';
import { createUser } from './auth/users';
import {
	addVersion,
	attachJob,
	changedInputs,
	currentVersion,
	deleteVersion,
	dropPending,
	ensureItem,
	finishVersion,
	setLocked,
	startVersion,
	VersionError
} from './versions';

let db: Db;
let owner: number;
const scope = 'test:1';
const access = () => ({ ownerId: owner, scope });

beforeEach(async () => {
	db = openDb(':memory:');
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
});

describe('versioned items', () => {
	it('names the inputs that changed, counting unrecorded ones as changed', () => {
		expect(changedInputs({ a: '1', b: '2' }, { a: '1', b: '3', c: '' })).toEqual(['b', 'c']);
	});

	it('keeps a finished version out of use if the item was locked meanwhile', () => {
		const item = ensureItem(db, owner, scope, 'prompt');
		const first = addVersion(db, item, { origin: 'user', text: 'one' });
		const pending = startVersion(db, item);
		setLocked(db, access(), item.id, false);
		setLocked(db, access(), item.id, true); // locking drops the pending version
		expect(finishVersion(db, pending.id, { text: 'two' })).toBe(false);

		setLocked(db, access(), item.id, false);
		const again = startVersion(db, ensureItem(db, owner, scope, 'prompt'));
		// Locked after the job started but before it finished.
		db.update(items).set({ locked: true }).where(eq(items.id, item.id)).run();
		expect(finishVersion(db, again.id, { text: 'three' })).toBe(true);
		expect(currentVersion(db, ensureItem(db, owner, scope, 'prompt'))?.id).toBe(first.id);
	});

	it('cancels a shared job only when nothing else waits on it', () => {
		const a = startVersion(db, ensureItem(db, owner, scope, 'scene', 'a'));
		const b = startVersion(db, ensureItem(db, owner, scope, 'scene', 'b'));
		const job = enqueue(db, owner, 'test', {});
		attachJob(db, [a.id, b.id], job.id);

		dropPending(db, [a.itemId]);
		expect(db.select().from(jobs).get()?.status).toBe('queued');
		dropPending(db, [b.itemId]);
		expect(db.select().from(jobs).get()?.status).toBe('canceled');
		expect(db.select().from(versions).all()).toEqual([]);
	});

	it('unlocks an item when its last version is deleted', () => {
		const item = ensureItem(db, owner, scope, 'prompt');
		const only = addVersion(db, item, { origin: 'user', text: 'one' });
		setLocked(db, access(), item.id, true);
		expect(() =>
			addVersion(db, ensureItem(db, owner, scope, 'prompt'), { origin: 'user' })
		).toThrow(VersionError);
		const after = deleteVersion(db, access(), only.id);
		expect(after).toMatchObject({ currentVersionId: null, locked: false });
		expect(() => setLocked(db, access(), item.id, true)).toThrow(/nothing to lock/);
	});
});
