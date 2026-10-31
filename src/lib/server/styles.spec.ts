import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from './db';
import { jobs } from './db/schema';
import { FakeImageModel, FakeTextModel } from './ai/fake';
import type { ChatMessage } from './ai/text';
import { Worker } from './jobs';
import { createUser } from './auth/users';
import {
	compilePrompt,
	copyStyle,
	createStyle,
	deleteStyle,
	getStyle,
	listStyles,
	picturePrompt,
	positiveOnly,
	toneOnly,
	answerQuestions,
	requestPictures,
	requestPrompt,
	requestScenes,
	SAMPLE_SUBJECTS,
	saveSettings,
	saveText,
	skipQuestions,
	styleAccess,
	StyleError,
	styleJobHandlers
} from './styles';
import { deleteOtherVersions, deleteVersion, setLocked, useVersion } from './versions';

let db: Db;
let worker: Worker;
let image: FakeImageModel;
let text: FakeTextModel;
let owner: number;
let other: number;
let round: number;

const input = {
	name: 'Noir',
	description: 'gritty noir, heavy shadows',
	colorMode: 'bw' as const,
	model: 'qwen-image' as const
};

/** Prompts and scenes numbered by round, so each rewrite is recognizable. */
function reply(messages: ChatMessage[]) {
	if (messages[0].content.includes('leaves out')) return { questions: [] };
	round++;
	if (messages[0].content.includes('sample scenes')) {
		return {
			scenes: {
				figure: `A ronin standing, round ${round}`,
				face: `A ronin glaring, round ${round}`,
				interior: `An empty teahouse, round ${round}, no lamps`,
				exterior: `An empty rice-field road at dusk, round ${round}, no cars`,
				action: `A ronin leaping, round ${round}`,
				bogus: 'x'
			}
		};
	}
	return { prompt: `heavy ink, deep blacks, round ${round}`, notes: 'Made it darker.' };
}

beforeEach(async () => {
	db = openDb(':memory:');
	process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-assets-'));
	image = new FakeImageModel();
	round = 0;
	text = new FakeTextModel(reply);
	worker = new Worker(db, { image, text }, styleJobHandlers);
	owner = (await createUser(db, 'kenji', 'a long enough password')).id;
	other = (await createUser(db, 'yuki', 'a long enough password')).id;
});

/** A style with its prompt, scenes and all five pictures made. */
async function readyStyle() {
	const id = createStyle(db, owner, input);
	await worker.drain();
	requestPictures(db, owner, id, 'outdated');
	await worker.drain();
	return id;
}

const current = (item: { versions: { id: number }[]; currentId: number | null }) =>
	item.versions.find((v) => v.id === item.currentId) as
		(ReturnType<typeof getStyle>['prompt']['versions'][number] & object) | undefined;

