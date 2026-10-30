/** Usernames are case-insensitive; store and compare them in this form. */
export function normalizeUsername(name: string): string {
	return name.trim().toLowerCase();
}

/** Returns why a (normalized) username is unacceptable, or null if it is fine. */
export function usernameProblem(name: string): string | null {
	if (name.length < 3 || name.length > 254) return 'Username must be 3 to 254 characters.';
	if (!/^[a-z0-9][a-z0-9._@+-]*$/.test(name))
		return 'Username may contain letters, digits and . _ @ + - only.';
	return null;
}
