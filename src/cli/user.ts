/**
 * Manage accounts from the server's shell, e.g. to create the first admin:
 *
 *   npm run user -- add <username> [--generate]
 *   npm run user -- passwd <username> [--generate]
 *   npm run user -- list
 *
 * Passwords are prompted for, never read from arguments or the environment,
 * so they stay out of shell history. Without a terminal (e.g. a remote agent
 * session), --generate creates a random password and prints it once; change
 * it afterwards on the Account page. Admin rights come from
 * config/admins.txt, not from this tool.
 */
import { randomBytes } from 'node:crypto';
import { config } from '../lib/server/config';
import { openDb } from '../lib/server/db';
import { isAdmin } from '../lib/server/auth/admins';
import { createUser, findUser, listUsers, setPassword, UserError } from '../lib/server/auth/users';

/** Read a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
	const { stdin, stdout } = process;
	if (!stdin.isTTY) throw new UserError('A terminal is required to enter a password.');
	return new Promise((resolve, reject) => {
		let input = '';
		stdout.write(question);
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding('utf8');
		const onData = (chunk: string) => {
			for (const ch of chunk) {
				if (ch === '\r' || ch === '\n') {
					done();
					resolve(input);
					return;
				} else if (ch === '\u0003') {
					done();
					reject(new UserError('Cancelled.'));
					return;
				} else if (ch === '\u007f') {
					input = input.slice(0, -1);
				} else {
					input += ch;
				}
			}
		};
		const done = () => {
			stdin.off('data', onData);
			stdin.setRawMode(false);
			stdin.pause();
			stdout.write('\n');
		};
		stdin.on('data', onData);
	});
}

/** A random password, or undefined to prompt for one. */
function generated(flags: string[]): string | undefined {
	return flags.includes('--generate') ? randomBytes(18).toString('base64url') : undefined;
}

function announce(password: string | undefined) {
	if (password) console.log(`Generated password: ${password}`);
}

async function promptNewPassword(): Promise<string> {
	const password = await promptHidden('Password: ');
	if (password !== (await promptHidden('Confirm password: '))) {
		throw new UserError('Passwords do not match.');
	}
	return password;
}

async function main(args: string[]) {
	const flags = args.filter((a) => a.startsWith('--'));
	const [command, username] = args.filter((a) => !a.startsWith('--'));
	const password = generated(flags);
	const db = openDb(config.databasePath);
	switch (command) {
		case 'add': {
			if (!username) throw new UserError('Usage: user add <username>');
			if (findUser(db, username)) throw new UserError(`User ${username} already exists.`);
			const user = await createUser(db, username, password ?? (await promptNewPassword()));
			const role = isAdmin(user.username) ? 'admin' : 'user';
			console.log(`Created ${role} ${user.username} in ${config.databasePath}`);
			announce(password);
			break;
		}
		case 'passwd': {
			if (!username) throw new UserError('Usage: user passwd <username>');
			const user = findUser(db, username);
			if (!user) throw new UserError(`No user ${username}.`);
			await setPassword(db, user.id, password ?? (await promptNewPassword()));
			console.log(`Password changed for ${user.username}; their sessions were signed out.`);
			announce(password);
			break;
		}
		case 'list':
			for (const u of listUsers(db)) {
				console.log(`${u.username}${isAdmin(u.username) ? ' (admin)' : ''}`);
			}
			break;
		default:
			throw new UserError('Usage: user add|passwd <username> [--generate] | user list');
	}
}

main(process.argv.slice(2)).catch((e) => {
	if (!(e instanceof UserError)) throw e;
	console.error(e.message);
	process.exit(1);
});
