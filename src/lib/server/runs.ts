import type { Db } from './db';
import { putAsset } from './assets';
import type { ChatMessage, TextAttempt, TextRun } from './ai/text';
import type { ImageResult } from './ai/image';

/**
 * Run records: what an AI step sent and what came back, kept with the
 * version it made (`versions.run_hash`) so a result can be inspected and
 * reproduced. A record is canonical JSON stored as a content-addressed
 * asset (`application/json`), so the same run is stored once.
 */

export const RUN_RECORD_VERSION = 1;

/** A text step: the conversation, each raw reply, and the value used. */
export interface TextRunRecord {
	kind: 'text';
	version: typeof RUN_RECORD_VERSION;
	model: string;
	options: Record<string, unknown>;
	messages: ChatMessage[];
	attempts: TextAttempt[];
	parsed: unknown;
}

/** What an image step asked for. */
export interface ImageRunRequest {
	prompt: string;
	negative?: string;
	/** A drawing's size; absent for an edit. */
	width?: number;
	height?: number;
	/** An edit's input pictures, as asset hashes, in the order sent. */
	images?: string[];
}

/** An image step: the backend's filled workflow, the model and seed, and the request. */
export interface ImageRunRecord {
	kind: 'image';
	version: typeof RUN_RECORD_VERSION;
	model: string;
	seed: number;
	request: ImageRunRequest;
	workflow: unknown;
}

export type RunRecord = TextRunRecord | ImageRunRecord;

export function textRunRecord(run: TextRun): TextRunRecord {
	return { kind: 'text', version: RUN_RECORD_VERSION, ...run };
}

export function imageRunRecord(
	result: Pick<ImageResult, 'model' | 'workflow'>,
	seed: number,
	request: ImageRunRequest
): ImageRunRecord {
	return {
		kind: 'image',
		version: RUN_RECORD_VERSION,
		model: result.model,
		seed,
		request,
		workflow: result.workflow
	};
}

/** JSON with object keys sorted at every level, so equal records serialise identically. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, v: unknown) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, (v as Record<string, unknown>)[k]])
				)
			: v
	);
}

/** Store a run record; returns its asset hash, for the version's `runHash`. */
export function putRun(db: Db, record: RunRecord): Promise<string> {
	return putAsset(db, Buffer.from(canonicalJson(record)), 'application/json');
}
