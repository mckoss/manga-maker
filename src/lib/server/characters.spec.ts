import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './db';
import { characterImages, jobs } from './db/schema';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import type { ChatMessage } from './ai/text';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import { fakeReply } from './ai';
import { requestPictures, requestPrompt, styleJobHandlers } from './styles';
import { createSeries, deleteSeries, startStyle } from './series';
import {
	CANDIDATE_COUNT,
	CANDIDATE_SIZE,
	CharacterError,
	characterJobHandlers,
	characterPrompt,
	chooseReference,
	createCharacter,
	deleteCharacter,
	getCharacter,
	listCharacters,
	requestCandidates,
	requestDevelop,
	requestSheet,
	SHEET_VIEWS,
	sheetPrompt,
	updateCharacter
} from './characters';
import {
	addToCast,
	chapterCastView,
	createChapter,
	listChapters,
	removeFromCast,
	useNewestDesign
} from './chapters';

let db: Db;
let worker: Worker;
let image: FakeImageModel;
let text: FakeTextModel;
let owner: number;
let other: number;
let seriesId: number;
let styleId: number;

function reply(messages: ChatMessage[]) {
	if (messages[0].content.includes('sample scenes')) return fakeReply(messages);
	if (messages[0].content.includes('different visual designs')) return fakeReply(messages);
	if (messages[0].content.includes('art director')) return { prompt: 'bold ink', notes: '' };
	return {
		name: 'Aiko',
		personality: 'Stubborn.',
		motivation: 'Find her brother.',
		backstory: 'Village girl.',
		speech: 'Blunt.',
		age: 'a young woman',
		appearance: 'tall, long black hair, no hat',
		outfit: 'a dark kimono, without shoes',
		notes: 'Drafted.'
	};
}

beforeEach(async () => {
	db = openDb(':memory:');
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-assets-'));
	image = new FakeImageModel();
	text = new FakeTextModel(reply);
	worker = new Worker(db, { image, text }, { ...styleJobHandlers, ...characterJobHandlers });
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	other = (await createUser(db, 'yuki', 'a long enough password')).id;
	seriesId = createSeries(db, owner, {
		title: 'Ronin Road',
		logline: 'A swordsman walks home.',
		readingDirection: 'rtl'
	});
	styleId = startStyle(db, owner, seriesId, {
		description: 'Edo-period villages',
		colorMode: 'bw',
		model: 'qwen-image'
	});
	await worker.drain();
});

/** Draw the style's sample pictures, which makes it ready to draw characters in. */
async function readyStyle() {
	requestPictures(db, owner, styleId, 'outdated');
	await worker.drain();
}

const brief = { name: '', role: 'protagonist' as const, brief: 'a runaway girl with a staff' };

