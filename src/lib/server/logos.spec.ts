import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './db';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import { fakeReply } from './ai';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import { requestPictures as requestStylePictures, styleJobHandlers } from './styles';
import { createSeries, deleteSeries, listSeries, startStyle } from './series';
import {
	characterJobHandlers,
	chooseReference,
	createCharacter,
	getCharacter,
	updateOutdated
} from './characters';
import { getLogo, logoJobHandlers, logoPrompt, requestLogo, stopLogo } from './logos';
import { itemsIn } from './versions';

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
	worker = new Worker(
		db,
		{ image, text: new FakeTextModel(fakeReply) },
		{ ...styleJobHandlers, ...characterJobHandlers, ...logoJobHandlers }
	);
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	seriesId = createSeries(db, owner, {
		title: 'Ronin Road',
		logline: 'A swordsman walks home through a war-torn countryside.',
		readingDirection: 'ltr'
	});
	styleId = startStyle(db, owner, seriesId, {
		description: 'Edo-period villages',
		colorMode: 'bw',
		model: 'qwen-image'
	});
	await worker.drain();
	requestStylePictures(db, owner, styleId, 'outdated');
	await worker.drain();
});

/** A protagonist with designs drawn, and the first picture chosen as the reference. */
async function protagonist() {
	const id = createCharacter(db, owner, seriesId, {
		name: 'Jun',
		role: 'protagonist',
		brief: 'a young swordsman'
	});
	await worker.drain();
	updateOutdated(db, owner, id);
	await worker.drain();
	const pictures = getCharacter(db, owner, id).designs.map((d) =>
		d.picture.versions.find((v) => v.id === d.picture.currentId)!
	);
	chooseReference(db, owner, id, pictures[0].id);
	return { id, pictures };
}

describe('series logo', () => {
	it('waits for a protagonist with a reference picture', async () => {
		expect(getLogo(db, owner, seriesId).canDraw).toBe(false);
		expect(() => requestLogo(db, owner, seriesId)).toThrow(/protagonist/);
		// A supporting character's reference is not enough.
		createCharacter(db, owner, seriesId, {
			name: 'Goro',
			role: 'supporting',
			brief: 'an old monk'
		});
		await worker.drain();
		expect(getLogo(db, owner, seriesId).protagonist).toBeNull();
	});

	it('draws a square logo from the protagonist, and uses it as the cover', async () => {
		const { id, pictures } = await protagonist();
		const logo = getLogo(db, owner, seriesId);
		expect(logo.canDraw).toBe(true);
		expect(logo.protagonist).toEqual({ id, name: 'Jun' });

		requestLogo(db, owner, seriesId, { guidance: 'a sword over one shoulder' });
		await worker.drain();
		const { item } = getLogo(db, owner, seriesId);
		const current = item.versions.find((v) => v.id === item.currentId)!;
		expect(current.assetHash).toBeTruthy();
		expect(current.outOfDate).toEqual([]);

		const edit = image.edits.at(-1)!;
		expect(edit.prompt).toBe(
			logoPrompt(
				'bw',
				'A swordsman walks home through a war-torn countryside.',
				'a sword over one shoulder'
			)
		);
		expect(await sharp(edit.images[0]).metadata()).toMatchObject({ width: 1024, height: 1024 });

		expect(listSeries(db, owner)[0]).toMatchObject({
			logo: current.thumbHash,
			thumb: current.thumbHash
		});

		// A new reference for the protagonist puts the logo out of date.
		chooseReference(db, owner, id, pictures[1].id);
		const stale = getLogo(db, owner, seriesId).item;
		expect(stale.versions.find((v) => v.id === stale.currentId)!.outOfDate).toEqual([
			'the protagonist’s reference picture'
		]);
	});

	it('stops drawing on request, and goes with the series', async () => {
		await protagonist();
		const before = image.edits.length;
		requestLogo(db, owner, seriesId);
		expect(getLogo(db, owner, seriesId).item.pending).toBe(true);
		stopLogo(db, owner, seriesId);
		await worker.drain();
		expect(getLogo(db, owner, seriesId).item.pending).toBe(false);
		expect(image.edits).toHaveLength(before);

		deleteSeries(db, owner, seriesId);
		expect(itemsIn(db, `series:${seriesId}`)).toEqual([]);
	});
});
