import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { mangas, styles } from './db/schema';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import { approveDraft, getStyle, requestSamples, styleJobHandlers } from './styles';
import {
	createManga,
	deleteManga,
	getManga,
	listMangas,
	MangaError,
	removeStyle,
	reusableStyles,
	reuseStyle,
	startStyle,
	updateManga
} from './mangas';

let db: Db;
let worker: Worker;
let owner: number;
let other: number;

const manga = {
	title: 'Ronin Road',
	logline: 'A wandering swordsman.',
	readingDirection: 'rtl' as const
};
const look = {
	description: 'Edo period ink',
	colorMode: 'bw' as const,
	model: 'qwen-image' as const
};

beforeEach(async () => {
	db = openDb(':memory:');
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-assets-'));
	const text = new FakeTextModel(() => ({ prompt: 'bold ink', notes: '' }));
	worker = new Worker(db, { image: new FakeImageModel(), text }, styleJobHandlers);
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	other = (await createUser(db, 'yuki', 'a long enough password')).id;
});

/** A manga whose style has been drafted, sampled and approved. */
async function approvedManga(title = 'Ronin Road') {
	const id = createManga(db, owner, { ...manga, title });
	const styleId = startStyle(db, owner, id, look);
	await worker.drain();
	const draft = getStyle(db, owner, styleId).draft!;
	requestSamples(db, owner, draft.id);
	await worker.drain();
	approveDraft(db, owner, draft.id);
	return { id, styleId };
}

describe('manga', () => {
	it('creates, lists and updates manga', () => {
		expect(() => createManga(db, owner, { ...manga, title: ' ' })).toThrow(MangaError);
		const id = createManga(db, owner, manga);
		expect(listMangas(db, owner)).toMatchObject([
			{ id, title: 'Ronin Road', styleStatus: 'none', thumb: null }
		]);
		updateManga(db, owner, id, { ...manga, title: 'Ronin Road II', readingDirection: 'ltr' });
		expect(getManga(db, owner, id)).toMatchObject({
			title: 'Ronin Road II',
			readingDirection: 'ltr'
		});
	});

	it("keeps users out of each other's manga", () => {
		const id = createManga(db, owner, manga);
		expect(listMangas(db, other)).toEqual([]);
		expect(() => getManga(db, other, id)).toThrow(MangaError);
		expect(() => updateManga(db, other, id, manga)).toThrow(MangaError);
		expect(() => deleteManga(db, other, id)).toThrow(MangaError);
		expect(() => startStyle(db, other, id, look)).toThrow(MangaError);
	});

	it('shows a thumbnail once the style has samples', async () => {
		const { id } = await approvedManga();
		const listed = getManga(db, owner, id);
		expect(listed.styleStatus).toBe('approved');
		expect(listed.thumb).toMatch(/^[0-9a-f]{64}$/);
	});

	it('allows one style per manga, and starting over', async () => {
		const id = createManga(db, owner, manga);
		startStyle(db, owner, id, look);
		expect(() => startStyle(db, owner, id, look)).toThrow(/already has a style/);
		expect(getManga(db, owner, id).styleStatus).toBe('draft');
		removeStyle(db, owner, id);
		expect(getManga(db, owner, id).styleStatus).toBe('none');
		expect(db.select().from(styles).all()).toEqual([]);
	});

	it("reuses another manga's approved style as an approved copy", async () => {
		const { styleId } = await approvedManga();
		const second = createManga(db, owner, { ...manga, title: 'Sequel' });
		expect(reusableStyles(db, owner, second)).toMatchObject([{ id: styleId, title: 'Ronin Road' }]);

		const copyId = reuseStyle(db, owner, second, styleId);
		const copy = getStyle(db, owner, copyId);
		const original = getStyle(db, owner, styleId);
		expect(copy.active?.prompt).toBe(original.active?.prompt);
		expect(copy.samples.map((s) => s.assetHash)).toEqual(original.samples.map((s) => s.assetHash));
		expect(getManga(db, owner, second).styleStatus).toBe('approved');

		// Copies are independent: removing one leaves the other.
		removeStyle(db, owner, second);
		expect(getStyle(db, owner, styleId).active).toBeTruthy();
		expect(() => reuseStyle(db, other, second, styleId)).toThrow();
	});

	it('deletes a manga with its style', async () => {
		const { id } = await approvedManga();
		deleteManga(db, owner, id);
		expect(db.select().from(mangas).all()).toEqual([]);
		expect(db.select().from(styles).all()).toEqual([]);
	});
});
