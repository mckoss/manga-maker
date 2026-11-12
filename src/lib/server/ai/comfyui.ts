import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { EditRequest, ImageModel, ImageModelId, ImageRequest, ImageResult } from './image';

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export class ComfyError extends Error {}

const WORKFLOW_DIR = path.resolve('workflows');
const POLL_MS = 1000;

/** The exact model each workflow runs, as recorded on the versions it makes. */
const ENGINES: Record<ImageModelId, { generate: string; edit: string }> = {
	'qwen-image': { generate: 'qwen-image-2512', edit: 'qwen-image-edit-2509' },
	'z-image': { generate: 'z-image-turbo', edit: 'qwen-image-edit-2509' },
	'qwen-image-2.1': { generate: 'qwen-image-2.1-turbo', edit: 'qwen-image-2.1-turbo' },
	'qwen-image-2.1-full': { generate: 'qwen-image-2.1', edit: 'qwen-image-2.1' },
	'qwen-image-2.1-strong': { generate: 'qwen-image-2.1-strong', edit: 'qwen-image-2.1-strong' },
	'minimax-h3-image': { generate: 'minimax-h3-image', edit: 'minimax-h3-image' }
};

/** The strong-prompt variant's guidance: each step runs twice, with and without the prompt. */
export const STRONG_CFG = 4;

type WorkflowName =
	| 'qwen-image'
	| 'z-image'
	| 'qwen-image-2.1'
	| 'qwen-image-edit'
	| 'qwen-image-2.1-edit'
	| 'minimax-h3-image'
	| 'minimax-h3-image-edit';

function loadWorkflow(name: WorkflowName): Workflow {
	return JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, `${name}.json`), 'utf8'));
}

const isQwen21 = (model?: ImageModelId) => model?.startsWith('qwen-image-2.1') ?? false;
const isFullQwen21 = (model?: ImageModelId) =>
	model === 'qwen-image-2.1-full' || model === 'qwen-image-2.1-strong';

/** The 2.1 graph for a model: Turbo as saved, else the full weights, maybe guided. */
function qwen21(wf: Workflow, model: ImageModelId | undefined, negative = ''): Workflow {
	if (!isFullQwen21(model)) return wf;
	useFullQwen21(wf);
	if (model === 'qwen-image-2.1-strong') {
		wf.guider.inputs.cfg = STRONG_CFG;
		wf.positive.inputs.negative_prompt = negative;
	}
	return wf;
}

/**
 * The full Qwen-Image 2.1 runs the Turbo graph with the undistilled weights
 * and 25 evenly scheduled steps instead of Turbo's eight hand-tuned sigmas
 * (as ComfyUI's own Qwen-Image 2.1 templates do: euler, simple, cfg 1).
 */
function useFullQwen21(wf: Workflow): Workflow {
	wf.unet.inputs.unet_name = 'qwen_image_2.1_bf16.safetensors';
	wf.sigmas = {
		class_type: 'BasicScheduler',
		inputs: { model: ['cache', 0], scheduler: 'simple', steps: 25, denoise: 1 }
	};
	return wf;
}

const isMiniMax = (model?: ImageModelId) => model === 'minimax-h3-image';

/** The pixel area MiniMax H3-Image is tuned for; it draws poorly much below it. */
export const H3_AREA = 2048 * 2048;
/** MiniMax H3-Image canvas edges are multiples of this. */
const H3_MULTIPLE = 32;

/** The ~4 MP canvas MiniMax H3-Image draws a width × height picture on. */
export function h3Canvas(width: number, height: number): { width: number; height: number } {
	const scale = Math.sqrt(H3_AREA / (width * height));
	const fit = (n: number) =>
		Math.max(H3_MULTIPLE, Math.round((n * scale) / H3_MULTIPLE) * H3_MULTIPLE);
	return { width: fit(width), height: fit(height) };
}

/** MiniMax H3-Image calls the edit's pictures <Picture 1>, <Picture 2>, …; our prompts say "image 1". */
export const h3Prompt = (prompt: string) => prompt.replace(/\bimage (\d+)\b/gi, '<Picture $1>');

/**
 * MiniMax H3-Image draws on a ~4 MP canvas of the requested shape (6 steps,
 * no guidance, as ComfyUI's template), then scales to the requested size.
 */