describe('characters', () => {
	it('develops a profile from a brief, with the series and cast as context', async () => {
		const first = createCharacter(db, owner, seriesId, {
			...brief,
			name: 'Goro',
			brief: 'old monk'
		});
		await worker.drain();
		const id = createCharacter(db, owner, seriesId, brief);
		await worker.drain();

		const c = getCharacter(db, owner, id).character;
		expect(c.name).toBe('Aiko');
		expect(c.personality).toBe('Stubborn.');
		// Negated clauses are dropped from what the image model will see.
		expect(c.appearance).toBe('tall, long black hair');
		expect(c.outfit).toBe('a dark kimono');
		expect(c.notes).toBe('Drafted.');

		const sent = text.calls.at(-1)![1].content;
		expect(sent).toContain('Series title: Ronin Road');
		expect(sent).toContain('Logline: A swordsman walks home.');
		expect(sent).toContain('Setting and look of the series: Edo-period villages');
		expect(sent).toContain('a runaway girl with a staff');
		expect(sent).toContain('- Goro (protagonist)');
		// The user's chosen name is kept.
		expect(getCharacter(db, owner, first).character.name).toBe('Goro');
	});

	it('needs a name or a description', () => {
		expect(() => createCharacter(db, owner, seriesId, { ...brief, brief: ' ' })).toThrow(
			CharacterError
		);
	});

	it('revises with feedback and keeps edits', async () => {
		const id = createCharacter(db, owner, seriesId, brief);
		await worker.drain();
		const c = getCharacter(db, owner, id).character;
		updateCharacter(db, owner, id, { ...c, appearance: 'short and round' });
		requestDevelop(db, owner, id, 'make her older');
		await worker.drain();
		const sent = text.calls.at(-1)![1].content;
		expect(sent).toContain('- appearance: short and round');
		expect(sent).toContain("The user's feedback: make her older");
		expect(() => updateCharacter(db, owner, id, { ...c, name: '' })).toThrow(/name/);
	});

	it('draws candidates in the style once it is ready, then keeps the chosen reference', async () => {
		const id = createCharacter(db, owner, seriesId, brief);
		await worker.drain();
		expect(() => requestCandidates(db, owner, id)).toThrow(/sample picture/);

		await readyStyle();
		requestCandidates(db, owner, id);
		await worker.drain();
		let detail = getCharacter(db, owner, id);
		expect(detail.candidates).toHaveLength(CANDIDATE_COUNT);
		expect(detail.candidates.every((c) => c.assetHash && !c.stale && !c.oldStyle)).toBe(true);
		const call = image.calls.at(-1)!;
		expect(call).toMatchObject(CANDIDATE_SIZE);
		// Each option is drawn from its own design, not the same prompt.
		const prompts = image.calls.slice(-CANDIDATE_COUNT).map((c) => c.prompt);
		expect(new Set(prompts).size).toBe(CANDIDATE_COUNT);
		expect(prompts[1]).toMatch(
			/^Black and white.*bold ink\. Wide shot, full-body.*\. A young woman\. a young woman with cropped hair.*Wearing a dark traveling kimono.*black ink on white paper\.$/
		);
		expect(detail.candidates.map((c) => c.variant)).toEqual([
			'close to the profile',
			'short and stocky, cropped hair',
			'lanky, braid, travel cloak',
			'wiry, wild hair, goggles'
		]);

		// Choosing one makes its look the character's; the other options stay fresh.
		const chosen = detail.candidates[2];
		chooseReference(db, owner, id, chosen.id);
		expect(listCharacters(db, owner, seriesId)[0].thumb).toBe(chosen.thumbHash);
		detail = getCharacter(db, owner, id);
		expect(detail.character.appearance).toBe(chosen.appearance);
		expect(detail.reference?.prompt).toBe(characterPrompt(detail.style!, detail.character));
		expect(detail.candidates.some((c) => c.stale)).toBe(false);

		// New candidates replace the others but keep the reference.
		requestCandidates(db, owner, id, { newSeed: true });
		await worker.drain();
		detail = getCharacter(db, owner, id);
		expect(detail.reference?.id).toBe(chosen.id);
		expect(detail.candidates).toHaveLength(CANDIDATE_COUNT + 1);
	});

	it('flags pictures drawn from an older description or style', async () => {
		await readyStyle();
		const id = createCharacter(db, owner, seriesId, brief);
		await worker.drain();
		requestCandidates(db, owner, id);
		await worker.drain();
		chooseReference(db, owner, id, getCharacter(db, owner, id).candidates[1].id);
		let c = getCharacter(db, owner, id).character;
		// A new outfit dates the reference; the other options are alternatives.
		updateCharacter(db, owner, id, { ...c, outfit: 'red armor' });
		let detail = getCharacter(db, owner, id);
		expect(detail.reference?.stale).toBe(true);
		expect(detail.candidates.filter((i) => i.stale)).toHaveLength(1);
		// A new age dates them all.
		c = detail.character;
		updateCharacter(db, owner, id, { ...c, age: 'an old woman' });
		detail = getCharacter(db, owner, id);
		expect(detail.candidates.every((i) => i.stale)).toBe(true);

		requestPrompt(db, owner, styleId, 'more contrast');
		await worker.drain();
		expect(getCharacter(db, owner, id).candidates.every((i) => i.oldStyle)).toBe(true);
	});

	it('only accepts a finished picture of the same character as reference', async () => {
		await readyStyle();
		const a = createCharacter(db, owner, seriesId, brief);
		const b = createCharacter(db, owner, seriesId, { ...brief, name: 'Goro' });
		await worker.drain();
		requestCandidates(db, owner, a);
		const pending = getCharacter(db, owner, a).candidates[0];
		expect(() => chooseReference(db, owner, a, pending.id)).toThrow(/not ready/);
		await worker.drain();
		expect(() => chooseReference(db, owner, b, pending.id)).toThrow(/not ready/);
	});

	it('redraws a character sheet from the reference, view by view', async () => {
		await readyStyle();
		const id = createCharacter(db, owner, seriesId, brief);
		await worker.drain();
		expect(() => requestSheet(db, owner, id)).toThrow(/reference picture first/);
		requestCandidates(db, owner, id);
		await worker.drain();
		const [first, second] = getCharacter(db, owner, id).candidates;
		chooseReference(db, owner, id, first.id);

		requestSheet(db, owner, id);
		await worker.drain();
		let sheet = getCharacter(db, owner, id).sheet;
		expect(sheet.map((s) => s.view)).toEqual(SHEET_VIEWS.map((v) => v.key));
		expect(sheet.every((s) => s.image?.assetHash && !s.image.outdated)).toBe(true);
		expect(image.edits).toHaveLength(SHEET_VIEWS.length);
		expect(image.edits[0].prompt).toBe(sheetPrompt('bw', 'three-quarter'));
		expect(image.edits[0].prompt).toMatch(/black ink on white paper\.$/);

		// Redrawing one view replaces only that one, with a new seed.
		const side = sheet.find((s) => s.view === 'side')!.image!;
		requestSheet(db, owner, id, 'side');
		await worker.drain();
		sheet = getCharacter(db, owner, id).sheet;
		const newSide = sheet.find((s) => s.view === 'side')!.image!;
		expect(newSide.id).not.toBe(side.id);
		expect(newSide.seed).not.toBe(side.seed);
		expect(image.edits).toHaveLength(SHEET_VIEWS.length + 1);

		// A redraw can carry guidance for that one view.
		requestSheet(db, owner, id, 'back', 'holding the staff over one shoulder');
		await worker.drain();
		expect(image.edits.at(-1)!.prompt).toBe(
			sheetPrompt('bw', 'back', 'holding the staff over one shoulder')
		);
		expect(image.edits.at(-1)!.prompt).toMatch(
			/^Show this character from behind\..* holding the staff over one shoulder\. Keep the same/
		);

		// A different reference makes the sheet outdated; sheet pictures can't be one.
		chooseReference(db, owner, id, second.id);
		expect(getCharacter(db, owner, id).sheet.every((s) => s.image?.outdated)).toBe(true);
		expect(() => chooseReference(db, owner, id, newSide.id)).toThrow(/not ready/);
	});

	it("keeps users out of each other's characters", async () => {
		const id = createCharacter(db, owner, seriesId, brief);
		expect(() => createCharacter(db, other, seriesId, brief)).toThrow();
		expect(() => getCharacter(db, other, id)).toThrow(CharacterError);
		expect(() => listCharacters(db, other, seriesId)).toThrow();
		expect(() => deleteCharacter(db, other, id)).toThrow(CharacterError);
	});

	it('deleting cancels pending work; deleting the series removes its cast', async () => {
		await readyStyle();
		const id = createCharacter(db, owner, seriesId, brief);
		await worker.drain();
		requestCandidates(db, owner, id);
		deleteCharacter(db, owner, id);
		// The design proposals, before any picture is queued.
		expect(db.select().from(jobs).where(eq(jobs.status, 'canceled')).all()).toHaveLength(1);
		createCharacter(db, owner, seriesId, brief);
		deleteSeries(db, owner, seriesId);
		expect(db.select().from(characterImages).all()).toEqual([]);
	});
});

