import path from 'node:path';

/**
 * Filesystem locations, overridable by environment variables. Read on each
 * access so tests can point them at temporary directories.
 */
export const config = {
	get dataDir() {
		return path.resolve(process.env.DATA_DIR ?? 'data');
	},
	get databasePath() {
		return path.resolve(process.env.DATABASE_PATH ?? path.join(this.dataDir, 'manga-maker.db'));
	},
	get adminsFile() {
		return path.resolve(process.env.ADMINS_FILE ?? 'config/admins.txt');
	}
};
