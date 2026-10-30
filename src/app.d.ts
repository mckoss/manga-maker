// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** App version from package.json, injected at build time. */
	const __APP_VERSION__: string;

	namespace App {
		// interface Error {}
		interface Locals {
			user: { id: number; username: string; isAdmin: boolean } | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
