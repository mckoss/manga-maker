# Manga Maker — Plan (draft)

Status: **in progress.** Build progress is tracked in `CHECKLIST.md`.

## Goals

Help people — including people who have never run a creative project — make
short manga-style comics with AI running entirely on local hardware.

1. **Guide the process.** Walk the user through the phases of a comic project
   in order, explain what each phase is for, and tell them what is missing
   before they move on. Allow going back; never trap the user in a wizard.
2. **Keep images consistent.** A character must look like the same person on
   every page; a location must look like the same place.
3. **Keep the story coherent.** Plot and arcs should hang together: setups
   pay off, characters act in character, scenes advance the story.
4. **Individual accounts.** Each user signs in with a username and password and
   owns their own projects.

### Non-goals (for now)

- Cloud AI services. Everything runs on the host machine.
- Real-time multi-user co-editing of one project.
- Scale. The server hosts **one or two users**; no quotas or queue fairness.
- Long serialized works. A comic is at most **30 pages**.

## The phases

The top level is the user's collection of **manga**, each shown with its
title and a cover thumbnail (the style's figure sample until there is a real
cover). Opening a manga shows a sidebar of its steps: **Style, Characters,
Locations, Plot, Script, Panels, Pages**. The style, characters and locations
belong to that manga; to reuse one in another manga the user copies it, so
changing it in one comic never silently changes another. Once approved, each
carries canonical reference images that every later generation draws on.

Each manga starts with a style, then moves through the creative phases. Each phase produces structured data
(not just prose), and later phases build on it. Every phase has a **mentor**:
the LLM explains the phase, asks the user questions, drafts suggestions, and
runs a checklist review before the user advances.

### 0. Style

The drawing style is itself an AI-assisted, approvable artifact, chosen
before any character is drawn so every reference sheet is made in it.

- Settings: **colour** (black-and-white with screentones, greyscale, limited
  palette, full colour), line weight and texture, shading approach, panel
  border and gutter look, genre conventions (shōnen, shōjo, chibi, …).