describe('style pipeline', () => {
	it('writes the prompt and scenes with the AI, then draws the pictures', async () => {
		const id = createStyle(db, owner, input);
		await worker.drain();

		let style = getStyle(db, owner, id);
		expect(current(style.prompt)?.text).toBe('heavy ink, deep blacks, round 1');
		expect(current(style.prompt)?.notes).toBe('Made it darker.');
		expect(text.calls[0][1].content).toContain('gritty noir');
		expect(style.scenes.map((s) => current(s.item)?.text)).toEqual([
			'A ronin standing, round 2.',
			'A ronin glaring, round 2.',
			'An empty teahouse, round 2. No people.',
			'An empty rice-field road at dusk, round 2. No people.',
			'A ronin leaping, round 2.'
		]);
		expect(style.ready).toBe(false);

		expect(requestPictures(db, owner, id, 'outdated')).toBe(SAMPLE_SUBJECTS.length);
		await worker.drain();
		style = getStyle(db, owner, id);
		expect(style.ready).toBe(true);
		expect(style.pictures.every((p) => current(p.item)?.assetHash)).toBe(true);
		expect(image.calls[0].prompt).toBe(
			'Black and white manga art, black ink with screentone shading. heavy ink, deep blacks, round 1. A ronin standing, round 2. Drawn entirely in black ink on white paper.'
		);
		expect(listStyles(db, owner)[0]).toMatchObject({ ready: true });
		expect(listStyles(db, owner)[0].thumbs).toHaveLength(SAMPLE_SUBJECTS.length);
	});

	it('marks what was made from a changed input out of date, and says why', async () => {
		const id = await readyStyle();
		saveText(db, owner, id, 'description', '', 'gritty noir in 1920s Shanghai');
		let style = getStyle(db, owner, id);
		expect(current(style.prompt)?.outOfDate).toEqual(['the description']);
		expect(current(style.scenes[0].item)?.outOfDate).toEqual(['the description']);
		expect(current(style.pictures[0].item)?.outOfDate).toEqual([]);

		requestPrompt(db, owner, id);
		await worker.drain();
		style = getStyle(db, owner, id);
		expect(current(style.prompt)?.outOfDate).toEqual([]);
		expect(current(style.pictures[0].item)?.outOfDate).toEqual(['the style prompt']);

		saveSettings(db, owner, id, { colorMode: 'grayscale', model: 'z-image' });
		style = getStyle(db, owner, id);
		expect(current(style.prompt)?.outOfDate).toEqual(['the color mode']);
		expect(current(style.pictures[0].item)?.outOfDate).toEqual([
			'the style prompt',
			'the color mode',
			'the image model'
		]);
	});

	it('regenerates only unlocked items that are missing or out of date', async () => {
		const id = await readyStyle();
		const before = getStyle(db, owner, id);
		const exterior = before.scenes.find((s) => s.key === 'exterior')!.item;
		setLocked(db, styleAccess(db, owner, id), exterior.id, true);
		saveText(db, owner, id, 'avoid', '', 'electric wires');

		expect(requestScenes(db, owner, id, 'outdated', 'Set them in winter')).toBe(4);
		await worker.drain();
		const sent = text.calls.at(-1)![1].content;
		expect(sent).toContain('Keep out of every image: electric wires');
		expect(sent).toContain('the user asks: Set them in winter');
		expect(sent).toContain('- exterior: An empty rice-field road'); // kept, for variety
		expect(sent).not.toContain('"exterior"');

		const after = getStyle(db, owner, id);
		const ext = after.scenes.find((s) => s.key === 'exterior')!.item;
		expect(ext.versions).toHaveLength(1);
		expect(current(ext)?.outOfDate).toEqual(['the keep-out list']);
		expect(after.scenes.filter((s) => s.item.versions.length === 2)).toHaveLength(4);
		expect(requestScenes(db, owner, id, 'outdated')).toBe(0);
		expect(() => requestScenes(db, owner, id, 'exterior')).toThrow(/is kept/);

		// Four pictures now show older scenes; the exterior's is up to date.
		expect(requestPictures(db, owner, id, 'outdated')).toBe(4);
	});

	it('keeps every version, and can go back, lock in, and delete', async () => {
		const id = await readyStyle();
		requestPictures(db, owner, id, 'figure', { seed: 42, guidance: 'from a low angle' });
		await worker.drain();
		const access = styleAccess(db, owner, id);
		let figure = getStyle(db, owner, id).pictures[0].item;
		const [first, second] = figure.versions;
		expect(figure.versions).toHaveLength(2);
		expect(figure.currentId).toBe(second.id);
		expect(second.seed).toBe(42);
		expect(second.guidance).toBe('from a low angle');
		expect(image.calls.at(-1)!.prompt).toMatch(
			/A ronin standing, round 2\. From a low angle\. Drawn entirely in black ink/i
		);

		useVersion(db, access, first.id, { lock: true });
		figure = getStyle(db, owner, id).pictures[0].item;
		expect(figure.currentId).toBe(first.id);
		expect(figure.locked).toBe(true);
		expect(requestPictures(db, owner, id, 'all')).toBe(SAMPLE_SUBJECTS.length - 1);
		expect(() => useVersion(db, access, second.id)).toThrow(/is kept/);
		await worker.drain();

		// Deleting the current version falls back to the newest remaining one.
		deleteVersion(db, access, first.id);
		figure = getStyle(db, owner, id).pictures[0].item;
		expect(figure.currentId).toBe(second.id);
		expect(figure.locked).toBe(true);

		const face = getStyle(db, owner, id).pictures[1].item;
		expect(face.versions).toHaveLength(2);
		expect(deleteOtherVersions(db, access, face.id)).toBe(1);
		expect(getStyle(db, owner, id).pictures[1].item.versions).toHaveLength(1);
	});

	it('redraws with the same seed unless given a new one', async () => {
		const id = await readyStyle();
		const seeds = image.calls.map((c) => c.seed);
		requestPictures(db, owner, id, 'all');
		await worker.drain();
		expect(image.calls.slice(-5).map((c) => c.seed)).toEqual(seeds);
	});

	it('saves the user’s own wording as a new version', async () => {
		const id = await readyStyle();
		saveText(db, owner, id, 'scene', 'face', 'A geisha smiling.');
		saveText(db, owner, id, 'scene', 'face', 'A geisha smiling.'); // unchanged: no new version
		const face = getStyle(db, owner, id).scenes[1].item;
		expect(face.versions.map((v) => v.origin)).toEqual(['ai', 'user']);
		expect(current(face)?.outOfDate).toEqual([]);
		expect(() => saveText(db, owner, id, 'scene', 'face', ' ')).toThrow(StyleError);
		expect(() => saveText(db, owner, id, 'scene', 'nope', 'x')).toThrow(StyleError);
	});

	it('writes a missing prompt or scene before drawing a picture', async () => {
		const id = createStyle(db, owner, input);
		// Nothing written yet: the prompt and scene jobs are already queued, so
		// the picture just waits for them.
		requestPictures(db, owner, id, 'exterior');
		await worker.drain();
		expect(text.calls).toHaveLength(3); // questions, prompt, scenes
		const style = getStyle(db, owner, id);
		expect(current(style.pictures[3].item)?.assetHash).toBeTruthy();
		expect(style.ready).toBe(true);
	});

	it('reports a failed AI call on the item', async () => {
		text = new FakeTextModel(() => ({ nonsense: true }));
		worker = new Worker(db, { image, text }, styleJobHandlers);
		const id = createStyle(db, owner, input);
		await worker.drain();
		const style = getStyle(db, owner, id);
		expect(style.prompt.versions).toEqual([]);
		expect(style.prompt.error).toBeTruthy();
		expect(style.scenes[0].item.error).toBeTruthy();
		expect(style.busy).toBe(false);
	});

	it('copies a ready style, current versions and locks only', async () => {
		const id = await readyStyle();
		const access = styleAccess(db, owner, id);
		const prompt = getStyle(db, owner, id).prompt;
		setLocked(db, access, prompt.id, true);
		requestPictures(db, owner, id, 'face', { seed: 7 });
		await worker.drain();

		const copyId = copyStyle(db, owner, id, 'Sequel');
		const copy = getStyle(db, owner, copyId);
		expect(copy.ready).toBe(true);
		expect(copy.prompt.locked).toBe(true);
		expect(copy.pictures[1].item.versions).toHaveLength(1);
		expect(current(copy.pictures[1].item)?.seed).toBe(7);
		deleteStyle(db, owner, id);
		expect(getStyle(db, owner, copyId).ready).toBe(true);
	});

	it("keeps users out of each other's styles", async () => {
		const id = await readyStyle();
		const mine = getStyle(db, owner, id);
		const theirs = createStyle(db, other, { ...input, name: 'Theirs' });
		expect(() => getStyle(db, other, id)).toThrow(StyleError);
		expect(() => deleteStyle(db, other, id)).toThrow(StyleError);
		expect(() => styleAccess(db, other, id)).toThrow(StyleError);
		// Their access to their own style doesn't reach items of mine.
		const access = styleAccess(db, other, theirs);
		expect(() => deleteVersion(db, access, mine.prompt.currentId!)).toThrow();
		expect(() => setLocked(db, access, mine.prompt.id, true)).toThrow();
		expect(listStyles(db, other)).toHaveLength(1);
	});

	it('cancels unfinished work when the style is deleted', async () => {
		const id = createStyle(db, owner, input);
		deleteStyle(db, owner, id);
		const statuses = db.select({ status: jobs.status }).from(jobs).all();
		expect(statuses.map((j) => j.status)).toEqual(['canceled', 'canceled', 'canceled']);
		await worker.drain();
		expect(text.calls).toHaveLength(0);
	});
});

