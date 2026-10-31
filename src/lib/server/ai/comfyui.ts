import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { EditRequest, ImageModel, ImageModelId, ImageRequest, ImageResult } from './image';

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export class ComfyError extends Error {}

const WORKFLOW_DIR = path.resolve('workflows');
const POLL_MS = 1000;

function loadWorkflow(name: ImageModelId | 'qwen-image-edit'): Workflow {
	return JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, `${name}.json`), 'utf8'));
}

/** Fill a text-to-image workflow template with a request's settings. */
export function buildWorkflow(req: ImageRequest): Workflow {
	const wf = loadWorkflow(req.model);
	wf.positive.inputs.text = req.prompt;
	wf.latent.inputs.width = req.width;
	wf.latent.inputs.height = req.height;
	wf.sampler.inputs.seed = req.seed;
	return wf;
}

/**
 * Fill the Qwen-Image-Edit template. `inputs` are the names ComfyUI gave the
 * uploaded images. The first is edited (and sets the output's shape, about
 * one megapixel); the others go only to the text encoder, as references.
 */
export function buildEditWorkflow(req: Omit<EditRequest, 'images'>, inputs: string[]): Workflow {
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
		return this.run(buildWorkflow(req), signal);
	}

	async edit(req: EditRequest, signal?: AbortSignal): Promise<ImageResult> {
		const inputs = [];
		for (const image of req.images) inputs.push(await this.upload(image));
		return this.run(buildEditWorkflow(req, inputs), signal);
	}

	private async run(workflow: Workflow, signal?: AbortSignal): Promise<ImageResult> {
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
