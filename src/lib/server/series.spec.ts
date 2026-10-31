import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { series, styles } from './db/schema';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import { fakeReply } from './ai';
import { getStyle, requestPictures, styleJobHandlers } from './styles';
import {
	createSeries,
	deleteSeries,
	getSeries,
	listSeries,
	SeriesError,
	removeStyle,
	reusableStyles,
	reuseStyle,
	startStyle,
	updateSeries
} from './series';
import {
	ChapterError,
	createChapter,
	deleteChapter,
	listChapters,
	ownedChapter,
	updateChapter
} from './chapters';

let db: Db;
let worker: Worker;
let owner: number;
let other: number;

const info = {
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

/** A series whose style has its prompt, scenes and sample pictures. */
async function readySeries(title = 'Ronin Road') {
	const id = createSeries(db, owner, { ...info, title });
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

describe('series', () => {
	it('creates, lists and updates series, each with a first chapter', () => {
		expect(() => createSeries(db, owner, { ...info, title: ' ' })).toThrow(SeriesError);
		const id = createSeries(db, owner, info);
		expect(listSeries(db, owner)).toMatchObject([
			{ id, title: 'Ronin Road', styleStatus: 'none', thumb: null }
		]);
		updateSeries(db, owner, id, { ...info, title: 'Ronin Road II', readingDirection: 'ltr' });
		expect(getSeries(db, owner, id)).toMatchObject({
			title: 'Ronin Road II',
			readingDirection: 'ltr'
		});
	});

	it("keeps users out of each other's series", () => {
		const id = createSeries(db, owner, info);
		expect(listSeries(db, other)).toEqual([]);
		expect(() => getSeries(db, other, id)).toThrow(SeriesError);
		expect(() => updateSeries(db, other, id, info)).toThrow(SeriesError);
		expect(() => deleteSeries(db, other, id)).toThrow(SeriesError);
		expect(() => startStyle(db, other, id, look)).toThrow(SeriesError);
	});

	it('shows a thumbnail once the style has samples', async () => {
		const { id } = await readySeries();
		const listed = getSeries(db, owner, id);
		expect(listed.styleStatus).toBe('ready');
		expect(listed.thumb).toMatch(/^[0-9a-f]{64}$/);
	});

	it('allows one style per series, and starting over', async () => {
		const id = createSeries(db, owner, info);
		startStyle(db, owner, id, look);
		expect(() => startStyle(db, owner, id, look)).toThrow(/already has a style/);
		expect(getSeries(db, owner, id).styleStatus).toBe('started');
		removeStyle(db, owner, id);
		expect(getSeries(db, owner, id).styleStatus).toBe('none');
		expect(db.select().from(styles).all()).toEqual([]);
	});

	it("reuses another series' ready style as a copy", async () => {
		const { styleId } = await readySeries();
		const second = createSeries(db, owner, { ...info, title: 'Sequel' });
		expect(reusableStyles(db, owner, second)).toMatchObject([{ id: styleId, title: 'Ronin Road' }]);

		const copyId = reuseStyle(db, owner, second, styleId);
		const copy = getStyle(db, owner, copyId);
		const original = getStyle(db, owner, styleId);
		expect(currentText(copy.prompt)).toBe(currentText(original.prompt));
		expect(copy.pictures.map((p) => p.item.versions[0]?.assetHash)).toEqual(
			original.pictures.map((p) => p.item.versions[0]?.assetHash)
		);
		expect(getSeries(db, owner, second).styleStatus).toBe('ready');

		// Copies are independent: removing one leaves the other.
		removeStyle(db, owner, second);
		expect(getStyle(db, owner, styleId).ready).toBe(true);
		expect(() => reuseStyle(db, other, second, styleId)).toThrow();
	});

	it('deletes a series with its style', async () => {
		const { id } = await readySeries();
		deleteSeries(db, owner, id);
		expect(db.select().from(series).all()).toEqual([]);
		expect(db.select().from(styles).all()).toEqual([]);
	});
});

describe('chapters', () => {
	it('starts every series with chapter 1, numbers new ones, and renumbers on delete', () => {
		const id = createSeries(db, owner, info);
		expect(listChapters(db, owner, id)).toMatchObject([
			{ number: 1, name: 'Chapter 1', logline: 'A wandering swordsman.' }
		]);
		const two = createChapter(db, owner, id, { title: ' The Pass ', logline: '' });
		const three = createChapter(db, owner, id, { title: '', logline: 'Home at last.' });
		expect(listChapters(db, owner, id).map((c) => c.name)).toEqual([
			'Chapter 1',
			'The Pass',
			'Chapter 3'
		]);
		updateChapter(db, owner, id, three, { title: 'Home', logline: '' });
		deleteChapter(db, owner, id, two);
		expect(listChapters(db, owner, id).map((c) => [c.number, c.name])).toEqual([
			[1, 'Chapter 1'],
			[2, 'Home']
		]);
		expect(getSeries(db, owner, id).chapterCount).toBe(2);
	});

	it("keeps chapters inside their own user's series", () => {
		const id = createSeries(db, owner, info);
		const elsewhere = createSeries(db, owner, { ...info, title: 'Other' });
		const [chapter] = listChapters(db, owner, id);
		expect(() => ownedChapter(db, owner, elsewhere, chapter.id)).toThrow(ChapterError);
		expect(() => ownedChapter(db, other, id, chapter.id)).toThrow(SeriesError);
		expect(() => createChapter(db, other, id, { title: '', logline: '' })).toThrow(SeriesError);
	});
});
