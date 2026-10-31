import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './db';
import { jobs, styleSamples } from './db/schema';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import {
	approveDraft,
	compilePrompt,
	createStyle,
	deleteStyle,
	discardDraft,
	getStyle,
	listStyles,
	requestRefine,
	requestSamples,
	refineMessages,
	SAMPLE_SUBJECTS,
	positiveOnly,
	samplePrompt,
	sceneFor,
	startRevision,
	StyleError,
	styleJobHandlers,
	updateDraft
} from './styles';

let db: Db;
let worker: Worker;
let image: FakeImageModel;
let text: FakeTextModel;
let owner: number;
let other: number;
let replies: number;

const input = {
	name: 'Noir',
	description: 'gritty noir, heavy shadows',
	colorMode: 'bw' as const,
	model: 'qwen-image' as const
};

beforeEach(async () => {
	db = openDb(':memory:');
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-assets-'));
	image = new FakeImageModel();
	replies = 0;
	text = new FakeTextModel(() => ({
		prompt: `heavy ink, deep blacks v${++replies}`,
		scenes: { exterior: `An empty rice-field road at dusk v${replies}, no cars`, bogus: 'x' },
		notes: 'Made it darker.'
	}));
	worker = new Worker(db, { image, text }, styleJobHandlers);
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	other = (await createUser(db, 'yuki', 'a long enough password')).id;
});

describe('style workflow', () => {
	it('drafts a prompt with the AI, renders samples, and approves', async () => {
		const id = createStyle(db, owner, input);
		await worker.drain();

		let detail = getStyle(db, owner, id);
		expect(detail.draft?.prompt).toBe('heavy ink, deep blacks v1');
		expect(detail.draft?.notes).toBe('Made it darker.');
		expect(text.calls[0][1].content).toContain('gritty noir');

		requestSamples(db, owner, detail.draft!.id);
		await worker.drain();
		detail = getStyle(db, owner, id);
		expect(detail.samples).toHaveLength(SAMPLE_SUBJECTS.length);
		expect(detail.samples.every((s) => s.assetHash && s.thumbHash)).toBe(true);
		expect(image.calls[0].prompt).toBe(samplePrompt(detail.draft!, 'figure'));
		expect(image.calls.find((c) => c.prompt.includes('rice-field'))).toBeTruthy();
		expect(image.calls[0].prompt).toMatch(/^Black and white/);

		approveDraft(db, owner, detail.draft!.id);
		detail = getStyle(db, owner, id);
		expect(detail.draft).toBeUndefined();
		expect(detail.active?.number).toBe(1);
		expect(detail.style.activeVersionId).toBe(detail.active?.id);
	});

	it('refuses approval without a sample set matching the current prompt', async () => {
		const id = createStyle(db, owner, input);
		await worker.drain();
		const draft = getStyle(db, owner, id).draft!;
		expect(() => approveDraft(db, owner, draft.id)).toThrow(/samples/);

		requestSamples(db, owner, draft.id);
		await worker.drain();
		const edit = { ...input, prompt: draft.prompt, avoid: '', scenes: draft.scenes };
		updateDraft(db, owner, draft.id, { ...edit, prompt: 'changed' });
		expect(() => approveDraft(db, owner, draft.id)).toThrow(/samples/);

		// Editing a scene also makes the samples out of date.
		requestSamples(db, owner, draft.id);
		await worker.drain();
		updateDraft(db, owner, draft.id, { ...edit, prompt: 'changed', scenes: { face: 'A cat.' } });
		expect(() => approveDraft(db, owner, draft.id)).toThrow(/samples/);
	});

	it('revises an approved style without changing it until the revision is approved', async () => {
		const id = createStyle(db, owner, input);
		await worker.drain();
		const v1 = getStyle(db, owner, id).draft!;
		requestSamples(db, owner, v1.id);
		await worker.drain();
		approveDraft(db, owner, v1.id);

		const v2 = startRevision(db, owner, id);
		expect(() => startRevision(db, owner, id)).toThrow(/already has a draft/);
		requestRefine(db, owner, v2, 'more contrast');
		await worker.drain();
		expect(text.calls.at(-1)![1].content).toContain('more contrast');

		let detail = getStyle(db, owner, id);
		expect(detail.active?.id).toBe(v1.id);
		expect(detail.draft?.number).toBe(2);
		expect(detail.draft?.seed).toBe(v1.seed); // same seeds: like-for-like comparison

		requestSamples(db, owner, v2);
		await worker.drain();
		approveDraft(db, owner, v2);
		detail = getStyle(db, owner, id);
		expect(detail.active?.id).toBe(v2);
		expect(detail.history.map((v) => [v.number, v.status])).toEqual([
			[2, 'approved'],
			[1, 'superseded']
		]);
	});

	it('stores the scenes the AI writes and passes on what to keep out', async () => {
		const id = createStyle(db, owner, input);
		await worker.drain();
		let draft = getStyle(db, owner, id).draft!;
		expect(draft.scenes).toEqual({ exterior: 'An empty rice-field road at dusk v1. No people.' });

		updateDraft(db, owner, draft.id, {
			...input,
			prompt: draft.prompt,
			avoid: 'electric wires',
			scenes: { ...draft.scenes, face: 'A ronin glaring.' }
		});
		requestRefine(db, owner, draft.id, '');
		await worker.drain();
		const sent = text.calls.at(-1)![1].content;
		expect(sent).toContain('Keep out of every image: electric wires');
		expect(sent).toContain('- face: A ronin glaring.');

		// The reply's exterior replaces the old one; the user's face scene stays.
		draft = getStyle(db, owner, id).draft!;
		expect(draft.scenes).toEqual({
			exterior: 'An empty rice-field road at dusk v2. No people.',
			face: 'A ronin glaring.'
		});

		const v1 = draft;
		requestSamples(db, owner, v1.id);
		await worker.drain();
		approveDraft(db, owner, v1.id);
		const v2 = getStyle(db, owner, id);
		startRevision(db, owner, id);
		expect(getStyle(db, owner, id).draft?.scenes).toEqual(v2.active!.scenes);
		expect(getStyle(db, owner, id).draft?.avoid).toBe('electric wires');
	});

	it('asks the AI for scenes that fit the setting', () => {
		const [system] = refineMessages(
			{ description: 'Edo period', colorMode: 'bw', prompt: '', avoid: '', scenes: {} } as never,
			''
		);
		for (const s of SAMPLE_SUBJECTS) expect(system.content).toContain(`"${s.key}"`);
		expect(system.content).toMatch(/ignores negative prompts/);
	});

	it('discarding a revision keeps the active version', async () => {
		const id = createStyle(db, owner, input);
		await worker.drain();
		const v1 = getStyle(db, owner, id).draft!;
		expect(() => discardDraft(db, owner, v1.id)).toThrow(/only version/);
		requestSamples(db, owner, v1.id);
		await worker.drain();
		approveDraft(db, owner, v1.id);
		const v2 = startRevision(db, owner, id);
		discardDraft(db, owner, v2);
		expect(getStyle(db, owner, id).draft).toBeUndefined();
		expect(getStyle(db, owner, id).active?.id).toBe(v1.id);
	});

	it('regenerating samples replaces the old set and cancels its jobs', async () => {
		const id = createStyle(db, owner, input);
		await worker.drain();
		const draft = getStyle(db, owner, id).draft!;
		requestSamples(db, owner, draft.id);
		requestSamples(db, owner, draft.id, { newSeed: true });
		const cancelled = db.select().from(jobs).where(eq(jobs.status, 'cancelled')).all();
		expect(cancelled).toHaveLength(SAMPLE_SUBJECTS.length);
		await worker.drain();
		const samples = db.select().from(styleSamples).all();
		expect(samples).toHaveLength(SAMPLE_SUBJECTS.length);
		expect(samples[0].seed).not.toBe(draft.seed);
	});

	it("keeps users out of each other's styles", async () => {
		const id = createStyle(db, owner, input);
		expect(() => getStyle(db, other, id)).toThrow(StyleError);
		expect(() => deleteStyle(db, other, id)).toThrow(StyleError);
		expect(listStyles(db, other)).toEqual([]);
		expect(listStyles(db, owner)).toHaveLength(1);
	});

	it('records a failed AI call on the job and reports it', async () => {
		text = new FakeTextModel(() => ({ nonsense: true }));
		worker = new Worker(db, { image, text }, styleJobHandlers);
		const id = createStyle(db, owner, input);
		await worker.drain();
		const detail = getStyle(db, owner, id);
		expect(detail.draft?.prompt).toBe('');
		expect(detail.refineError).toBeTruthy();
	});
});

