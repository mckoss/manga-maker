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
	compileNegative,
	compilePrompt,
	createStyle,
	deleteStyle,
	discardDraft,
	getStyle,
	listStyles,
	requestRefine,
	requestSamples,
	SAMPLE_SUBJECTS,
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
		negativePrompt: 'color',
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
		expect(image.calls[0].prompt).toBe(compilePrompt(detail.draft!, SAMPLE_SUBJECTS[0].prompt));
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
		updateDraft(db, owner, draft.id, { ...input, prompt: 'changed', negativePrompt: '' });
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

	it('keeps people out of location shots', () => {
		expect(compileNegative('color', 'exterior')).toBe('color, people, person, human figure');
		expect(compileNegative('', 'interior')).toBe('people, person, human figure');
		expect(compileNegative('color', 'face')).toBe('color');
	});
});
