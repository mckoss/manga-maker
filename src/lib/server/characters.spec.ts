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
import { approveDraft, getStyle, requestSamples, startRevision, styleJobHandlers } from './styles';
import { createManga, deleteManga, startStyle } from './mangas';
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
	updateCharacter
} from './characters';

let db: Db;
let worker: Worker;
let image: FakeImageModel;
let text: FakeTextModel;
let owner: number;
let other: number;
let mangaId: number;
let styleId: number;

function reply(messages: ChatMessage[]) {
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
	mangaId = createManga(db, owner, {
		title: 'Ronin Road',
		logline: 'A swordsman walks home.',
		readingDirection: 'rtl'
	});
	styleId = startStyle(db, owner, mangaId, {
		description: 'Edo-period villages',
		colorMode: 'bw',
		model: 'qwen-image'
	});
	await worker.drain();
});

async function approveStyle() {
	const draft = getStyle(db, owner, styleId).draft!;
	requestSamples(db, owner, draft.id);
	await worker.drain();
	approveDraft(db, owner, draft.id);
}

const brief = { name: '', role: 'protagonist' as const, brief: 'a runaway girl with a staff' };

describe('characters', () => {
	it('develops a profile from a brief, with the manga and cast as context', async () => {
		const first = createCharacter(db, owner, mangaId, {
			...brief,
			name: 'Goro',
			brief: 'old monk'
		});
		await worker.drain();
		const id = createCharacter(db, owner, mangaId, brief);
		await worker.drain();

		const c = getCharacter(db, owner, id).character;
		expect(c.name).toBe('Aiko');
		expect(c.personality).toBe('Stubborn.');
		// Negated clauses are dropped from what the image model will see.
		expect(c.appearance).toBe('tall, long black hair');
		expect(c.outfit).toBe('a dark kimono');
		expect(c.notes).toBe('Drafted.');

		const sent = text.calls.at(-1)![1].content;
		expect(sent).toContain('Manga title: Ronin Road');
		expect(sent).toContain('Logline: A swordsman walks home.');
		expect(sent).toContain('Setting and look of the manga: Edo-period villages');
		expect(sent).toContain('a runaway girl with a staff');
		expect(sent).toContain('- Goro (protagonist)');
		// The user's chosen name is kept.
		expect(getCharacter(db, owner, first).character.name).toBe('Goro');
	});

	it('needs a name or a description', () => {
		expect(() => createCharacter(db, owner, mangaId, { ...brief, brief: ' ' })).toThrow(
			CharacterError
		);
	});

	it('revises with feedback and keeps edits', async () => {
		const id = createCharacter(db, owner, mangaId, brief);
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

	it('draws candidates in the approved style, then keeps the chosen reference', async () => {
		const id = createCharacter(db, owner, mangaId, brief);
		await worker.drain();
		expect(() => requestCandidates(db, owner, id)).toThrow(/Approve the manga/);

		await approveStyle();
		requestCandidates(db, owner, id);
		await worker.drain();
		let detail = getCharacter(db, owner, id);
		expect(detail.candidates).toHaveLength(CANDIDATE_COUNT);
		expect(detail.candidates.every((c) => c.assetHash && !c.stale && !c.oldStyle)).toBe(true);
		const call = image.calls.at(-1)!;
		expect(call).toMatchObject(CANDIDATE_SIZE);
		expect(call.prompt).toBe(characterPrompt(detail.style!, detail.character));
		expect(call.prompt).toMatch(
			/^Black and white.*bold ink\. Wide shot, full-body.*\. A young woman\. tall.*Wearing a dark kimono\. The whole figure.*black ink on white paper\.$/
		);

		const chosen = detail.candidates[2];
		chooseReference(db, owner, id, chosen.id);
		expect(listCharacters(db, owner, mangaId)[0].thumb).toBe(chosen.thumbHash);

		// New candidates replace the others but keep the reference.
		requestCandidates(db, owner, id, { newSeed: true });
		await worker.drain();
		detail = getCharacter(db, owner, id);
		expect(detail.reference?.id).toBe(chosen.id);
		expect(detail.candidates).toHaveLength(CANDIDATE_COUNT + 1);
	});

	it('flags pictures drawn from an older description or style', async () => {
		await approveStyle();
		const id = createCharacter(db, owner, mangaId, brief);
		await worker.drain();
		requestCandidates(db, owner, id);
		await worker.drain();
		const c = getCharacter(db, owner, id).character;
		updateCharacter(db, owner, id, { ...c, outfit: 'red armour' });
		expect(getCharacter(db, owner, id).candidates.every((i) => i.stale)).toBe(true);

		const v2 = startRevision(db, owner, styleId);
		requestSamples(db, owner, v2);
		await worker.drain();
		approveDraft(db, owner, v2);
		expect(getCharacter(db, owner, id).candidates.every((i) => i.oldStyle)).toBe(true);
	});

	it('only accepts a finished picture of the same character as reference', async () => {
		await approveStyle();
		const a = createCharacter(db, owner, mangaId, brief);
		const b = createCharacter(db, owner, mangaId, { ...brief, name: 'Goro' });
		await worker.drain();
		requestCandidates(db, owner, a);
		const pending = getCharacter(db, owner, a).candidates[0];
		expect(() => chooseReference(db, owner, a, pending.id)).toThrow(/not ready/);
		await worker.drain();
		expect(() => chooseReference(db, owner, b, pending.id)).toThrow(/not ready/);
	});

	it("keeps users out of each other's characters", async () => {
		const id = createCharacter(db, owner, mangaId, brief);
		expect(() => createCharacter(db, other, mangaId, brief)).toThrow();
		expect(() => getCharacter(db, other, id)).toThrow(CharacterError);
		expect(() => listCharacters(db, other, mangaId)).toThrow();
		expect(() => deleteCharacter(db, other, id)).toThrow(CharacterError);
	});

	it('deleting cancels pending work; deleting the manga removes its cast', async () => {
		await approveStyle();
		const id = createCharacter(db, owner, mangaId, brief);
		await worker.drain();
		requestCandidates(db, owner, id);
		deleteCharacter(db, owner, id);
		expect(db.select().from(jobs).where(eq(jobs.status, 'cancelled')).all()).toHaveLength(
			CANDIDATE_COUNT
		);
		createCharacter(db, owner, mangaId, brief);
		deleteManga(db, owner, mangaId);
		expect(db.select().from(characterImages).all()).toEqual([]);
	});
});
