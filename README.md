# Manga Maker

Make short manga-style comics with AI that runs entirely on your own machine:
local LLMs (via [Ollama](https://ollama.com)) for story and guidance, and local
image models (via [ComfyUI](https://github.com/comfyanonymous/ComfyUI)) for
the art. Built with SvelteKit, TypeScript and SQLite.

See [PLAN.md](PLAN.md) for the design and roadmap.

## Development

Requires Node 24.

```sh
npm install
cp config/admins.example.txt config/admins.txt   # list admin usernames
npm run user -- add you@example.com               # prompts for a password
npm run dev
```

Then open http://localhost:5173 and sign in.

| Command                           | What                                          |
| --------------------------------- | --------------------------------------------- |
| `npm run dev`                     | Dev server with hot reload                    |
| `npm test`                        | Unit tests                                    |
| `npm run check`                   | Type check                                    |
| `npm run lint` / `npm run format` | Prettier + ESLint                             |
| `npm run user -- add <name>`      | Create an account (prompts for password)      |
| `npm run user -- passwd <name>`   | Reset a password                              |
| `npm run user -- list`            | List accounts                                 |
| `npm run db:generate`             | Generate a migration after editing the schema |

Without a terminal, add `--generate` to `add` or `passwd` to create a random
password; it is printed once.

### Configuration

Environment variables (all optional):

| Variable        | Default                    | What                        |
| --------------- | -------------------------- | --------------------------- |
| `DATA_DIR`      | `data`                     | Runtime data (gitignored)   |
| `DATABASE_PATH` | `$DATA_DIR/manga-maker.db` | SQLite database             |
| `ADMINS_FILE`   | `config/admins.txt`        | Admin usernames, one a line |

### Accounts

There is no public sign-up. Admins (the usernames in `config/admins.txt`) add
accounts and reset passwords on the **Users** page; the CLI above creates the
first account. Sessions last 30 days and renew with use.

### Running as a service on macOS

`deploy/launchd/install-dev.sh` installs a launchd agent that keeps the dev
server running from this checkout. See [PLAN.md](PLAN.md#hosting-and-exposure)
for exposing it over Tailscale.

## License

[MIT](LICENSE)
