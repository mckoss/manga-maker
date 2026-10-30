import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt cost: N=2^16, r=8 uses 64 MiB per hash, ~100 ms on Apple Silicon.
const PARAMS = { N: 2 ** 16, r: 8, p: 1 };
const KEY_LENGTH = 32;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
	return new Promise((resolve, reject) =>
		scrypt(
			password.normalize('NFKC'),
			salt,
			KEY_LENGTH,
			{ ...opts, maxmem: 256 * 1024 * 1024 },
			(err, key) => (err ? reject(err) : resolve(key))
		)
	);
}

/** Returns why a new password is unacceptable, or null if it is fine. */
export function passwordProblem(password: string): string | null {
	if (password.length < MIN_PASSWORD_LENGTH)
		return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
	if (password.length > MAX_PASSWORD_LENGTH)
		return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
	return null;
}

/** Hash as `scrypt$N$r$p$salt$key` (base64), so parameters can change later. */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await derive(password, salt, PARAMS);
	const { N, r, p } = PARAMS;
	return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [algo, N, r, p, salt, key] = stored.split('$');
	if (algo !== 'scrypt' || !key) return false;
	const expected = Buffer.from(key, 'base64');
	const actual = await derive(password, Buffer.from(salt, 'base64'), {
		N: Number(N),
		r: Number(r),
		p: Number(p)
	});
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
