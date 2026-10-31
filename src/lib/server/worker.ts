import { createAiServices } from './ai';
import { getDb } from './db';
import { Worker } from './jobs';
import { characterJobHandlers } from './characters';
import { styleJobHandlers } from './styles';

// Kept on globalThis so dev-mode module reloads replace the worker instead of
// starting a second one alongside it.
const KEY = Symbol.for('manga-maker.worker');
const g = globalThis as { [KEY]?: Worker };

// adapter-node emits this once the HTTP server has closed (SIGTERM, SIGINT).
// Stop the worker so its timers don't keep the process running.
const SHUTDOWN = 'sveltekit:shutdown';
const stopOnShutdown = () => g[KEY]?.stop();
process.removeAllListeners(SHUTDOWN);
process.once(SHUTDOWN, stopOnShutdown);

export function startWorker(): void {
	g[KEY]?.stop();
	const worker = new Worker(getDb(), createAiServices(), {
		...styleJobHandlers,
		...characterJobHandlers
	});
	g[KEY] = worker;
	worker.start();
}