describe('questions about the description', () => {
	const asked = {
		questions: [
			{ question: 'Which era?', suggestions: ['1700s', ' 1860s ', ''] },
			{ question: 'What kind of story?', suggestions: [] },
			{ question: 'What mood?', suggestions: ['Quiet'] }
		]
	};

	function withQuestions(fold = 'gritty noir, 1920s Shanghai, a detective story') {
		text = new FakeTextModel((messages) => {
			const system = messages[0].content;
			if (system.includes('leaves out')) return asked;
			if (system.includes('Rewrite their description')) return { description: fold };
			return reply(messages);
		});
		worker = new Worker(db, { image, text }, styleJobHandlers);
	}

	it('asks first, and folds the answers into a new description', async () => {
		withQuestions();
		const id = createStyle(db, owner, input);
		await worker.drain();
		expect(text.calls[0][1].content).toContain('gritty noir, heavy shadows');
		let style = getStyle(db, owner, id);
		expect(style.questions.list).toEqual([
			{ question: 'Which era?', suggestions: ['1700s', '1860s'] },
			{ question: 'What kind of story?', suggestions: [] },
			{ question: 'What mood?', suggestions: ['Quiet'] }
		]);
		// Nothing waits on the answers.
		expect(current(style.prompt)).toBeTruthy();

		expect(() => answerQuestions(db, owner, id, ['', ' '])).toThrow(/at least one/);
		answerQuestions(db, owner, id, ['1920s', 'A detective story']);
		await worker.drain();
		const sent = text.calls.at(-1)![1].content;
		expect(sent).toContain("The user's description: gritty noir, heavy shadows");
		expect(sent).toContain('Which era? 1920s\nWhat kind of story? A detective story');
		expect(sent).not.toContain('What mood?');

		style = getStyle(db, owner, id);
		expect(style.description.versions.map((v) => v.text)).toEqual([
			'gritty noir, heavy shadows',
			'gritty noir, 1920s Shanghai, a detective story'
		]);
		expect(current(style.description)?.origin).toBe('ai');
		expect(style.questions.list).toEqual([]);
		expect(current(style.prompt)?.outOfDate).toEqual(['the description']);
	});

	it('asks again when the user rewrites the description, and can be skipped', async () => {
		withQuestions();
		const id = createStyle(db, owner, input);
		await worker.drain();
		skipQuestions(db, owner, id);
		expect(getStyle(db, owner, id).questions.list).toEqual([]);

		saveText(db, owner, id, 'description', '', 'soft shoujo watercolor');
		expect(getStyle(db, owner, id).questions.item.pending).toBe(true);
		await worker.drain();
		expect(getStyle(db, owner, id).questions.list).toHaveLength(3);
		expect(text.calls.at(-1)![1].content).toContain('soft shoujo watercolor');
	});
});