describe('Worker', () => {
	it('re-queues jobs left running by a restart', async () => {
		const id = createStyle(db, owner, input);
		db.update(jobs).set({ status: 'running' }).run();
		worker.recover();
		expect(db.select().from(jobs).get()?.status).toBe('queued');
		await worker.drain();
		expect(getStyle(db, owner, id).draft?.prompt).toBe('heavy ink, deep blacks v1');
	});
});

describe('prompt compilation', () => {
	it('separates style and subject into sentences', () => {
		expect(compilePrompt({ colorMode: 'color', prompt: 'soft pastels' }, 'A cat.')).toBe(
			'Full-color manga art. soft pastels. A cat.'
		);
	});

	it("uses the AI's scene for a subject, falling back to the default", () => {
		const version = { colorMode: 'bw' as const, prompt: 'ink', scenes: { face: 'A samurai.' } };
		expect(sceneFor(version, 'face')).toBe('A samurai.');
		expect(sceneFor(version, 'figure')).toBe(SAMPLE_SUBJECTS[0].prompt);
		expect(samplePrompt(version, 'face')).toMatch(/ink\. A samurai\.$/);
	});

	it('strips negated clauses from AI text', () => {
		expect(positiveOnly('bold ink, no modern elements, hatching, without color.')).toBe(
			'bold ink, hatching.'
		);
		expect(
			positiveOnly('A dirt path lined with houses, no people, and no power lines. Not modern.')
		).toBe('A dirt path lined with houses.');
		expect(positiveOnly('Nostalgic notes, nobody home')).toBe('Nostalgic notes, nobody home');
	});

	it('keeps default location scenes empty of people', () => {
		for (const key of ['interior', 'exterior']) {
			expect(sceneFor({ scenes: {} }, key)).toMatch(/empty.*No people\.$/i);
		}
	});
});
