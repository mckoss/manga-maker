import { describe, it, expect } from 'vitest';
import { isCrossSiteWrite } from './csrf';

const req = (method: string, origin?: string) =>
	new Request('http://app.example/x', {
		method,
		headers: origin ? { origin } : {}
	});

describe('isCrossSiteWrite', () => {
	it('allows reads from anywhere', () => {
		expect(isCrossSiteWrite(req('GET', 'https://evil.example'), 'app.example')).toBe(false);
	});

	it('allows same-host writes regardless of scheme', () => {
		expect(isCrossSiteWrite(req('POST', 'https://app.example'), 'app.example')).toBe(false);
		expect(isCrossSiteWrite(req('POST', 'http://app.example'), 'app.example')).toBe(false);
	});

	it('refuses cross-site, missing and malformed origins', () => {
		expect(isCrossSiteWrite(req('POST', 'https://evil.example'), 'app.example')).toBe(true);
		expect(isCrossSiteWrite(req('DELETE', 'https://app.example:8443'), 'app.example')).toBe(true);
		expect(isCrossSiteWrite(req('POST'), 'app.example')).toBe(true);
		expect(isCrossSiteWrite(req('POST', 'null'), 'app.example')).toBe(true);
	});
});
