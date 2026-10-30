import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { users, sessions, type User } from '../db/schema';
import { hashPassword, passwordProblem, verifyPassword } from './password';
import { normalizeUsername, usernameProblem } from './username';

export class UserError extends Error {}

export function findUser(db: Db, username: string): User | undefined {
	return db
		.select()
		.from(users)
		.where(eq(users.username, normalizeUsername(username)))
		.get();
}

export function listUsers(db: Db): Pick<User, 'id' | 'username' | 'createdAt'>[] {
	return db
		.select({ id: users.id, username: users.username, createdAt: users.createdAt })
		.from(users)
		.orderBy(users.username)
		.all();
}

export async function createUser(db: Db, rawUsername: string, password: string): Promise<User> {
	const username = normalizeUsername(rawUsername);
	const problem = usernameProblem(username) ?? passwordProblem(password);
	if (problem) throw new UserError(problem);
	if (findUser(db, username)) throw new UserError(`User ${username} already exists.`);
	return db
		.insert(users)
		.values({ username, passwordHash: await hashPassword(password), createdAt: new Date() })
		.returning()
		.get();
}

/** Set a new password and sign the user out everywhere. */
export async function setPassword(db: Db, userId: number, password: string): Promise<void> {
	const problem = passwordProblem(password);
	if (problem) throw new UserError(problem);
	const passwordHash = await hashPassword(password);
	db.transaction((tx) => {
		tx.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
		tx.delete(sessions).where(eq(sessions.userId, userId)).run();
	});
}

export function deleteUser(db: Db, userId: number): void {
	db.delete(users).where(eq(users.id, userId)).run();
}

// Verified against when the username is unknown, so response time doesn't
// reveal which usernames exist.
let dummyHash: Promise<string> | undefined;

/** The user if the credentials are valid, otherwise undefined. */
export async function authenticate(
	db: Db,
	username: string,
	password: string
): Promise<User | undefined> {
	const user = findUser(db, username);
	if (!user) {
		dummyHash ??= hashPassword('not-a-real-password');
		await verifyPassword(password, await dummyHash);
		return undefined;
	}
	return (await verifyPassword(password, user.passwordHash)) ? user : undefined;
}