describe('chapter cast', () => {
	/** A character with finished candidates. */
	async function designed(name = 'Aiko') {
		const id = createCharacter(db, owner, seriesId, { ...brief, name });
		await worker.drain();
		requestCandidates(db, owner, id);
		await worker.drain();
		return { id, candidates: getCharacter(db, owner, id).candidates };
	}

	it('joins the chapter it was made in, and is picked into later ones', async () => {
		await readyStyle();
		const [first] = listChapters(db, owner, seriesId);
		const aiko = createCharacter(db, owner, seriesId, brief, first.id);
		const second = createChapter(db, owner, seriesId, { title: 'The Pass', logline: '' });
		expect(chapterCastView(db, owner, seriesId, first.id)).toMatchObject([
			{ id: aiko, inCast: true }
		]);
		expect(chapterCastView(db, owner, seriesId, second)).toMatchObject([
			{ id: aiko, inCast: false }
		]);
		addToCast(db, owner, seriesId, second, aiko);
		addToCast(db, owner, seriesId, second, aiko); // already in: no change
		expect(listChapters(db, owner, seriesId).map((c) => c.castSize)).toEqual([1, 1]);
		removeFromCast(db, owner, seriesId, first.id, aiko);
		expect(chapterCastView(db, owner, seriesId, first.id)[0].inCast).toBe(false);
		// Still in the series.
		expect(listCharacters(db, owner, seriesId)).toHaveLength(1);
		expect(() => addToCast(db, other, seriesId, second, aiko)).toThrow();
	});

	it('pins the design a chapter was made with until it moves to the newest', async () => {
		await readyStyle();
		const [chapter] = listChapters(db, owner, seriesId);
		const { id, candidates } = await designed();
		addToCast(db, owner, seriesId, chapter.id, id);
		// No design yet: the first one chosen is pinned.
		chooseReference(db, owner, id, candidates[0].id);
		let view = chapterCastView(db, owner, seriesId, chapter.id)[0];
		expect(view).toMatchObject({ pinnedThumb: candidates[0].thumbHash, newerThumb: null });

		// A redesign in the series leaves the chapter on its design, which is kept.
		chooseReference(db, owner, id, candidates[1].id);
		requestCandidates(db, owner, id, { newSeed: true });
		await worker.drain();
		view = chapterCastView(db, owner, seriesId, chapter.id)[0];
		expect(view).toMatchObject({
			pinnedThumb: candidates[0].thumbHash,
			newerThumb: candidates[1].thumbHash
		});
		const kept = getCharacter(db, owner, id).candidates.map((c) => c.id);
		expect(kept).toContain(candidates[0].id);
		expect(kept).toContain(candidates[1].id);

		useNewestDesign(db, owner, seriesId, chapter.id, id);
		view = chapterCastView(db, owner, seriesId, chapter.id)[0];
		expect(view).toMatchObject({ pinnedThumb: candidates[1].thumbHash, newerThumb: null });
	});
});
