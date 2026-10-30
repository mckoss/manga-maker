import { createHash, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'session';
const DAY = 24 * 60 * 60 * 1000;
export const SESSION_LIFETIME_MS = 30 * DAY;
/** Sessions used with less than this left are extended to a full lifetime. */
const RENEW_WITHIN_MS = 15 * DAY;

/**
 * Cookie options for the session cookie. Secure is set explicitly: behind a
 * TLS-terminating proxy the app sees http://, so SvelteKit's default would
 * leave it off. Plain-http localhost is the only exception, for local dev.
 */
export function sessionCookieOptions(url: URL, expires: Date) {
	const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
	return { path: '/', expires, httpOnly: true, sameSite: 'lax' as const, secure: !local };
}

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Create a session; returns the token for the cookie and its expiry. */
export function createSession(db: Db, userId: number, now = Date.now()) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(now + SESSION_LIFETIME_MS);
	db.insert(sessions)
		.values({ id: hashToken(token), userId, expiresAt })
		.run();
	return { token, expiresAt };
}

/**
 * Look up the user for a session token. Expired sessions are deleted; sessions
 * nearing expiry are extended, in which case `expiresAt` is the new expiry.
 */
export function validateSession(db: Db, token: string, now = Date.now()) {
	const id = hashToken(token);
	const row = db
		.select({ userId: users.id, username: users.username, expiresAt: sessions.expiresAt })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id))
		.get();
	if (!row) return undefined;
	if (row.expiresAt.getTime() <= now) {
		db.delete(sessions).where(eq(sessions.id, id)).run();
		return undefined;
	}
	let { expiresAt } = row;
	let renewed = false;
	if (expiresAt.getTime() - now < RENEW_WITHIN_MS) {
		expiresAt = new Date(now + SESSION_LIFETIME_MS);
		db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id)).run();
		renewed = true;
	}
	return { user: { id: row.userId, username: row.username }, expiresAt, renewed };
}

export function deleteSession(db: Db, token: string): void {
	db.delete(sessions)
		.where(eq(sessions.id, hashToken(token)))
		.run();
}

export function deleteExpiredSessions(db: Db, now = Date.now()): void {
	db.delete(sessions)
		.where(lt(sessions.expiresAt, new Date(now)))
		.run();
}
