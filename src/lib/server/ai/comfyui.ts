import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ImageModel, ImageModelId, ImageRequest, ImageResult } from './image';

type Workflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export class ComfyError extends Error {}

const WORKFLOW_DIR = path.resolve('workflows');
const POLL_MS = 1000;

function loadWorkflow(model: ImageModelId): Workflow {
	return JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, `${model}.json`), 'utf8'));
}

/** Fill a text-to-image workflow template with a request's settings. */
export function buildWorkflow(req: ImageRequest): Workflow {
	const wf = loadWorkflow(req.model);
	wf.positive.inputs.text = req.prompt;
	if (wf.negative.class_type === 'CLIPTextEncode') {
		wf.negative.inputs.text = req.negativePrompt ?? '';
	}
	wf.latent.inputs.width = req.width;
	wf.latent.inputs.height = req.height;
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
				throw new ComfyError('Cancelled.');
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

	async generate(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
		const workflow = buildWorkflow(req);
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
