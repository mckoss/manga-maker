import fs from 'node:fs';
import { config } from '../config';
import { normalizeUsername } from './username';

/** Parse the admins file: one username per line, # comments and blanks ignored. */
export function parseAdmins(text: string): Set<string> {
	return new Set(
		text
			.split('\n')
			.map((line) => normalizeUsername(line.replace(/#.*/, '')))
			.filter(Boolean)
	);
}

let cache: { file: string; mtimeMs: number; admins: Set<string> } | undefined;

/** Whether `username` is listed in the admins file, re-read whenever it changes. */
export function isAdmin(username: string, file = config.adminsFile): boolean {
	let mtimeMs: number;
	try {
		mtimeMs = fs.statSync(file).mtimeMs;
	} catch {
		return false;
	}
	if (cache?.file !== file || cache.mtimeMs !== mtimeMs) {
		cache = { file, mtimeMs, admins: parseAdmins(fs.readFileSync(file, 'utf8')) };
	}
	return cache.admins.has(normalizeUsername(username));
}