function buildMiniMaxWorkflow(req: ImageRequest): Workflow {
	const wf = loadWorkflow('minimax-h3-image');
	Object.assign(wf.positive.inputs, { prompt: req.prompt, ...h3Canvas(req.width, req.height) });
	wf.sampler.inputs.seed = req.seed;
	Object.assign(wf.scale.inputs, { width: req.width, height: req.height });
	return wf;
}

/**
 * A MiniMax H3-Image edit: the first picture, upscaled to ~4 MP as
 * ComfyUI's template does, sets the canvas; the others are references (up
 * to 16 in all). The result is scaled to about one megapixel like the
 * other models' edits.
 */
function buildMiniMaxEditWorkflow(req: Omit<EditRequest, 'images'>, inputs: string[]): Workflow {
	if (inputs.length < 1 || inputs.length > 16)
		throw new ComfyError('An edit takes one to sixteen images.');
	const wf = loadWorkflow('minimax-h3-image-edit');
	wf.load1.inputs.image = inputs[0];
	inputs.slice(1).forEach((name, i) => {
		const n = i + 2;
		wf[`load${n}`] = { class_type: 'LoadImage', inputs: { image: name } };
		wf.positive.inputs[`images.image_${n}`] = [`load${n}`, 0];
	});
	wf.positive.inputs.prompt = h3Prompt(req.prompt);
	wf.sampler.inputs.seed = req.seed;
	return wf;
}

/** Fill a text-to-image workflow template with a request's settings. */
export function buildWorkflow(req: ImageRequest): Workflow {
	if (isMiniMax(req.model)) return buildMiniMaxWorkflow(req);
	const wf = isQwen21(req.model)
		? qwen21(loadWorkflow('qwen-image-2.1'), req.model, req.negative)
		: loadWorkflow(req.model as WorkflowName);
	wf.latent.inputs.width = req.width;
	wf.latent.inputs.height = req.height;
	if (isQwen21(req.model)) {
		wf.positive.inputs.prompt = req.prompt;
		wf.noise.inputs.noise_seed = req.seed;
	} else {
		wf.positive.inputs.text = req.prompt;
		wf.sampler.inputs.seed = req.seed;
	}
	return wf;
}

/**
 * Fill an edit template. `inputs` are the names ComfyUI gave the uploaded
 * images. The first is edited (and sets the output's shape, about one
 * megapixel); the others are references. Qwen-Image 2.1 edits itself and
 * takes up to ten; the other families use Qwen-Image-Edit 2509, up to three.
 */
export function buildEditWorkflow(req: Omit<EditRequest, 'images'>, inputs: string[]): Workflow {
	if (isMiniMax(req.model)) return buildMiniMaxEditWorkflow(req, inputs);
	if (isQwen21(req.model)) {
		if (inputs.length < 1 || inputs.length > 10)
			throw new ComfyError('An edit takes one to ten images.');
		const wf = qwen21(loadWorkflow('qwen-image-2.1-edit'), req.model, req.negative);
		inputs.forEach((name, i) => {
			const n = i + 1;
			wf[`load${n}`] = { class_type: 'LoadImage', inputs: { image: name } };
			// Each reference about one megapixel, as the 2509 workflow does.
			wf[`resize${n}`] = {
				class_type: 'ImageScaleToTotalPixels',
				inputs: {
					image: [`load${n}`, 0],
					upscale_method: 'lanczos',
					megapixels: 1.0,
					resolution_steps: 16
				}
			};
			wf.positive.inputs[`images.image_${n}`] = [`resize${n}`, 0];
		});
		wf.positive.inputs.prompt = req.prompt;
		wf.noise.inputs.noise_seed = req.seed;
		return wf;
	}
	if (inputs.length < 1 || inputs.length > 3)
		throw new ComfyError('An edit takes one to three images.');
	const wf = loadWorkflow('qwen-image-edit');
	wf.load.inputs.image = inputs[0];
	inputs.slice(1).forEach((name, i) => {
		const n = i + 2;
		wf[`load${n}`] = { class_type: 'LoadImage', inputs: { image: name } };
		for (const encoder of ['positive', 'negative'])
			wf[encoder].inputs[`image${n}`] = [`load${n}`, 0];
	});
	wf.positive.inputs.prompt = req.prompt;
	wf.sampler.inputs.seed = req.seed;
	return wf;
}

