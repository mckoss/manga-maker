import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { isAdmin, parseAdmins } from './admins';

describe('admins file', () => {
	it('parses names, ignoring comments, blanks and case', () => {
		const admins = parseAdmins('# admins\nAlice@Example.com\n\n  bob  # trailing\n');
		expect([...admins]).toEqual(['alice@example.com', 'bob']);
	});

	it('treats a missing file as no admins', () => {
		expect(isAdmin('alice', '/nonexistent/admins.txt')).toBe(false);
	});

	it('re-reads the file when it changes', () => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'admins-')), 'admins.txt');
		fs.writeFileSync(file, 'alice\n');
		expect(isAdmin('ALICE', file)).toBe(true);
		expect(isAdmin('bob', file)).toBe(false);
		fs.writeFileSync(file, 'bob\n');
		fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
		expect(isAdmin('alice', file)).toBe(false);
		expect(isAdmin('bob', file)).toBe(true);
	});
});
