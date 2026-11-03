import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import { fakeReply } from './ai';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import { getStyle, requestPictures, styleJobHandlers } from './styles';
import { createSeries, startStyle } from './series';
import { pictureModel, setSeriesImageModel, setUserImageModel } from './models';
import { series } from './db/schema';
import { eq } from 'drizzle-orm';

let db: Db;
let worker: Worker;
let image: FakeImageModel;
let owner: number;
let seriesId: number;
let styleId: number;

beforeEach(async () => {
	db = openDb(':memory:');
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-assets-'));
	image = new FakeImageModel();
	worker = new Worker(db, { image, text: new FakeTextModel(fakeReply) }, styleJobHandlers);
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	seriesId = createSeries(db, owner, {
		title: 'Ronin Road',
		logline: 'A swordsman walks home.',
		readingDirection: 'ltr'
	});
	styleId = startStyle(db, owner, seriesId, {
		description: 'Edo-period villages',
		colorMode: 'bw'
	});
	await worker.drain();
});

const row = () => db.select().from(series).where(eq(series.id, seriesId)).get()!;
const action = () => getStyle(db, owner, styleId).pictures.find((p) => p.key === 'action')!;
const shown = () => {
	const item = action().item;
	return item.versions.find((v) => v.id === item.currentId)!;
};

describe('image model choice', () => {
	it('uses the picture’s choice, else the series’, else the user’s default', () => {
		expect(pictureModel(db, row())).toBe('qwen-image');
		setUserImageModel(db, owner, 'z-image');
		expect(pictureModel(db, row())).toBe('z-image');
		setSeriesImageModel(db, seriesId, 'qwen-image-2.1');
		expect(pictureModel(db, row())).toBe('qwen-image-2.1');
		expect(pictureModel(db, row(), 'qwen-image')).toBe('qwen-image');
		expect(pictureModel(db, row(), 'no-such-model')).toBe('qwen-image-2.1');
		setSeriesImageModel(db, seriesId, null);
		expect(pictureModel(db, row())).toBe('z-image');
	});

	it('records the model that made each version, and a new default leaves them up to date', async () => {
		// The text the AI wrote records the text model.
		const style = getStyle(db, owner, styleId);
		expect(style.prompt.versions.at(-1)!.model).toBe('fake-text');

		setUserImageModel(db, owner, 'z-image');
		requestPictures(db, owner, styleId, 'outdated');
		await worker.drain();
		expect(shown().model).toBe('fake:z-image');
		expect(image.calls.at(-1)!.model).toBe('z-image');

		// Changing the series' model doesn't mark what was drawn out of date.
		setSeriesImageModel(db, seriesId, 'qwen-image-2.1');
		expect(shown().outOfDate).toEqual([]);

		// One picture redrawn with a model chosen for it; the batch ignores a choice.
		requestPictures(db, owner, styleId, 'action', { model: 'qwen-image' });
		await worker.drain();
		expect(shown().model).toBe('fake:qwen-image');
		requestPictures(db, owner, styleId, 'all', { model: 'qwen-image' });
		await worker.drain();
		expect(shown().model).toBe('fake:qwen-image-2.1');
	});
});
