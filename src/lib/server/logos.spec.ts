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
import {
	chooseReference as choosePlace,
	createLocation,
	getLocation,
	locationJobHandlers,
	updateOutdated as updatePlace
} from './locations';
import { itemsIn } from './versions';
import { readAsset } from './assets';
import type { ImageRunRecord } from './runs';

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
		{ ...styleJobHandlers, ...characterJobHandlers, ...logoJobHandlers, ...locationJobHandlers }
	);
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	seriesId = createSeries(db, owner, {
		title: 'Ronin Road',
		logline: 'A swordsman walks home through a war-torn countryside.',
		readingDirection: 'ltr'
	});
	styleId = startStyle(db, owner, seriesId, {
		description: 'Edo-period villages',
		colorMode: 'bw'
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

	it('sets the protagonist in front of the default location, once it has a reference', async () => {
		await protagonist();
		requestLogo(db, owner, seriesId);
		await worker.drain();
		const inn = createLocation(db, owner, seriesId, { name: 'Inn', brief: 'a mountain inn' });
		await worker.drain();
		// No reference yet: the logo stays up to date, drawn from the logline.
		const before = getLogo(db, owner, seriesId);
		expect(before.place).toBeNull();
		expect(before.item.versions.at(-1)!.outOfDate).toEqual([]);

		updatePlace(db, owner, inn);
		await worker.drain();
		const picture = getLocation(db, owner, inn).designs[0].picture;
		choosePlace(db, owner, inn, picture.currentId!);
		const after = getLogo(db, owner, seriesId);
		expect(after.place).toEqual({ id: inn, name: 'Inn' });
		expect(after.item.versions.at(-1)!.outOfDate).toEqual(['the default location']);

		requestLogo(db, owner, seriesId);
		await worker.drain();
		const edit = image.edits.at(-1)!;
		expect(edit.images).toHaveLength(2);
		// The place is image 1, which the edit builds on; the character is image 2.
		for (const img of edit.images)
			expect(await sharp(img).metadata()).toMatchObject({ width: 1024, height: 1024 });
		expect(edit.prompt).toContain('the character from image 2 in front of the place in image 1');
	});

	it('keeps a run record of the logo, naming the pictures it was made from', async () => {
		const { pictures } = await protagonist();
		requestLogo(db, owner, seriesId);
		await worker.drain();
		const { item } = getLogo(db, owner, seriesId);
		const logo = item.versions.find((v) => v.id === item.currentId)!;
		const run = JSON.parse(readAsset(logo.runHash!).toString('utf8')) as ImageRunRecord;
		expect(run).toMatchObject({
			kind: 'image',
			model: logo.model,
			seed: logo.seed,
			request: { prompt: logo.text, images: [pictures[0].assetHash] }
		});
		expect(run.workflow).toMatchObject({ fake: true, prompt: logo.text, seed: logo.seed });
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
