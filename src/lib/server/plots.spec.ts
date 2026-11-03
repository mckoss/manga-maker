import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './db';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import { fakeReply } from './ai';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import { createSeries } from './series';
import { chapters } from './db/schema';
import { listCharacters } from './characters';
import {
	answerQuestions,
	chooseStructure,
	getPlot,
	plotJobHandlers,
	requestQuestions,
	requestStage,
	saveBeat,
	saveElement,
	saveNotes,
	updatePlot
} from './plots';
import { characterJobHandlers } from './characters';

let db: Db;
let worker: Worker;
let text: FakeTextModel;
let owner: number;
let seriesId: number;
let chapterId: number;

beforeEach(async () => {
	db = openDb(':memory:');
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-assets-'));
	text = new FakeTextModel(fakeReply);
	worker = new Worker(
		db,
		{ image: new FakeImageModel(), text },
		{
			...plotJobHandlers,
			...characterJobHandlers
		}
	);
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	seriesId = createSeries(db, owner, {
		title: 'Ronin Road',
		logline: 'A courier crosses the mountains.',
		readingDirection: 'rtl'
	});
	chapterId = db.select().from(chapters).where(eq(chapters.seriesId, seriesId)).get()!.id;
	db.update(chapters).set({ logline: 'Aiko must deliver a letter before the storm.' }).run();
});

const plot = () => getPlot(db, owner, seriesId, chapterId);
const current = (item: ReturnType<typeof plot>['notes']) =>
	item.versions.find((v) => v.id === item.currentId);

describe('chapter plot', () => {
	it('develops structure, elements, beats and review in order, and adds new characters', async () => {
		updatePlot(db, owner, seriesId, chapterId);
		await worker.drain();
		const p = plot();
		expect(p.structure.key).toBe('serial');
		expect(p.structure.reason).toContain('hook');
		expect(p.elements.every((e) => current(e.item)?.text)).toBe(true);
		expect(p.beats.map((b) => b.key)).toEqual([
			'hook',
			'complication',
			'escalation',
			'turn',
			'cliffhanger'
		]);
		expect(p.beats.every((b) => b.value?.pages === 4)).toBe(true);
		expect(p.pagesPlanned).toBe(20);
		expect(p.review.notes[0]).toMatchObject({ kind: 'issue' });
		expect(p.flow.beats).toMatchObject({ missing: 0, stale: 0 });
		// Everything is up to date: nothing is due.
		expect(Object.values(p.due).every((n) => n === 0)).toBe(true);

		// The character the story needs joins the series and the chapter, undeveloped.
		const watchman = listCharacters(db, owner, seriesId).find((c) => c.name === 'Old Watchman')!;
		expect(watchman.todo.every((t) => !t.done)).toBe(true);
		// The chapter's cast is everyone in its beats.
		expect(p.cast.map((c) => c.name)).toEqual(['Old Watchman']);
		expect(p.beats[0].value?.characters).toEqual([watchman.id]);
		expect(current(p.beats[0].item)?.notes).toContain('Old Watchman');
	});

	it('marks later steps out of date when the structure changes, and regenerates on request', async () => {
		updatePlot(db, owner, seriesId, chapterId);
		await worker.drain();
		chooseStructure(db, owner, seriesId, chapterId, 'kishotenketsu');
		let p = plot();
		expect(p.structure.item.locked).toBe(true);
		expect(p.elements[0].status).toBe('outdated');
		expect(p.beats.map((b) => b.key)).toEqual(['ki', 'sho', 'ten', 'ketsu']);
		expect(p.beats.every((b) => b.status === 'missing')).toBe(true);
		expect(p.due.elements).toBe(9);

		// The user's own element is locked and kept.
		saveElement(db, owner, seriesId, chapterId, 'theme', 'Patience wins.');
		updatePlot(db, owner, seriesId, chapterId);
		await worker.drain();
		p = plot();
		expect(current(p.elements.find((e) => e.kind === 'theme')!.item)?.text).toBe('Patience wins.');
		expect(p.beats.every((b) => b.value?.text)).toBe(true);
		expect(p.structure.key).toBe('kishotenketsu');

		// Editing a beat marks the review out of date; one beat regenerates with guidance.
		saveBeat(db, owner, seriesId, chapterId, 'ten', {
			text: 'The letter is blank.',
			pages: 6,
			characters: [],
			newNames: ['Courier']
		});
		// A new name in a beat adds the character, and the cast follows the beats.
		expect(
			plot()
				.cast.map((c) => c.name)
				.sort()
		).toEqual(['Courier', 'Old Watchman']);
		expect(plot().review.status).toBe('outdated');
		requestStage(db, owner, seriesId, chapterId, 'beats', {
			only: 'beat:ki',
			guidance: 'start in the rain'
		});
		await worker.drain();
		p = plot();
		expect(current(p.beats[0].item)?.guidance).toBe('start in the rain');
		expect(p.beats.find((b) => b.key === 'ten')!.value?.text).toBe('The letter is blank.');
		expect(p.review.status).toBe('ok');
	});

	it('asks about the idea and folds the answers into the notes', async () => {
		saveNotes(db, owner, seriesId, chapterId, 'A storm on the pass.');
		requestQuestions(db, owner, seriesId, chapterId);
		await worker.drain();
		expect(plot().questions.list[0].question).toBe('How should the chapter end?');
		answerQuestions(db, owner, seriesId, chapterId, ['A cliffhanger']);
		await worker.drain();
		const p = plot();
		expect(current(p.notes)?.text).toContain('A cliffhanger');
		expect(p.questions.list).toEqual([]);
		// The structure prompt includes the notes and the series.
		updatePlot(db, owner, seriesId, chapterId, ['structure']);
		await worker.drain();
		const request = text.calls.at(-1)![1]!.content;
		expect(request).toContain('A storm on the pass.');
		expect(request).toContain('Series: Ronin Road');
	});
});