interface HistoryEntry {
	status: {
		completed?: boolean;
		status_str?: string;
		messages?: [string, Record<string, unknown>][];
	};
	outputs: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
}

/** Drives a ComfyUI server over its HTTP API. */
export class ComfyUI implements ImageModel {
	private clientId = `manga-maker-${randomUUID()}`;

	constructor(private baseUrl = process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188') {}

	private async request(pathname: string, init?: RequestInit): Promise<Response> {
		let res: Response;
		try {
			res = await fetch(new URL(pathname, this.baseUrl), init);
		} catch (e) {
			throw new ComfyError(`ComfyUI is not reachable at ${this.baseUrl}: ${(e as Error).message}`);
		}
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new ComfyError(`ComfyUI ${pathname} returned ${res.status}: ${body.slice(0, 500)}`);
		}
		return res;
	}

	private async submit(workflow: Workflow): Promise<string> {
		const res = await this.request('/prompt', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ prompt: workflow, client_id: this.clientId })
		});
		return ((await res.json()) as { prompt_id: string }).prompt_id;
	}

	/** Remove a queued prompt, or interrupt it if it is already running. */
	private async cancel(promptId: string): Promise<void> {
		const json = { 'content-type': 'application/json' };
		await this.request('/queue', {
			method: 'POST',
			headers: json,
			body: JSON.stringify({ delete: [promptId] })
		}).catch(() => {});
		const queue = (await (await this.request('/queue')).json()) as { queue_running: unknown[][] };
		if (queue.queue_running.some((item) => item[1] === promptId)) {
			await this.request('/interrupt', { method: 'POST' }).catch(() => {});
		}
	}

	private async wait(promptId: string, signal?: AbortSignal): Promise<HistoryEntry> {
		for (;;) {
			if (signal?.aborted) {
				await this.cancel(promptId);
				throw new ComfyError('Canceled.');
			}
			const history = (await (await this.request(`/history/${promptId}`)).json()) as Record<
				string,
				HistoryEntry
			>;
			const entry = history[promptId];
			if (entry?.status.status_str === 'error') {
				const failure = entry.status.messages?.find(([kind]) => kind === 'execution_error')?.[1];
				throw new ComfyError(
					failure
						? `${failure.node_type} failed: ${String(failure.exception_message ?? '').trim()}`
						: 'Generation failed; see the ComfyUI log.'
				);
			}
			if (entry?.status.completed) return entry;
			await new Promise((r) => setTimeout(r, POLL_MS));
		}
	}

	/** Put an image in ComfyUI's input folder; returns the name LoadImage takes. */
	private async upload(png: Buffer): Promise<string> {
		const name = `${createHash('sha256').update(png).digest('hex').slice(0, 16)}.png`;
		const form = new FormData();
		form.set('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), name);
		form.set('subfolder', 'manga-maker');
		form.set('overwrite', 'true');
		const res = await this.request('/upload/image', { method: 'POST', body: form });
		const out = (await res.json()) as { name: string; subfolder?: string };
		return out.subfolder ? `${out.subfolder}/${out.name}` : out.name;
	}

	async generate(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
		return { ...(await this.run(buildWorkflow(req), signal)), model: ENGINES[req.model].generate };
	}

	async edit(req: EditRequest, signal?: AbortSignal): Promise<ImageResult> {
		const inputs = [];
		for (const image of req.images) inputs.push(await this.upload(image));
		const engine = ENGINES[req.model ?? 'qwen-image'].edit;
		return { ...(await this.run(buildEditWorkflow(req, inputs), signal)), model: engine };
	}

	private async run(workflow: Workflow, signal?: AbortSignal): Promise<Omit<ImageResult, 'model'>> {
		const promptId = await this.submit(workflow);
		const entry = await this.wait(promptId, signal);
		const image = Object.values(entry.outputs).flatMap((o) => o.images ?? [])[0];
		if (!image) throw new ComfyError('ComfyUI finished without producing an image.');
		const query = new URLSearchParams({
			filename: image.filename,
			subfolder: image.subfolder,
			type: image.type
		});
		const res = await this.request(`/view?${query}`);
		return { png: Buffer.from(await res.arrayBuffer()), workflow };
	}
}
