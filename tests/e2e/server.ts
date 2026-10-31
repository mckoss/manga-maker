/**
 * Starts the built app for the end-to-end tests: a fresh data directory, the
 * fake AI backend, and one admin account (see fixtures.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openDb } from '../../src/lib/server/db';
import { createUser } from '../../src/lib/server/auth/users';
import { ADMIN, E2E_PORT } from './accounts';

const dataDir = path.resolve('.e2e-data');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
const adminsFile = path.join(dataDir, 'admins.txt');
fs.writeFileSync(adminsFile, `${ADMIN.username}\n`);

const db = openDb(path.join(dataDir, 'manga-maker.db'));
await createUser(db, ADMIN.username, ADMIN.password);

const server = spawn(process.execPath, ['build'], {
	stdio: 'inherit',
	env: {
		...process.env,
		AI_BACKEND: 'fake',
		DATA_DIR: dataDir,
		ADMINS_FILE: adminsFile,
		PORT: String(E2E_PORT),
		HOST: '127.0.0.1',
		// adapter-node assumes https unless a header says otherwise; the tests
		// send X-Forwarded-Proto: http (see playwright.config.ts).
		PROTOCOL_HEADER: 'x-forwarded-proto'
	}
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
