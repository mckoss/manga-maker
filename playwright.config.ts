import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT } from './tests/e2e/accounts';

/** End-to-end tests against the production build (`npm run build` first). */
export default defineConfig({
	testDir: 'tests/e2e',
	// One server and one database: run the specs one after another.
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: {
		baseURL: `http://127.0.0.1:${E2E_PORT}`,
		extraHTTPHeaders: { 'x-forwarded-proto': 'http' },
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npx tsx tests/e2e/server.ts',
		url: `http://127.0.0.1:${E2E_PORT}/login`,
		reuseExistingServer: false,
		timeout: 60_000
	}
});
