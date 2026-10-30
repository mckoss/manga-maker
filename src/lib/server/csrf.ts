const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Whether a request is a cross-site write. SvelteKit's own origin check is off
 * in dev, which is what the tailnet preview runs, so this runs in every mode.
 *
 * Hosts are compared without the scheme: behind a TLS-terminating proxy
 * (Tailscale Serve) the app sees http:// while the browser's Origin is https://.
 * Browsers always send Origin on these methods, so a missing one is refused.
 */
export function isCrossSiteWrite(request: Request, host: string): boolean {
	if (!MUTATING.has(request.method)) return false;
	const origin = request.headers.get('origin');
	if (!origin) return true;
	try {
		return new URL(origin).host !== host;
	} catch {
		return true;
	}
}
