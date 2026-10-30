import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type Db } from '../db';
import { authenticate, createUser, deleteUser, listUsers, setPassword, UserError } from './users';
import {
	createSession,
	SESSION_LIFETIME_MS,
	sessionCookieOptions,
	validateSession
} from './sessions';

const PASSWORD = 'a long enough password';
let db: Db;

beforeEach(() => {
	db = openDb(':memory:');
});

describe('users', () => {
	it('creates a user and authenticates case-insensitively', async () => {
		await createUser(db, 'Kenji@Example.com', PASSWORD);
		expect((await authenticate(db, 'kenji@example.com', PASSWORD))?.username).toBe(
			'kenji@example.com'
		);
		expect(await authenticate(db, 'kenji@example.com', 'wrong password!!')).toBeUndefined();
		expect(await authenticate(db, 'nobody', PASSWORD)).toBeUndefined();
	});

	it('rejects duplicates, bad names and weak passwords', async () => {
		await createUser(db, 'kenji', PASSWORD);
		await expect(createUser(db, 'KENJI', PASSWORD)).rejects.toThrow(/already exists/);
		await expect(createUser(db, 'a b', PASSWORD)).rejects.toThrow(UserError);
		await expect(createUser(db, 'yuki', 'short')).rejects.toThrow(/at least/);
	});

	it('changing the password signs out existing sessions', async () => {
		const user = await createUser(db, 'kenji', PASSWORD);
		const { token } = createSession(db, user.id);
		await setPassword(db, user.id, 'another long password');
		expect(validateSession(db, token)).toBeUndefined();
		expect(await authenticate(db, 'kenji', 'another long password')).toBeDefined();
	});

	it('deleting a user removes their sessions', async () => {
		const user = await createUser(db, 'kenji', PASSWORD);
		const { token } = createSession(db, user.id);
		deleteUser(db, user.id);
		expect(listUsers(db)).toEqual([]);
		expect(validateSession(db, token)).toBeUndefined();
	});
});

describe('sessions', () => {
	it('validates a fresh session without renewing it', async () => {
		const user = await createUser(db, 'kenji', PASSWORD);
		const now = Date.now();
		const { token } = createSession(db, user.id, now);
		const session = validateSession(db, token, now + 1000);
		expect(session?.user.username).toBe('kenji');
		expect(session?.renewed).toBe(false);
	});

	it('renews a session in the second half of its life', async () => {
		const user = await createUser(db, 'kenji', PASSWORD);
		const now = Date.now();
		const { token } = createSession(db, user.id, now);
		const later = now + SESSION_LIFETIME_MS - 1000;
		const session = validateSession(db, token, later);
		expect(session?.renewed).toBe(true);
		expect(session?.expiresAt.getTime()).toBe(later + SESSION_LIFETIME_MS);
	});

	it('rejects expired and unknown tokens', async () => {
		const user = await createUser(db, 'kenji', PASSWORD);
		const now = Date.now();
		const { token } = createSession(db, user.id, now);
		expect(validateSession(db, token, now + SESSION_LIFETIME_MS + 1)).toBeUndefined();
		expect(validateSession(db, token, now)).toBeUndefined(); // deleted on expiry
		expect(validateSession(db, 'not-a-token')).toBeUndefined();
	});
});

describe('session cookie', () => {
	const expires = new Date();
	it('is Secure behind an https proxy that forwards plain http', () => {
		expect(sessionCookieOptions(new URL('http://mac-studio.example.ts.net/'), expires).secure).toBe(
			true
		);
	});
	it('is not Secure on plain-http localhost', () => {
		expect(sessionCookieOptions(new URL('http://localhost:5173/'), expires).secure).toBe(false);
		expect(sessionCookieOptions(new URL('http://127.0.0.1:5173/'), expires).secure).toBe(false);
	});
});
