import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { config } from './config';
import type { Db } from './db';
import { assets } from './db/schema';

const THUMB_SIZE = 384;

export function assetPath(hash: string, root = config.dataDir): string {
	return path.join(root, 'assets', hash.slice(0, 2), hash.slice(2, 4), hash);
}

/** Store bytes once under their SHA-256; returns the hash. */
export async function putAsset(
	db: Db,
	bytes: Buffer,
	mime: string,
	root = config.dataDir
): Promise<string> {
	const hash = createHash('sha256').update(bytes).digest('hex');
	if (db.select({ hash: assets.hash }).from(assets).where(eq(assets.hash, hash)).get()) return hash;
	const file = assetPath(hash, root);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	// Write then rename, so a crash never leaves a truncated file under a valid hash.
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, bytes);
	fs.renameSync(tmp, file);
	const meta = mime.startsWith('image/') ? await sharp(bytes).metadata() : undefined;
	db.insert(assets)
		.values({
			hash,
			mime,
			size: bytes.length,
			width: meta?.width ?? null,
			height: meta?.height ?? null,
			createdAt: new Date()
		})
		.onConflictDoNothing()
		.run();
	return hash;
}

/** Store an image plus a small WebP thumbnail; returns both hashes. */
export async function putImage(db: Db, png: Buffer, root = config.dataDir) {
	const thumb = await sharp(png)
		.resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside' })
		.webp({ quality: 82 })
		.toBuffer();
	return {
		hash: await putAsset(db, png, 'image/png', root),
		thumbHash: await putAsset(db, thumb, 'image/webp', root)
	};
}

export function getAsset(db: Db, hash: string) {
	return db.select().from(assets).where(eq(assets.hash, hash)).get();
}
