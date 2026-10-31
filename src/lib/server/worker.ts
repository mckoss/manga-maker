import { createAiServices } from './ai';
import { getDb } from './db';
import { Worker } from './jobs';
import { characterJobHandlers } from './characters';
import { styleJobHandlers } from './styles';

// Kept on globalThis so dev-mode module reloads replace the worker instead of
// starting a second one alongside it.
const KEY = Symbol.for('manga-maker.worker');
const g = globalThis as { [KEY]?: Worker };

export function startWorker(): void {
	g[KEY]?.stop();
	const worker = new Worker(getDb(), createAiServices(), {
		...styleJobHandlers,
		...characterJobHandlers
	});
	g[KEY] = worker;
	worker.start();
}
