import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './db';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import { fakeReplies } from './ai';
import type { FakeReplyFn } from './ai/fake';
import type { PromptId } from './prompts';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import { createSeries } from './series';
import { chapters, characters, locations } from './db/schema';
import { chooseStructure, plotJobHandlers, saveBeat, updatePlot } from './plots';
import { characterJobHandlers } from './characters';
import { deleteChapter } from './chapters';
import { addVersion, currentVersions, ensureItem, itemsIn } from './versions';
import { scopeOf } from './pipeline/ids';
import { panelText, parsePanel, type TextBlock } from '#lib/script.js';
import {
	addPage,
	addPanel,
	checkPage,
	deletePage,
	deletePanel,
	getScript,
	movePage,
	movePanel,
	savePage,
	savePanel,
	saveWords,
	requestFill,
	requestLayout,
	scriptAccess,
	ScriptError,
	scriptJobHandlers
} from './scripts';

let db: Db;
let worker: Worker;
let owner: number;
let seriesId: number;
let chapterId: number;
let text: FakeTextModel;
/** Replies a test swaps in for the canned ones, by prompt id. */
let overrides: Partial<Record<PromptId, FakeReplyFn>>;

beforeEach(async () => {
	db = openDb(':memory:');
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-assets-'));
	overrides = {};
	text = new FakeTextModel((m, id) => (overrides[id] ?? fakeReplies[id])(m));
	worker = new Worker(
		db,
		{ image: new FakeImageModel(), text },
		{ ...plotJobHandlers, ...characterJobHandlers, ...scriptJobHandlers }
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

const script = () => getScript(db, owner, seriesId, chapterId);
const ctx = () => [db, owner, seriesId, chapterId] as const;

/** A full fake plot: serial structure, five beats of four pages each. */
async function withPlot() {
	updatePlot(db, owner, seriesId, chapterId);
	await worker.drain();
}

const now = new Date();
function addCharacter(sid: number, name: string) {
	return db
		.insert(characters)
		.values({ seriesId: sid, name, seed: 1, createdAt: now, updatedAt: now })
		.returning()
		.get().id;
}
function addLocation(sid: number, name: string) {
	return db
		.insert(locations)
		.values({ seriesId: sid, name, seed: 1, createdAt: now, updatedAt: now })
		.returning()
		.get().id;
}

const pageIds = () => {
	const s = script();
	return [...s.beats.flatMap((b) => b.pages), ...s.orphans].map((p) => p.id);
};
const pageOf = (id: string) =>
	[...script().beats.flatMap((b) => b.pages), ...script().orphans].find((p) => p.id === id)!;

describe('script', () => {
	it('is empty before there is a plot', () => {
		const s = script();
		expect(s).toMatchObject({
			readingDirection: 'rtl',
			pageTarget: 20,
			hasOutline: false,
			beats: [],
			orphans: [],
			totals: { pages: 0, panels: 0, blocks: 0 },
			busy: false
		});
		expect(() => addPage(...ctx(), 'hook')).toThrow(ScriptError);
	});

	it('shows the plot’s beats with their planned pages and no pages yet', async () => {
		await withPlot();
		const s = script();
		expect(s.hasOutline).toBe(true);
		expect(s.beats.map((b) => b.key)).toEqual([
			'hook',
			'complication',
			'escalation',
			'turn',
			'cliffhanger'
		]);
		expect(s.beats.every((b) => b.plannedPages === 4 && b.text && b.pages.length === 0)).toBe(true);
		expect(s.beats[0].label).toBeTruthy();
		expect(s.people.map((p) => p.name)).toContain('Old Watchman');
	});

	it('adds, saves, moves and deletes pages, grouped by beat and numbered in reading order', async () => {
		await withPlot();
		const t1 = addPage(...ctx(), 'turn');
		const h1 = addPage(...ctx(), 'hook');
		const h2 = addPage(...ctx(), 'hook');
		const h0 = addPage(...ctx(), 'hook', h1);
		expect(pageIds()).toEqual([h1, h0, h2, t1]);
		expect(() => addPage(...ctx(), 'hook', t1)).toThrow(ScriptError);
		expect(() => addPage(...ctx(), 'nope')).toThrow(ScriptError);

		let s = script();
		expect(s.beats[0].pages.map((p) => p.number)).toEqual([1, 2, 3]);
		expect(s.beats[3].pages[0]).toMatchObject({ number: 4, beatChanged: false, purpose: '' });
		expect(s.totals.pages).toBe(4);

		savePage(...ctx(), h1, { purpose: '  Aiko at the gate. ', turn: true });
		expect(pageOf(h1)).toMatchObject({ purpose: 'Aiko at the gate.', turn: true });

		movePage(...ctx(), h1, 1);
		expect(pageIds()).toEqual([h0, h1, h2, t1]);
		movePage(...ctx(), h2, 1); // the edge of its beat: nothing moves
		expect(pageIds()).toEqual([h0, h1, h2, t1]);

		// Moving to another beat puts it at the end of that beat's pages.
		savePage(...ctx(), h0, { beat: 'turn' });
		expect(pageIds()).toEqual([h1, h2, t1, h0]);
		expect(() => savePage(...ctx(), h0, { beat: 'nope' })).toThrow(ScriptError);

		deletePage(...ctx(), h2);
		expect(pageIds()).toEqual([h1, t1, h0]);
		expect(() => deletePage(...ctx(), h2)).toThrow(ScriptError);
		s = script();
		expect(s.totals.pages).toBe(3);
	});

	it('adds, moves and deletes panels, and keeps the key panel valid', async () => {
		await withPlot();
		const page = addPage(...ctx(), 'hook');
		const a = addPanel(...ctx(), page);
		const c = addPanel(...ctx(), page);
		const b = addPanel(...ctx(), page, a);
		const panels = () => pageOf(page).panels.map((p) => p.id);
		expect(panels()).toEqual([a, b, c]);
		expect(pageOf(page).panels.map((p) => p.number)).toEqual([1, 2, 3]);
		// Not saved yet: shown empty, with no item.
		expect(pageOf(page).panels[0]).toMatchObject({ item: null, wordsItem: null });
		expect(pageOf(page).panels[0].panel.shot).toBe('');

		movePanel(...ctx(), c, -1);
		expect(panels()).toEqual([a, c, b]);
		movePanel(...ctx(), a, -1);
		expect(panels()).toEqual([a, c, b]);

		expect(() => savePage(...ctx(), page, { keyPanel: 'zzzzzzzz' })).toThrow(ScriptError);
		savePage(...ctx(), page, { keyPanel: c });
		expect(pageOf(page).panels.find((p) => p.id === c)!.isKey).toBe(true);

		savePanel(...ctx(), c, { action: 'The letter, wet with rain.' });
		saveWords(...ctx(), c, [{ id: '', kind: 'caption', speaker: null, text: 'Later.' }]);
		expect(script().totals).toMatchObject({ panels: 3, blocks: 1 });
		deletePanel(...ctx(), c);
		expect(panels()).toEqual([a, b]);
		expect(pageOf(page).keyPanel).toBeNull();
		const left = itemsIn(db, scopeOf.script(chapterId)).map((i) => `${i.kind}:${i.key}`);
		expect(left).toEqual(['layout:']);

		// Deleting a page deletes its panels' items.
		savePanel(...ctx(), a, { action: 'Rain.' });
		deletePage(...ctx(), page);
		expect(itemsIn(db, scopeOf.script(chapterId)).map((i) => i.kind)).toEqual(['layout']);
	});

	it('validates staging and clears the AI-draft mark from changed fields', async () => {
		await withPlot();
		const page = addPage(...ctx(), 'hook');
		const pid = addPanel(...ctx(), page);
		const it = ensureItem(db, owner, scopeOf.script(chapterId), 'panel', pid);
		addVersion(db, it, {
			origin: 'ai',
			text: panelText({
				shot: 'wide',
				location: null,
				characters: [],
				action: 'A mountain pass.',
				cue: '',
				ai: ['action', 'shot']
			})
		});
		expect(() => savePanel(...ctx(), pid, { shot: 'sideways' as never })).toThrow(ScriptError);

		const other = createSeries(db, owner, { title: 'Other', logline: '', readingDirection: 'ltr' });
		const foreignPlace = addLocation(other, 'Elsewhere');
		const foreignPerson = addCharacter(other, 'Stranger');
		const place = addLocation(seriesId, 'The pass');
		const aiko = addCharacter(seriesId, 'Aiko');
		expect(() => savePanel(...ctx(), pid, { location: foreignPlace })).toThrow(ScriptError);

		savePanel(...ctx(), pid, {
			shot: 'wide',
			action: '  A snowy pass. ',
			location: place,
			characters: [aiko, aiko, foreignPerson]
		});
		const view = pageOf(page).panels[0];
		expect(view.panel).toMatchObject({
			shot: 'wide',
			action: 'A snowy pass.',
			location: place,
			characters: [aiko],
			ai: ['shot']
		});
		expect(view.item).toMatchObject({ pending: false, error: null, versions: 2 });

		// Saving the same thing again adds no version.
		savePanel(...ctx(), pid, { action: 'A snowy pass.' });
		expect(pageOf(page).panels[0].item?.versions).toBe(2);
		expect(parsePanel(undefined).ai).toEqual([]);
		expect(() => savePanel(...ctx(), 'zzzzzzzz', { action: 'x' })).toThrow(ScriptError);
	});

	it('validates words: captions have no speaker, empty blocks go, strangers are refused', async () => {
		await withPlot();
		const page = addPage(...ctx(), 'hook');
		const pid = addPanel(...ctx(), page);
		const aiko = addCharacter(seriesId, 'Aiko');
		const other = createSeries(db, owner, { title: 'Other', logline: '', readingDirection: 'ltr' });
		const stranger = addCharacter(other, 'Stranger');

		const blocks = [
			{ id: 'abcd1234', kind: 'speech', speaker: aiko, text: ' I must go. ' },
			{ kind: 'caption', speaker: aiko, text: 'Dawn.' },
			{ id: 'efgh5678', kind: 'thought', speaker: aiko, text: '   ' }
		] as TextBlock[];
		saveWords(...ctx(), pid, blocks);
		const words = pageOf(page).panels[0].words;
		expect(words).toHaveLength(2);
		expect(words[0]).toEqual({ id: 'abcd1234', kind: 'speech', speaker: aiko, text: 'I must go.' });
		expect(words[1]).toMatchObject({ kind: 'caption', speaker: null, text: 'Dawn.' });
		expect(words[1].id).toMatch(/^[a-z0-9]{4,16}$/);
		expect(script().totals.blocks).toBe(2);

		expect(() =>
			saveWords(...ctx(), pid, [{ id: 'abcd1234', kind: 'speech', speaker: stranger, text: 'Hi' }])
		).toThrow(ScriptError);
		expect(() =>
			saveWords(...ctx(), pid, [
				{ id: 'abcd1234', kind: 'shout' as never, speaker: null, text: 'Hi' }
			])
		).toThrow(ScriptError);
		expect(pageOf(page).panels[0].wordsItem?.versions).toBe(1);
	});

	it('flags pages when their beat changes, until checked', async () => {
		await withPlot();
		const page = addPage(...ctx(), 'hook');
		const other = addPage(...ctx(), 'turn');
		saveBeat(db, owner, seriesId, chapterId, 'hook', {
			text: 'Aiko finds the letter is blank.',
			pages: 3,
			characters: []
		});
		expect(pageOf(page).beatChanged).toBe(true);
		expect(pageOf(other).beatChanged).toBe(false);
		expect(script().beats[0].plannedPages).toBe(3);
		checkPage(...ctx(), page);
		expect(pageOf(page).beatChanged).toBe(false);
	});

	it('moves pages to orphans when the structure changes', async () => {
		await withPlot();
		const h = addPage(...ctx(), 'hook');
		const t = addPage(...ctx(), 'turn');
		chooseStructure(db, owner, seriesId, chapterId, 'kishotenketsu');
		let s = script();
		expect(s.beats.map((b) => b.key)).toEqual(['ki', 'sho', 'ten', 'ketsu']);
		expect(s.hasOutline).toBe(false);
		expect(s.orphans.map((p) => p.id)).toEqual([h, t]);
		expect(s.orphans.map((p) => [p.number, p.beatChanged])).toEqual([
			[1, false],
			[2, false]
		]);

		// A new page goes before the orphans; an orphan can join a current beat.
		const k = addPage(...ctx(), 'ki');
		savePage(...ctx(), t, { beat: 'ki' });
		s = script();
		expect(s.beats[0].pages.map((p) => [p.id, p.number])).toEqual([
			[k, 1],
			[t, 2]
		]);
		expect(s.orphans.map((p) => [p.id, p.number])).toEqual([[h, 3]]);
	});

	it('is deleted with its chapter', async () => {
		await withPlot();
		const page = addPage(...ctx(), 'hook');
		const pid = addPanel(...ctx(), page);
		savePanel(...ctx(), pid, { action: 'Rain.' });
		expect(itemsIn(db, scopeOf.script(chapterId)).length).toBe(2);
		deleteChapter(db, owner, seriesId, chapterId);
		expect(itemsIn(db, scopeOf.script(chapterId))).toEqual([]);
	});

	it('belongs to its owner only', async () => {
		await withPlot();
		const page = addPage(...ctx(), 'hook');
		const intruder = (await createUser(db, 'mallory', 'another long password')).id;
		expect(scriptAccess(...ctx())).toEqual({ ownerId: owner, scope: scopeOf.script(chapterId) });
		expect(() => getScript(db, intruder, seriesId, chapterId)).toThrow();
		expect(() => scriptAccess(db, intruder, seriesId, chapterId)).toThrow();
		expect(() => addPage(db, intruder, seriesId, chapterId, 'hook')).toThrow();
		expect(() => deletePage(db, intruder, seriesId, chapterId, page)).toThrow();
		expect(pageIds()).toEqual([page]);
	});
});

describe('script help', () => {
	const scope = () => scopeOf.script(chapterId);
	const kinds = () => itemsIn(db, scope()).map((i) => i.kind);
	const panelOf = (pid: string) =>
		parsePanel(currentVersions(db, scope()).get(`panel:${pid}`)?.text);
	const lastRequest = () => text.calls.at(-1)![1].content;

	it('lays out a beat with no pages: its planned pages of AI-drafted panels, never words', async () => {
		await withPlot();
		requestLayout(...ctx(), 'hook', 'Open on the storm.');
		let s = script();
		expect(s.busy).toBe(true);
		expect(s.beats[0]).toMatchObject({ pending: true, error: null });
		expect(s.beats[1].pending).toBe(false);

		await worker.drain();
		expect(lastRequest()).toMatch(/^Pages to lay out: 4$/m);
		expect(lastRequest()).toMatch(/^The writer's feedback: Open on the storm\.$/m);
		s = script();
		expect(s.busy).toBe(false);
		const beat = s.beats[0];
		expect(beat).toMatchObject({ pending: false, error: null });
		expect(beat.pages).toHaveLength(4);
		expect(beat.pages.map((p) => p.number)).toEqual([1, 2, 3, 4]);
		expect(beat.pages.every((p) => p.purpose && !p.beatChanged && p.panels.length === 3)).toBe(
			true
		);
		expect(beat.pages[3].turn).toBe(true);
		const first = beat.pages[0].panels;
		expect(first[0].panel).toMatchObject({ shot: 'establishing', ai: ['shot', 'action'] });
		expect(first[1].panel.ai).toEqual(['shot', 'action', 'cue']);
		expect(first[0].item?.versions).toBe(1);
		expect(kinds()).not.toContain('words');

		// Its versions are the AI's, with the prompt and the run record.
		const layout = currentVersions(db, scope()).get('layout')!;
		expect(layout).toMatchObject({ origin: 'ai', promptId: 'script.layout', model: 'fake-text' });
		expect(layout.runHash).toBeTruthy();
		expect(currentVersions(db, scope()).get('help-beat:hook')?.text).toMatch(/Laid out 4 pages/);

		expect(() => requestLayout(...ctx(), 'hook')).toThrow(/already has pages/);
		expect(() => requestLayout(...ctx(), 'nope')).toThrow(ScriptError);
	});

	it('adds nothing when the user adds a page to the beat while the layout waits', async () => {
		await withPlot();
		const mine = addPage(...ctx(), 'turn');
		savePage(...ctx(), mine, { purpose: 'Mine.' });
		requestLayout(...ctx(), 'hook');
		const page = addPage(...ctx(), 'hook');
		await worker.drain();
		expect(pageIds()).toEqual([page, mine]);
		expect(pageOf(mine).purpose).toBe('Mine.');
		expect(kinds().filter((k) => k === 'panel')).toEqual([]);
		expect(script().beats[0]).toMatchObject({ pending: false, error: null });

		// The same when the page is added while the AI is working.
		requestLayout(...ctx(), 'complication');
		overrides['script.layout'] = (m) => {
			addPage(...ctx(), 'complication');
			return fakeReplies['script.layout'](m);
		};
		await worker.drain();
		expect(script().beats[1].pages).toHaveLength(1);
		expect(kinds().filter((k) => k === 'panel')).toEqual([]);
		expect(currentVersions(db, scope()).get('help-beat:complication')?.text).toMatch(
			/Nothing was added/
		);
	});

	it('keeps the user’s pages exactly and puts the new ones in the beat’s place', async () => {
		await withPlot();
		const later = addPage(...ctx(), 'turn');
		const lp = addPanel(...ctx(), later);
		savePanel(...ctx(), lp, { action: 'Mine.' });
		requestLayout(...ctx(), 'hook');
		await worker.drain();
		const ids = pageIds();
		expect(ids).toHaveLength(5);
		expect(ids.at(-1)).toBe(later);
		expect(pageOf(later).panels.map((p) => p.panel.action)).toEqual(['Mine.']);
		expect(panelOf(lp).ai).toEqual([]);
	});

	it('names only the series’ own characters and places, and creates neither', async () => {
		await withPlot();
		const aiko = addCharacter(seriesId, 'Aiko');
		const pass = addLocation(seriesId, 'The Pass');
		const people = db.select().from(characters).all().length;
		overrides['script.layout'] = () => ({
			pages: [
				{
					purpose: 'Aiko on the pass.',
					turn: false,
					panels: [
						{
							shot: 'Wide',
							location: 'the pass',
							characters: ['aiko', 'A Ghost'],
							action: 'Aiko climbs.',
							cue: ''
						},
						{ shot: 'sideways', location: 'Atlantis', characters: ['Nobody'], action: 'Wind.' }
					]
				}
			],
			notes: 'Short.'
		});
		requestLayout(...ctx(), 'hook');
		await worker.drain();
		expect(lastRequest()).toMatch(/^- The Pass/m);
		const [a, b] = script().beats[0].pages[0].panels.map((p) => p.panel);
		expect(a).toMatchObject({
			shot: 'wide',
			location: pass,
			characters: [aiko],
			ai: ['shot', 'location', 'characters', 'action']
		});
		expect(b).toMatchObject({ shot: '', location: null, characters: [], ai: ['action'] });
		expect(db.select().from(characters).all().length).toBe(people);
	});

	it('writes no words even when the reply smuggles them in', async () => {
		await withPlot();
		const aiko = addCharacter(seriesId, 'Aiko');
		const words = [{ id: 'abcd1234', kind: 'speech', speaker: aiko, text: 'Hello!' }];
		overrides['script.layout'] = () => ({
			pages: [
				{
					purpose: 'A page.',
					turn: false,
					words,
					panels: [{ shot: 'close', action: 'Aiko.', cue: '', dialogue: 'Hello!', words }]
				}
			],
			words,
			dialogue: ['Hello!'],
			notes: ''
		});
		requestLayout(...ctx(), 'hook');
		await worker.drain();
		const page = script().beats[0].pages[0];
		overrides['script.fill'] = (m) => ({
			...(fakeReplies['script.fill'](m) as object),
			words,
			panels: [{ id: page.panels[0].id, characters: ['Aiko'], dialogue: 'Hi', words, text: 'Hi' }]
		});
		requestFill(...ctx(), page.id);
		await worker.drain();
		expect(page.panels[0].panel.action).toBe('Aiko.');
		expect(pageOf(page.id).panels[0].panel.characters).toEqual([aiko]);
		expect(kinds()).not.toContain('words');
		expect(script().totals.blocks).toBe(0);
		const stored = itemsIn(db, scope())
			.map((i) => currentVersions(db, scope()).get(i.key ? `${i.kind}:${i.key}` : i.kind)?.text)
			.join('\n');
		expect(stored).not.toMatch(/Hello|dialogue|"words"/);
	});

	it('fills only blanks, never a field the user wrote, even while the job waits or runs', async () => {
		await withPlot();
		const aiko = addCharacter(seriesId, 'Aiko');
		const pass = addLocation(seriesId, 'The Pass');
		const page = addPage(...ctx(), 'hook');
		const a = addPanel(...ctx(), page);
		const b = addPanel(...ctx(), page);
		savePanel(...ctx(), a, { action: 'Aiko reads the letter.' });
		saveWords(...ctx(), a, [{ id: '', kind: 'speech', speaker: aiko, text: 'It is blank!' }]);

		overrides['script.fill'] = (m) => {
			// The user types while the AI works.
			savePanel(...ctx(), a, { shot: 'close' });
			const ids = [...m[1].content.matchAll(/^- panel ([a-z0-9]+):/gm)].map((x) => x[1]);
			return {
				purpose: 'The letter is blank.',
				panels: [...ids, 'zzzzzzzz'].map((id) => ({
					id,
					shot: 'wide',
					location: 'The Pass',
					characters: ['Aiko', 'Nobody'],
					action: 'AI action.',
					cue: 'What does Aiko say?'
				})),
				notes: 'Filled.'
			};
		};
		requestFill(...ctx(), page, 'Keep it quiet.');
		expect(pageOf(page)).toMatchObject({ pending: true, error: null });
		expect(script().busy).toBe(true);
		// And between the request and the job.
		savePanel(...ctx(), b, { cue: 'My own cue.' });
		await worker.drain();

		const request = lastRequest();
		expect(request).toMatch(/^Page purpose: \(blank\)$/m);
		expect(request).toContain('Aiko says: "It is blank!"');
		expect(request).toContain(`- panel ${a}: action: Aiko reads the letter.; blank: shot,`);
		expect(request).toMatch(/^The writer's feedback: Keep it quiet\.$/m);

		const view = pageOf(page);
		expect(view).toMatchObject({ pending: false, error: null, purpose: 'The letter is blank.' });
		expect(panelOf(a)).toEqual({
			shot: 'close',
			location: pass,
			characters: [aiko],
			action: 'Aiko reads the letter.',
			cue: 'What does Aiko say?',
			ai: ['location', 'characters', 'cue']
		});
		expect(panelOf(b)).toEqual({
			shot: 'wide',
			location: pass,
			characters: [aiko],
			action: 'AI action.',
			cue: 'My own cue.',
			ai: ['shot', 'location', 'characters', 'action']
		});
		expect(view.panels[0].words).toEqual([expect.objectContaining({ text: 'It is blank!' })]);
		expect(pageOf(page).panels.map((p) => p.id)).toEqual([a, b]);
		const v = currentVersions(db, scope()).get(`panel:${b}`)!;
		expect(v).toMatchObject({ origin: 'ai', promptId: 'script.fill', model: 'fake-text' });

		// The user edits an AI draft: it is theirs now.
		savePanel(...ctx(), b, { action: 'Rain on the pass.' });
		expect(panelOf(b).ai).toEqual(['shot', 'location', 'characters']);
		savePanel(...ctx(), b, { shot: 'wide' }); // unchanged: still the AI's draft
		expect(panelOf(b).ai).toContain('shot');
	});

	it('plans panels for an empty page, and refuses a page with nothing blank', async () => {
		await withPlot();
		const page = addPage(...ctx(), 'hook');
		requestFill(...ctx(), page);
		await worker.drain();
		expect(lastRequest()).toMatch(/^New panels: 4$/m);
		let view = pageOf(page);
		expect(view.purpose).toBe('A fake purpose for the page.');
		expect(view.panels).toHaveLength(4);
		expect(view.panels[0].panel).toMatchObject({
			shot: 'medium',
			ai: ['shot', 'action', 'cue']
		});
		expect(kinds()).not.toContain('words');

		// Write every blank (the series has characters but no places).
		const watchman = script().people[0].id;
		for (const p of view.panels) savePanel(...ctx(), p.id, { characters: [watchman] });
		expect(() => requestFill(...ctx(), page)).toThrow(/Nothing to fill/);
		addLocation(seriesId, 'The Pass');
		requestFill(...ctx(), page); // locations are blank now
		await worker.drain();
		view = pageOf(page);
		expect(view.panels.every((p) => p.panel.location === null)).toBe(true); // the fake names none
		expect(() => requestFill(...ctx(), 'zzzzzzzz')).toThrow(ScriptError);
	});

	it('shows a failed job on its beat or page, and drops a page’s job with the page', async () => {
		await withPlot();
		overrides['script.layout'] = () => {
			throw new Error('The model is down.');
		};
		requestLayout(...ctx(), 'hook');
		await worker.drain();
		expect(script().beats[0]).toMatchObject({ pending: false, error: 'The model is down.' });
		expect(script().beats[0].pages).toEqual([]);

		const page = addPage(...ctx(), 'turn');
		requestFill(...ctx(), page);
		deletePage(...ctx(), page);
		await worker.drain();
		expect(kinds()).toEqual(['help-beat', 'layout']);
		expect(script().busy).toBe(false);
	});
});
