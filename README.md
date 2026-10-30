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
| `COMFYUI_URL`   | `http://127.0.0.1:8188`    | ComfyUI server for images   |
| `OLLAMA_URL`    | `http://127.0.0.1:11434`   | Ollama server for text      |
| `OLLAMA_MODEL`  | `qwen3.8:27b-mlx`          | Model for the AI mentor     |
| `AI_BACKEND`    | (real services)            | `fake` for placeholder AI   |

### AI services

Manga Maker expects [Ollama](https://ollama.com) and
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) running locally. The
ComfyUI workflows it submits are in `workflows/`; they need these models in
ComfyUI's model folders:

- `diffusion_models/qwen_image_2512_bf16.safetensors`,
  `text_encoders/qwen_2.5_vl_7b.safetensors`, `vae/qwen_image_vae.safetensors`,
  `loras/Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors`
- `diffusion_models/z_image_turbo_bf16.safetensors`,
  `text_encoders/qwen_3_4b.safetensors`, `vae/ae.safetensors`

Without them, run with `AI_BACKEND=fake` to try the app with placeholder images
and canned AI replies. See [docs/style-evaluation.md](docs/style-evaluation.md)
for how the models perform.

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