- The mentor turns a plain-language description ("gritty 90s seinen, heavy
  blacks") into a structured style spec plus a prompt fragment.
- **Style sheet**: a fixed set of test images — a neutral figure, a face
  close-up, an interior, an exterior, an action shot — generated in the style.
  The user iterates until satisfied and approves it; the approved sheet is the
  style reference for all later generations.
- **Reading direction** (right-to-left or left-to-right) is a per-project
  setting next to the style; it drives page layout, panel order and bubble
  order, not image generation.
- A new manga can start from a copy of another manga's approved style.

### 1. Characters

- Interview-style creation: role in the story, want vs. need, flaw,
  personality, relationships, speech style.
- Structured **visual spec**: age, build, hair, eyes, face, signature outfit,
  props, colour notes. The spec — not free text — drives every image prompt.
- **Character sheet**: generate candidates, user picks one, then generate a
  turnaround (front / three-quarter / side) and an expression set from it.
  The approved sheet becomes the canonical reference for all later images.
- Sheets are per **character × style** (locations likewise). Reusing a library character in a
  project with a different style restyles the existing sheet (edit model,
  sheet as reference) for approval rather than redesigning from scratch.
- Mentor checks: distinct silhouettes between characters, a clear goal and
  flaw for the protagonist, no near-duplicate designs.

### 2. Scenes (locations)

- Locations with a structured description, time of day, mood, and recurring
  props.
- Generate an establishing reference image per location; approved images
  become background references for panels set there.

### 3. Plot and script

- Premise and logline → story structure. Offer templates suited to short
  comics (three-act, kishōtenketsu) and explain them.
- Beat outline → scene list → page breakdown → panels.
- Each panel: shot type, characters present (linked records, not names in
  text), location, action, dialogue and captions.
- Mentor checks: every beat serves the arc, setups have payoffs, characters
  act consistently with their profiles, pacing fits the page count, page-turn
  reveals land on odd/even pages correctly.

### 4. Manga generation

- Per-panel image prompts are **compiled** from structured data: style spec + style reference +
  character visual specs + reference images + location reference + shot +
  action. The user can tweak, but starts from a consistent prompt.
- Several candidates per panel; user picks or regenerates; fixed seeds kept
  for reproducibility.
- **Automated consistency check**: a vision LLM (Gemma 4 has vision) compares
  each candidate against the character sheet and flags mismatches (hair,
  outfit, missing character) before the user sees it.
- **Page layout and lettering are done by the app**, not the image model:
  panel grids, gutters, speech bubbles, captions and SFX rendered as vector
  overlays with a real font. Image models letter text badly; this keeps
  dialogue editable.
- **Export the whole comic as a print-ready PDF for publishing** (and pages
  as PNG). No public sharing links; the site is private to its users.

### Change propagation

When an upstream item changes (a character's outfit, a location), every
downstream panel that used it is marked **stale** so the user can choose to
regenerate. Each generated asset records the exact inputs it was made from.

## Image consistency strategy

Layered, cheapest first:

1. **Approved style**: the style spec's prompt fragment, style sheet
   references and fixed model/sampler settings, applied to every generation.
2. **Structured prompts** compiled from specs, so wording never drifts.
3. **Reference-conditioned generation**: models that take reference images
   (multi-reference editing models) to keep identity across panels.
4. **Per-character LoRA** (optional, later): train a small adapter from the
   approved character sheet for the strongest identity lock. Training runs as
   a background job on the GPU.
5. **Vision-model QA** on every candidate, as above.

### Image runtime: ComfyUI

The app drives a local **ComfyUI** server through its HTTP API
(`COMFYUI_URL`, default `http://127.0.0.1:8188`). The repo ships its own
API-format workflows under `workflows/`; the app fills in prompts, seeds and
reference images, uploads inputs (`/upload/image`), queues the job
(`/prompt`), follows progress over ComfyUI's WebSocket, and fetches results
(`/view`) into the asset store. It never reads ComfyUI's output folder
directly, so ComfyUI can run as a separate, unprivileged user or host.

Models, all already proven on the reference host (warm timings, M5 Ultra):

| Role                                           | Model                                    | Time  |
| ---------------------------------------------- | ---------------------------------------- | ----- |
| First drafts: character, location, style       | Qwen-Image 2512 + 4-step Lightning LoRA  | ~10 s |
| Fast exploration                               | Z-Image Turbo, 8 steps                   | ~8 s  |
| Identity-preserving panels (up to 2 refs)      | Qwen-Image-Edit 2509 + Lightning LoRA    | ~23 s |
| Masks and cut-outs (inpainting, compositing)   | SAM 3.1                                  | 2–4 s |
| Candidate upgrade for multi-reference identity | Qwen-Image-Edit 2511 (not yet installed) | ?     |

Milestone 1 includes a **manga style evaluation** rather than a runtime
spike: can these models produce clean black-and-white manga line art and
screentones (and each colour mode) on demand, how well does Qwen-Image-Edit hold a
character's identity across poses and shots, and is 2511 or a manga style
LoRA worth adding?

**GPU time per comic.** A 30-page comic at ~5 panels per page is ~150
panels. At ~23 s per identity-preserving candidate and ~4 candidates per
panel, a full comic is roughly 4 hours of GPU time, plus character and
location sheets. With one or two users that is acceptable, but it argues for
"generate one candidate, then more on request" and for batch generation that
can run overnight.

**Memory budget.** GPU and CPU share unified memory. The Qwen image models
take ~57 GB loaded; a large LLM loaded alongside, or video models, have
caused ComfyUI to be killed. The worker therefore schedules text and image
jobs against a memory budget, prefers mid-size LLMs (Qwen 3.8 27B, Gemma 4
26B) for interactive mentor chat, and never runs video.

## Data model (first cut)

| Entity          | Key fields                                                                           |
| --------------- | ------------------------------------------------------------------------------------ |
| user            | username (unique), password hash (scrypt), created                                   |
| session         | token hash, user, expires                                                            |
| style           | owner, name, colour mode, spec (JSON), prompt fragment, model settings, sheet assets |
| manga           | owner, title, logline, reading direction, style (its own copy)                       |
| character       | owner, name, role, profile (JSON), visual spec (JSON)                                |
| location        | owner, name, description, mood                                                       |
| story           | project, structure template, beats (ordered)                                         |
| page / panel    | order, layout slot, shot, location, characters, action, text blocks                  |
| reference_sheet | (character or location) × style → approved reference assets                          |
| project_cast    | project ↔ character / location links (library reuse)                                 |
| asset           | sha256, mime, size, dimensions — file at `data/assets/ab/cd/<sha256>`                |
| generation      | target (sheet/panel/…), compiled prompt, refs, seed, model, status                   |
| job             | kind, payload, status, progress, error, priority, timestamps                         |
| mentor_thread   | project, phase, messages                                                             |

## Accounts and security

- Username + password. Hash with `scrypt` from `node:crypto` (no native
  dependency). Minimum length, check against a common-password list.
- Server-side sessions: random token in an `HttpOnly`, `Secure`,
  `SameSite=Lax` cookie; only a hash is stored. SvelteKit's built-in CSRF
  origin check stays on.
- Login rate limiting per username and per IP.
- **No public sign-up.** An **admin** adds other accounts and resets their
  passwords from an admin page. Usernames may be email addresses, but nothing
  is ever emailed.
- **Admins are listed in `config/admins.txt`** (gitignored; one username per
  line, `config/admins.example.txt` shows the format), so the public repo
  never names them. Admin rights are read from the file, not stored in the
  database: editing the file grants or revokes them.
- **Bootstrap and recovery** by CLI on the server only:
  `npm run user -- add <username>` prompts for the password (never taken from
  arguments or environment). Creating the first account named in
  `config/admins.txt` this way is how the first admin starts. The same CLI
  resets a password if an admin is locked out.
- Accounts exist mainly because the site is internet-facing.
- Every query is scoped by owner; tests cover cross-user access.
- In production the app runs as its own unprivileged macOS user, not the
  owner's account: it is internet-facing, so a compromise must not reach the
  owner's home folder, keys or the AI services' admin interfaces. It talks to
  Ollama and ComfyUI over loopback HTTP only.

## Architecture

```
Browser ──HTTPS──▶ edge (Tailscale Serve now; public edge later)
                        │
                        ▼
              SvelteKit app (adapter-node, Node 24)
              ├── SQLite (WAL mode)
              ├── data/assets/ — content-addressed image files
              ├── job worker (same process, SQLite-backed queue)
              │      ├──▶ TextModel  → Ollama HTTP API
              │      └──▶ ImageModel → ComfyUI HTTP API (+ WebSocket progress)
              └── SSE stream: job progress to the browser
```

### Stack

| Layer          | Choice                                                               |
| -------------- | -------------------------------------------------------------------- |
| UI + server    | SvelteKit 3, Svelte 5, TypeScript, adapter-node                      |
| Database       | SQLite via `better-sqlite3` + Drizzle ORM (typed schema, migrations) |
| Object storage | Local filesystem under `data/`, content-addressed                    |
| LLM            | Ollama: Qwen 3.8 / Gemma 4 for text, Gemma 4 for vision QA           |
| Image gen      | ComfyUI HTTP API with Qwen-Image / Qwen-Image-Edit / Z-Image         |
| Page layout    | SVG in the browser; server-side render for PNG/PDF export            |
| Tests          | Vitest (unit, with fake AI backends); Playwright later for E2E       |
| CI             | GitHub Actions: lint, typecheck, unit tests, build                   |

### AI backends

`TextModel` and `ImageModel` interfaces with an Ollama adapter, an image
adapter, and **fake** adapters used in tests and CI (no GPU on GitHub
runners). LLM calls that feed the data model use structured (JSON schema)
output, validated before saving.

### Jobs

The GPU is one shared resource. Requests enqueue a `job` row; one in-process
worker runs jobs one at a time, oldest first. Jobs left running by a restart
are queued again, and cancelled jobs are aborted (ComfyUI prompts are removed
from its queue or interrupted). Pages poll every two seconds while their jobs
run; with one or two users that is simpler than server-sent events.

### Styles as built

Each style has numbered versions: at most one **draft**, one **approved**
version in use, and **superseded** history. The AI art director drafts the
style prompt from the user's description and revises it from their feedback;
the user can also edit it directly. Samples render five fixed subjects
(figure, face, interior, exterior, action) with seeds kept across versions, so
a revision's samples sit under the in-use version's for comparison. Approval
requires a full sample set made from the current prompt. See
`docs/style-evaluation.md`.

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

The dev server runs as a launchd agent so it survives logout of the shell
and restarts on failure, with hot reload intact:
`deploy/launchd/install-dev.sh` (`uninstall` to remove). Logs go to
`~/Library/Logs/manga-maker/`.

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

0. **Foundation** _(done)_: repo, CI, scaffold, placeholder page on the
   tailnet, dev server under launchd.
1. **Platform**: SQLite + migrations, accounts and sessions, manga CRUD,
   asset store, job queue + SSE, `TextModel` (Ollama), `ImageModel`
   (ComfyUI) and fakes. Manga style evaluation (see above).
2. **Style and characters**: style spec, style sheet, interview, visual spec, sheet generation and approval,
   mentor checklist.
3. **Scenes (locations)**: structured description, reference image
   generation and approval, mentor checklist.
4. **Plot and script**: structure templates, beats → scenes → pages → panels,
   dialogue, mentor continuity review.
5. **Manga generation**: prompt compiler, panel candidates, vision QA, page
   layout editor, lettering, stale tracking, export.
6. **Polish**: onboarding, guidance copy, admin tools, backups.
7. **Public launch**: production service, public edge (still undecided),
   monitoring.

Each milestone ends usable on the tailnet.

## Open questions

None at the moment; new ones go in `QUESTIONS.md`.
