# Manga Maker — Plan (draft)

Status: **draft — goals still being gathered.** Sections marked _TBD_ wait on
answers to the open questions at the bottom.

## Goals

_TBD — to be filled in from the goals discussion._

## Architecture

```
Browser ──HTTPS──▶ public edge (tunnel / reverse proxy)
                        │
                        ▼
              SvelteKit app (adapter-node, Node 24)
              ├── SQLite (metadata, users, jobs)
              ├── data/ on local disk (generated images, uploads)
              ├── job queue (in-process, backed by SQLite)
              │      ├──▶ LLM backend (Ollama HTTP API)
              │      └──▶ Image backend (TBD: ComfyUI / mflux / Draw Things)
```

### Stack

| Layer          | Choice                                                        |
| -------------- | ------------------------------------------------------------- |
| UI + server    | SvelteKit 3, Svelte 5, TypeScript, adapter-node               |
| Database       | SQLite (driver TBD: `better-sqlite3` or Node's `node:sqlite`) |
| Object storage | Local filesystem under `data/`, content-addressed file names  |
| LLM            | Ollama HTTP API (Gemma 4, Qwen 3.8 already installed)         |
| Image gen      | _TBD_ — nothing installed yet                                 |
| CI             | GitHub Actions: lint, typecheck, unit tests, build            |

### Backend adapters

Every AI backend sits behind a small TypeScript interface (`TextModel`,
`ImageModel`) so a backend can be swapped and so CI can run with a fake
backend — GitHub runners have no GPU and no Ollama.

### Long-running work

Image generation takes seconds to minutes and the GPU is a single shared
resource. Requests enqueue a job row in SQLite; one worker runs jobs serially
(or with a small concurrency limit) and streams progress to the browser via
server-sent events.

## Hosting and exposure

The repo stays public, so it holds only **generic** deployment material:

- `deploy/` — templates and docs (launchd service plist, example proxy or
  tunnel config with placeholder hostnames).
- `deploy/local/` — gitignored; the real hostnames, tunnel IDs, and tokens.
- `.env` — gitignored; `.env.example` documents each variable.

**Now (testing):** Tailscale Serve proxies HTTPS on the machine's tailnet
name to the app on `127.0.0.1`. Tailscale provisions and renews the
certificate. Only devices joined to the tailnet can reach it.

```sh
tailscale serve --bg --https=443 http://127.0.0.1:5173   # dev server
```

**Later (public):** undecided. Options considered so far:

1. **Cloudflare Tunnel** — no open inbound ports, hides the home IP, free TLS,
   optional Cloudflare Access in front.
2. **Tailscale Funnel** — already installed; simplest, but `*.ts.net` hostname
   only and bandwidth limits.
3. **Caddy + router port forward** — Caddy is installed; exposes the home IP
   and needs dynamic DNS.
4. **Railway-hosted proxy joined to the tailnet** — keeps DNS where it is;
   no CDN or edge protection, egress cost per image.

## Milestones

_TBD after goals._ Rough shape:

0. Repo, CI, scaffold, placeholder page on the tailnet _(done)_
1. Backend adapters + job queue + storage, smoke-tested against Ollama
2. Core user flow (per goals)
3. Auth and abuse limits (required before public exposure)
4. Deployment: launchd service, public edge, monitoring

## Open questions

See the conversation; answers get folded into the sections above.
