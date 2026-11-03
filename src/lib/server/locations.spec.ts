import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { openDb, type Db } from './db';
import { items } from './db/schema';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import { fakeReply } from './ai';
import { requestPictures as requestStylePictures, styleJobHandlers } from './styles';
import { createSeries, deleteSeries, getSeries, startStyle } from './series';
import {
	CANDIDATE_SIZE,
	chooseReference,
	createLocation,
	deleteLocation,
	getLocation,
	listLocations,
	locationAccess,
	LocationError,
	locationJobHandlers,
	locationPrompt,
	parseDesign,
	requestSheet,
	saveText,
	setDefaultLocation,
	SHEET_VIEWS,
	updateOutdated
} from './locations';

let db: Db;
let worker: Worker;
let image: FakeImageModel;
let text: FakeTextModel;
let owner: number;
let other: number;
let seriesId: number;
let styleId: number;

beforeEach(async () => {
	db = openDb(':memory:');
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-assets-'));
	image = new FakeImageModel();
	text = new FakeTextModel(fakeReply);
	worker = new Worker(db, { image, text }, { ...styleJobHandlers, ...locationJobHandlers });
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	other = (await createUser(db, 'yuki', 'a long enough password')).id;
	seriesId = createSeries(db, owner, {
		title: 'Ronin Road',
		logline: 'A swordsman walks home.',
		readingDirection: 'rtl'
	});
	styleId = startStyle(db, owner, seriesId, {
		description: 'Edo-period villages',
		colorMode: 'bw'
	});
	await worker.drain();
});

const brief = { name: '', brief: 'the inn where the travelers meet' };

const current = <T extends { versions: { id: number }[]; currentId: number | null }>(item: T) =>
	item.versions.find((v) => v.id === item.currentId) as T['versions'][number] | undefined;

/** A location with drawn design pictures. */
async function drawn() {
	requestStylePictures(db, owner, styleId, 'outdated');
	await worker.drain();
	const id = createLocation(db, owner, seriesId, brief);
	await worker.drain();
	updateOutdated(db, owner, id);
	await worker.drain();
	return id;
}

describe('locations', () => {
	it('develops a profile from the notes, then writes designs', async () => {
		const id = createLocation(db, owner, seriesId, brief);
		await worker.drain();
		const detail = getLocation(db, owner, id);
		expect(detail.location.name).toBe('The Lantern Inn');
		const setting = detail.profile.find((p) => p.kind === 'setting')!;
		expect(current(setting.item)?.text).toBe('a wooden roadside inn in a mountain pass');
		expect(detail.designs.map((d) => parseDesign(current(d.design)?.text)?.label)).toEqual([
			'close to the profile',
			'cramped, cluttered, one lamp',
			'airy, open veranda',
			'ruined, overgrown'
		]);
		const sent = text.calls.find((c) => c[0].content.includes('location scout'))![1].content;
		expect(sent).toContain('the inn where the travelers meet');
		expect(sent).toContain('Setting and look of the series: Edo-period villages');
	});

	it('draws wide, empty design pictures and a sheet from the chosen reference', async () => {
		const id = await drawn();
		const pictures = image.calls.filter((c) => c.width === CANDIDATE_SIZE.width);
		expect(pictures).toHaveLength(4);
		expect(pictures[0].height).toBe(CANDIDATE_SIZE.height);
		expect(pictures[0].prompt).toContain('Wide establishing shot of a wooden roadside inn');
		expect(pictures[0].prompt).toContain('No people.');

		const detail = getLocation(db, owner, id);
		chooseReference(db, owner, id, current(detail.designs[1].picture)!.id);
		expect(listLocations(db, owner, seriesId)[0]).toMatchObject({ hasReference: true });
		requestSheet(db, owner, id);
		await worker.drain();
		const sheet = getLocation(db, owner, id).sheet;
		expect(sheet).toHaveLength(SHEET_VIEWS.length);
		expect(sheet.every((v) => v.status === 'ok')).toBe(true);
		expect(image.edits.at(-1)!.prompt).toContain('No people.');

		// The reference goes out of date when the look changes.
		saveText(db, owner, id, 'details', 'iron kettles');
		const ref = getLocation(db, owner, id).reference.item;
		expect(current(ref)?.outOfDate).toEqual(['the details']);
	});

	it('defaults to the first location until another is chosen', async () => {
		const inn = createLocation(db, owner, seriesId, { name: 'Inn', brief: '' });
		const pass = createLocation(db, owner, seriesId, { name: 'Pass', brief: '' });
		const defaults = () => listLocations(db, owner, seriesId).filter((l) => l.isDefault);
		expect(defaults().map((l) => l.id)).toEqual([inn]);
		expect(getLocation(db, owner, inn).isDefault).toBe(true);

		setDefaultLocation(db, owner, pass);
		expect(defaults().map((l) => l.id)).toEqual([pass]);
		expect(getSeries(db, owner, seriesId)).toBeTruthy();

		// Deleting the default falls back to the first remaining.
		deleteLocation(db, owner, pass);
		expect(defaults().map((l) => l.id)).toEqual([inn]);
		expect(() => setDefaultLocation(db, other, inn)).toThrow(LocationError);
	});

	it('keeps users out, and deleting removes every item', async () => {
		const id = createLocation(db, owner, seriesId, brief);
		await worker.drain();
		expect(() => locationAccess(db, other, id)).toThrow(LocationError);
		expect(() => deleteLocation(db, other, id)).toThrow(LocationError);
		const locationItems = () =>
			db.select().from(items).where(like(items.scope, 'location:%')).all();
		expect(locationItems().length).toBeGreaterThan(0);
		deleteLocation(db, owner, id);
		expect(locationItems()).toEqual([]);
		createLocation(db, owner, seriesId, brief);
		await worker.drain();
		deleteSeries(db, owner, seriesId);
		expect(locationItems()).toEqual([]);
	});

	it('writes the prompt from the look', () => {
		const prompt = locationPrompt(
			{ colorMode: 'bw', prompt: 'bold ink' },
			{ setting: 'A harbor', appearance: 'stone piers', details: 'nets and barrels' }
		);
		expect(prompt).toContain('Wide establishing shot of a harbor, empty');
		expect(prompt).toContain('With nets and barrels.');
	});
});