describe('Worker', () => {
	it('re-queues jobs left running by a restart', async () => {
		const id = createStyle(db, owner, input);
		db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, 1)).run();
		worker.recover();
		expect(db.select().from(jobs).get()?.status).toBe('queued');
		await worker.drain();
		expect(current(getStyle(db, owner, id).prompt)?.text).toBe('heavy ink, deep blacks, round 1');
	});
});

describe('prompt compilation', () => {
	it('separates style, subject and guidance into sentences', () => {
		expect(compilePrompt({ colorMode: 'color', prompt: 'soft pastels' }, 'A cat.')).toBe(
			'Full-color manga art. soft pastels. A cat.'
		);
		expect(
			picturePrompt({ colorMode: 'grayscale', prompt: 'ink' }, 'A cat', 'make it smaller')
		).toBe(
			'Grayscale manga art with ink outlines and soft gray shading. ink. A cat. make it smaller. Drawn entirely in shades of gray.'
		);
	});

	it('keeps hues and negation out of pictures that have no color', () => {
		expect(
			picturePrompt(
				{ colorMode: 'grayscale', prompt: 'ink wash' },
				'The empty dirt road winds past lush green rice paddies under a bright blue-green sky. No people.',
				'no color, misty'
			)
		).toBe(
			'Grayscale manga art with ink outlines and soft gray shading. ink wash. The empty dirt road winds past lush rice paddies under a bright sky. No people. misty. Drawn entirely in shades of gray.'
		);
		expect(toneOnly('color', 'a red lantern')).toBe('a red lantern');
		expect(toneOnly('bw', 'Red lanterns, a golden-hour glow; credible greenery.')).toBe(
			'lanterns, a hour glow; credible greenery.'
		);
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
});
