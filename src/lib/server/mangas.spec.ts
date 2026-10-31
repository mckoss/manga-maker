import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { mangas, styles } from './db/schema';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import { fakeReply } from './ai';
import { getStyle, requestPictures, styleJobHandlers } from './styles';
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
	const text = new FakeTextModel(fakeReply);
	worker = new Worker(db, { image: new FakeImageModel(), text }, styleJobHandlers);
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	other = (await createUser(db, 'yuki', 'a long enough password')).id;
});

/** A manga whose style has its prompt, scenes and sample pictures. */
async function readyManga(title = 'Ronin Road') {
	const id = createManga(db, owner, { ...manga, title });
	const styleId = startStyle(db, owner, id, look);
	await worker.drain();
	requestPictures(db, owner, styleId, 'outdated');
	await worker.drain();
	return { id, styleId };
}

const currentText = (item: {
	versions: { id: number; text: string }[];
	currentId: number | null;
}) => item.versions.find((v) => v.id === item.currentId)?.text;

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
		const { id } = await readyManga();
		const listed = getManga(db, owner, id);
		expect(listed.styleStatus).toBe('ready');
		expect(listed.thumb).toMatch(/^[0-9a-f]{64}$/);
	});

	it('allows one style per manga, and starting over', async () => {
		const id = createManga(db, owner, manga);
		startStyle(db, owner, id, look);
		expect(() => startStyle(db, owner, id, look)).toThrow(/already has a style/);
		expect(getManga(db, owner, id).styleStatus).toBe('started');
		removeStyle(db, owner, id);
		expect(getManga(db, owner, id).styleStatus).toBe('none');
		expect(db.select().from(styles).all()).toEqual([]);
	});

	it("reuses another manga's ready style as a copy", async () => {
		const { styleId } = await readyManga();
		const second = createManga(db, owner, { ...manga, title: 'Sequel' });
		expect(reusableStyles(db, owner, second)).toMatchObject([{ id: styleId, title: 'Ronin Road' }]);

		const copyId = reuseStyle(db, owner, second, styleId);
		const copy = getStyle(db, owner, copyId);
		const original = getStyle(db, owner, styleId);
		expect(currentText(copy.prompt)).toBe(currentText(original.prompt));
		expect(copy.pictures.map((p) => p.item.versions[0]?.assetHash)).toEqual(
			original.pictures.map((p) => p.item.versions[0]?.assetHash)
		);
		expect(getManga(db, owner, second).styleStatus).toBe('ready');

		// Copies are independent: removing one leaves the other.
		removeStyle(db, owner, second);
		expect(getStyle(db, owner, styleId).ready).toBe(true);
		expect(() => reuseStyle(db, other, second, styleId)).toThrow();
	});

	it('deletes a manga with its style', async () => {
		const { id } = await readyManga();
		deleteManga(db, owner, id);
		expect(db.select().from(mangas).all()).toEqual([]);
		expect(db.select().from(styles).all()).toEqual([]);
	});
});
