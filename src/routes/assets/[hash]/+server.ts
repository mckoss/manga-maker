import fs from 'node:fs';
import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { assetPath, getAsset } from '#lib/server/assets.js';
import type { RequestHandler } from './$types';

/**
 * Serve a stored file by hash to any signed-in user (the hook requires a
 * session). Hashes are unguessable, and the server has only a few users.
 */
export const GET: RequestHandler = ({ params }) => {
	if (!/^[0-9a-f]{64}$/.test(params.hash)) error(404, 'Not found');
	const asset = getAsset(getDb(), params.hash);
	if (!asset) error(404, 'Not found');
	return new Response(fs.readFileSync(assetPath(asset.hash)), {
		headers: {
			'content-type': asset.mime,
			'content-length': String(asset.size),
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
