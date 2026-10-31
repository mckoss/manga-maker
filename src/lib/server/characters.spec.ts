import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { openDb, type Db } from './db';
import { items } from './db/schema';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import type { ChatMessage } from './ai/text';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import { fakeReply } from './ai';
import { requestPictures as requestStylePictures, requestPrompt, styleJobHandlers } from './styles';
import { createSeries, deleteSeries, startStyle } from './series';
import { setLocked, useVersion } from './versions';
import {
	CANDIDATE_COUNT,
	CANDIDATE_SIZE,
	characterAccess,
	CharacterError,
	characterJobHandlers,
	chooseReference,
	createCharacter,
	deleteCharacter,
	getCharacter,
	listCharacters,
	parseDesign,
	requestDesigns,
	requestPictures,
	requestProfile,
	requestSheet,
	saveDesign,
	saveText,
	SHEET_VIEWS,
	sheetPrompt,
	syncCharacter,
	updateOutdated
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
/** Profile replies, in turn: each develop round gets the next one. */
let round = 0;

function reply(messages: ChatMessage[]) {
	if (messages[0].content.includes('sample scenes')) return fakeReply(messages);
	if (messages[0].content.includes('different visual designs')) return fakeReply(messages);
	if (messages[0].content.includes('art director')) return { prompt: 'bold ink', notes: '' };
	round++;
	return {
		name: round === 1 ? 'Aiko' : `Aiko ${round}`,
		personality: `Stubborn, round ${round}.`,
		motivation: 'Find her brother.',
		backstory: 'Village girl.',
		speech: 'Blunt.',
		age: 'a young woman',
		appearance: round === 1 ? 'tall, long black hair, no hat' : `tall, round ${round}`,
		outfit: 'a dark kimono, without shoes',
		notes: `Drafted, round ${round}.`
	};
}

beforeEach(async () => {
	round = 0;
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
	requestStylePictures(db, owner, styleId, 'outdated');
	await worker.drain();
}

/** The last request of a kind sent to the text model. */
function lastSent(system: string) {
	return text.calls.findLast((c) => c[0].content.includes(system))![1].content;
}

const brief = { name: '', role: 'protagonist' as const, brief: 'a runaway girl with a staff' };

/** The current text of a profile field. */
const field = (id: number, kind: string) => {
	const f = getCharacter(db, owner, id).profile.find((p) => p.kind === kind)!;
	return f.item.versions.find((v) => v.id === f.item.currentId)?.text;
};
const current = <T extends { versions: { id: number }[]; currentId: number | null }>(item: T) =>
	item.versions.find((v) => v.id === item.currentId) as T['versions'][number] | undefined;

/** A character with drawn design pictures. */
async function drawn() {
	await readyStyle();
	const id = createCharacter(db, owner, seriesId, brief);
	await worker.drain();
	updateOutdated(db, owner, id);
	await worker.drain();
	return id;
}

describe('characters', () => {
	it('develops a profile from the notes, then writes designs, each its own versioned item', async () => {
		const goro = createCharacter(db, owner, seriesId, {
			...brief,
			name: 'Goro',
			brief: 'old monk'
		});
		await worker.drain();
		const id = createCharacter(db, owner, seriesId, brief);
		await worker.drain();

		const detail = getCharacter(db, owner, id);
		expect(detail.character.name).toBe('Aiko 2');
		expect(field(id, 'personality')).toBe('Stubborn, round 2.');
		// Negated clauses are dropped from what the image model will see.
		expect(field(id, 'outfit')).toBe('a dark kimono');
		expect(detail.notes).toBe('Drafted, round 2.');
		expect(detail.profile.every((p) => p.status === 'ok')).toBe(true);

		const sent = lastSent('story editor');
		expect(sent).toContain('Series title: Ronin Road');
		expect(sent).toContain('Setting and look of the series: Edo-period villages');
		expect(sent).toContain('a runaway girl with a staff');
		expect(sent).toContain('- Goro (protagonist)');
		// The user's name is kept: the AI is told to repeat it.
		expect(getCharacter(db, owner, goro).character.name).toBe('Goro');
		const first = text.calls.find((c) => c[0].content.includes('story editor'))!;
		expect(first[1].content).toContain('Kept (repeat exactly):\n- name: Goro');

		// The designs follow from the profile; nothing is drawn yet.
		expect(detail.designs.map((d) => parseDesign(current(d.design)?.text)?.label)).toEqual([
			'close to the profile',
			'short and stocky, cropped hair',
			'lanky, braid, travel cloak',
			'wiry, wild hair, goggles'
		]);
		expect(detail.traits?.free[0]).toMatch(/^hair:/);
		expect(image.calls.filter((c) => c.width === CANDIDATE_SIZE.width)).toHaveLength(0);
		expect(detail.flow.pictures).toMatchObject({ missing: CANDIDATE_COUNT });
	});

	it('marks what is made from changed notes out of date, and regenerates only on request', async () => {
		const id = createCharacter(db, owner, seriesId, brief);
		await worker.drain();
		const calls = text.calls.length;
		saveText(db, owner, id, 'brief', 'a runaway boy with a staff');
		let detail = getCharacter(db, owner, id);
		expect(text.calls).toHaveLength(calls); // nothing regenerated yet
		const personality = detail.profile.find((p) => p.kind === 'personality')!;
		expect(personality.status).toBe('outdated');
		expect(current(personality.item)?.outOfDate).toEqual(['your notes']);
		// The designs are made from the notes too; their pictures will change
		// once they do.
		expect(detail.designs.every((d) => d.designStatus === 'outdated')).toBe(true);
		expect(detail.flow.profile.stale).toBe(8);

		// The user's own wording is kept from then on; the AI rewrites the rest.
		saveText(db, owner, id, 'speech', 'Mumbles.');
		saveText(db, owner, id, 'backstory', 'Raised by wolves.', false);
		detail = getCharacter(db, owner, id);
		expect(detail.profile.find((p) => p.kind === 'speech')!.item.locked).toBe(true);
		expect(detail.profile.find((p) => p.kind === 'backstory')!.status).toBe('ok');
		expect(updateOutdated(db, owner, id, ['profile'])).toBe(6);
		await worker.drain();
		expect(field(id, 'speech')).toBe('Mumbles.');
		expect(field(id, 'personality')).toBe('Stubborn, round 2.');
		expect(lastSent('story editor')).toContain('- speech: Mumbles.');
		// Only the profile was asked for: the designs now wait, out of date.
		detail = getCharacter(db, owner, id);
		expect(detail.designs.every((d) => d.designStatus === 'outdated')).toBe(true);
		expect(current(detail.designs[0].design)?.outOfDate).toContain('the appearance');

		// Every field keeps its own versions.
		const p = detail.profile.find((f) => f.kind === 'personality')!;
		expect(p.item.versions.map((v) => v.text)).toEqual([
			'Stubborn, round 1.',
			'Stubborn, round 2.'
		]);
		// Going back to an older name updates the character's name too.
		const nameItem = detail.profile.find((f) => f.kind === 'name')!.item;
		useVersion(db, characterAccess(db, owner, id), nameItem.versions[0].id);
		syncCharacter(db, id); // as the page's version actions do
		expect(listCharacters(db, owner, seriesId)[0].name).toBe('Aiko');
	});

	it('updates everything not kept, step by step, down to the pictures', async () => {
		const id = await drawn();
		let detail = getCharacter(db, owner, id);
		expect(detail.designs.every((d) => d.pictureStatus === 'ok')).toBe(true);
		const prompts = image.calls.slice(-CANDIDATE_COUNT).map((c) => c.prompt);
		expect(new Set(prompts).size).toBe(CANDIDATE_COUNT);
		expect(prompts[1]).toMatch(
			/^Black and white.*bold ink\. Wide shot, full-body character design of a young woman, alone,.*\. a young woman with cropped hair.*Wearing a dark traveling kimono.*black ink on white paper\.$/
		);
		expect(image.calls.at(-1)).toMatchObject(CANDIDATE_SIZE);

		// Keep one design; a new appearance then flows through the rest.
		const kept = detail.designs[1];
		setLocked(db, characterAccess(db, owner, id), kept.design.id, true);
		saveText(db, owner, id, 'appearance', 'short and round', false);
		detail = getCharacter(db, owner, id);
		expect(detail.designs[0].designStatus).toBe('outdated');
		expect(detail.designs[0].pictureStatus).toBe('upstream');
		// A kept design doesn't pass the change on to its picture.
		expect(detail.designs[1].pictureStatus).toBe('ok');
		const before = image.calls.length;
		updateOutdated(db, owner, id);
		await worker.drain();
		detail = getCharacter(db, owner, id);
		expect(detail.designs.every((d) => d.pictureStatus === 'ok')).toBe(true);
		// The fake AI rewrote design 1 with the same words, so only designs 3
		// and 4 changed and were redrawn.
		expect(image.calls.length - before).toBe(2);
		expect(detail.designs[1].design.versions).toHaveLength(1);
		// Kept designs are shown to the AI so the new ones differ from them.
		expect(lastSent('different visual designs')).toContain(
			'Designs the user is keeping (make the new ones different):\n- short and stocky'
		);
		// A redesigned picture keeps its seed, to compare like for like.
		const p2 = detail.designs[2].picture.versions;
		expect(p2[1].seed).toBe(p2[0].seed);
	});

	it('draws one design from the user’s words, and redraws with a new seed', async () => {
		const id = await drawn();
		const slot = getCharacter(db, owner, id).designs[0];
		saveDesign(db, owner, id, '1', {
			label: 'my take',
			appearance: 'a giant of a woman, shaved head, no scars',
			outfit: 'a monk’s robe'
		});
		let d = getCharacter(db, owner, id).designs[0];
		expect(d.design.locked).toBe(true);
		expect(parseDesign(current(d.design)?.text)).toEqual({
			label: 'my take',
			appearance: 'a giant of a woman, shaved head',
			outfit: 'a monk’s robe'
		});
		expect(current(d.picture)?.outOfDate).toEqual(['the design']);
		requestPictures(db, owner, id, { keys: ['1'] });
		await worker.drain();
		expect(image.calls.at(-1)!.prompt).toContain('a giant of a woman, shaved head.');
		d = getCharacter(db, owner, id).designs[0];
		expect(d.pictureStatus).toBe('ok');
		const seeds = d.picture.versions.map((v) => v.seed);
		expect(seeds[1]).toBe(seeds[0]); // the words changed: same seed
		requestPictures(db, owner, id, { keys: ['1'] });
		await worker.drain();
		d = getCharacter(db, owner, id).designs[0];
		expect(d.picture.versions).toHaveLength(3);
		expect(d.picture.versions[2].seed).not.toBe(seeds[1]); // same words: new seed
		expect(slot.design.versions).toHaveLength(1);

		// Rewriting one design asks the AI for one.
		requestDesigns(db, owner, id, { keys: ['3'], guidance: 'older' });
		await worker.drain();
		expect(lastSent('different visual designs')).toContain('Write 1 new design(s).');
		expect(() =>
			saveDesign(db, owner, id, '2', { label: '', appearance: ' ', outfit: '' })
		).toThrow(/Describe/);
	});

	it('chooses a reference picture, which goes out of date when the look changes', async () => {
		const id = await drawn();
		let detail = getCharacter(db, owner, id);
		const picture = current(detail.designs[2].picture)!;
		chooseReference(db, owner, id, picture.id);
		chooseReference(db, owner, id, picture.id); // already chosen: no new version
		expect(listCharacters(db, owner, seriesId)[0]).toMatchObject({
			thumb: picture.thumbHash,
			hasReference: true
		});
		detail = getCharacter(db, owner, id);
		expect(detail.reference.item.versions).toHaveLength(1);
		expect(detail.reference.status).toBe('ok');
		// It is a choice, not regenerated: only flagged.
		saveText(db, owner, id, 'outfit', 'red armor');
		detail = getCharacter(db, owner, id);
		expect(current(detail.reference.item)?.outOfDate).toEqual(['the outfit']);
		expect(detail.flow.reference.stale).toBe(1);

		// Only a finished picture of this character can be the reference.
		const b = createCharacter(db, owner, seriesId, { ...brief, name: 'Goro' });
		expect(() => chooseReference(db, owner, b, picture.id)).toThrow(/not ready/);
		const nameVersion = current(detail.profile[0].item)!;
		expect(() => chooseReference(db, owner, id, nameVersion.id)).toThrow(/not ready/);
	});

	it('flags pictures drawn in an older style', async () => {
		const id = await drawn();
		requestPrompt(db, owner, styleId, 'more contrast');
		await worker.drain();
		const detail = getCharacter(db, owner, id);
		expect(current(detail.designs[0].picture)?.outOfDate).toEqual(['the style prompt']);
		expect(detail.due.pictures).toBe(CANDIDATE_COUNT);
	});

	it('redraws a character sheet from the reference, view by view', async () => {
		const id = await drawn();
		expect(() => requestSheet(db, owner, id)).toThrow(/reference picture first/);
		const [first, second] = getCharacter(db, owner, id).designs.map((d) => current(d.picture)!);
		chooseReference(db, owner, id, first.id);

		requestSheet(db, owner, id);
		await worker.drain();
		let sheet = getCharacter(db, owner, id).sheet;
		expect(sheet.map((s) => s.view)).toEqual(SHEET_VIEWS.map((v) => v.key));
		expect(sheet.every((s) => s.status === 'ok' && current(s.item)?.assetHash)).toBe(true);
		expect(image.edits).toHaveLength(SHEET_VIEWS.length);
		// The edit says what the character is, so a dog stays a dog.
		expect(image.edits[0].prompt).toBe(sheetPrompt('bw', 'three-quarter', '', 'a young woman'));
		expect(image.edits[0].prompt).toMatch(/^The character is a young woman\. Show this/);

		// Redrawing one view adds a version of it, with a new seed and the guidance.
		requestSheet(db, owner, id, 'side', 'holding the staff over one shoulder');
		await worker.drain();
		sheet = getCharacter(db, owner, id).sheet;
		const side = sheet.find((s) => s.view === 'side')!.item;
		expect(side.versions).toHaveLength(2);
		expect(side.versions[1].seed).not.toBe(side.versions[0].seed);
		expect(image.edits.at(-1)!.prompt).toBe(
			sheetPrompt('bw', 'side', 'holding the staff over one shoulder', 'a young woman')
		);

		// A different reference puts the sheet out of date; updating redraws it,
		// each view with the guidance it had.
		chooseReference(db, owner, id, second.id);
		let detail = getCharacter(db, owner, id);
		expect(detail.sheet.every((s) => s.status === 'outdated')).toBe(true);
		expect(updateOutdated(db, owner, id, ['sheet'])).toBe(SHEET_VIEWS.length);
		await worker.drain();
		detail = getCharacter(db, owner, id);
		expect(detail.sheet.every((s) => s.status === 'ok')).toBe(true);
		expect(image.edits.filter((e) => e.prompt.includes('over one shoulder'))).toHaveLength(2);
	});

	it('rewrites the whole profile with feedback, except what is kept', async () => {
		const id = createCharacter(db, owner, seriesId, brief);
		await worker.drain();
		const detail = getCharacter(db, owner, id);
		setLocked(db, characterAccess(db, owner, id), detail.profile[1].item.id, true);
		expect(requestProfile(db, owner, id, { guidance: 'make her older' })).toBe(7);
		await worker.drain();
		const sent = lastSent('story editor');
		expect(sent).toContain("The user's feedback: make her older");
		expect(sent).toContain('- personality: Stubborn, round 1.');
		expect(field(id, 'personality')).toBe('Stubborn, round 1.');
		expect(field(id, 'motivation')).toBe('Find her brother.');
		expect(() => saveText(db, owner, id, 'name', ' ')).toThrow(/name/);
		expect(() => saveText(db, owner, id, 'role', 'hero')).toThrow(/role/);
	});

	it("keeps users out of each other's characters", async () => {
		const id = createCharacter(db, owner, seriesId, brief);
		expect(() => createCharacter(db, other, seriesId, brief)).toThrow();
		expect(() => getCharacter(db, other, id)).toThrow(CharacterError);
		expect(() => listCharacters(db, other, seriesId)).toThrow();
		expect(() => deleteCharacter(db, other, id)).toThrow(CharacterError);
		expect(() => characterAccess(db, other, id)).toThrow(CharacterError);
	});

	it('deleting removes every item; so does deleting the series', async () => {
		const id = createCharacter(db, owner, seriesId, brief);
		deleteCharacter(db, owner, id);
		const characterItems = () =>
			db.select().from(items).where(like(items.scope, 'character:%')).all();
		expect(characterItems()).toEqual([]);
		createCharacter(db, owner, seriesId, brief);
		await worker.drain();
		expect(characterItems().length).toBeGreaterThan(0);
		deleteSeries(db, owner, seriesId);
		expect(characterItems()).toEqual([]);
	});
});

describe('chapter cast', () => {
	it('joins the chapter it was made in, and is picked into later ones', async () => {
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
		expect(listCharacters(db, owner, seriesId)).toHaveLength(1);
		expect(() => addToCast(db, other, seriesId, second, aiko)).toThrow();
	});

	it('pins the reference a chapter was made with until it moves to the newest', async () => {
		const [chapter] = listChapters(db, owner, seriesId);
		const id = await drawn();
		const pictures = getCharacter(db, owner, id).designs.map((d) => current(d.picture)!);
		addToCast(db, owner, seriesId, chapter.id, id);
		// No reference yet: the first one chosen is pinned.
		chooseReference(db, owner, id, pictures[0].id);
		let view = chapterCastView(db, owner, seriesId, chapter.id)[0];
		expect(view).toMatchObject({ pinnedThumb: pictures[0].thumbHash, newerThumb: null });

		// A new reference in the series leaves the chapter on its own.
		chooseReference(db, owner, id, pictures[1].id);
		requestDesigns(db, owner, id);
		await worker.drain();
		view = chapterCastView(db, owner, seriesId, chapter.id)[0];
		expect(view).toMatchObject({
			pinnedThumb: pictures[0].thumbHash,
			newerThumb: pictures[1].thumbHash
		});

		useNewestDesign(db, owner, seriesId, chapter.id, id);
		view = chapterCastView(db, owner, seriesId, chapter.id)[0];
		expect(view).toMatchObject({ pinnedThumb: pictures[1].thumbHash, newerThumb: null });
	});
});
