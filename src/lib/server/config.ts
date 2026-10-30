import path from 'node:path';

/** Filesystem locations, overridable by environment variables. */
export const config = {
	dataDir: path.resolve(process.env.DATA_DIR ?? 'data'),
	get databasePath() {
		return path.resolve(process.env.DATABASE_PATH ?? path.join(this.dataDir, 'manga-maker.db'));
	},
	adminsFile: path.resolve(process.env.ADMINS_FILE ?? 'config/admins.txt')
};
