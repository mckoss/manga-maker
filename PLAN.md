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
belong to that manga; for now, to reuse one in another manga the user copies
it, so changing it in one comic never silently changes another. Each carries
reference images that every later generation draws on.

### Series and chapters (built in v0.10)

A series reuses its look and cast across stories, so the style, characters
and locations move up to a **series**, and each story is a **chapter** of it:

- The series owns **one style** and every character and location ever made
  for it. A one-off story is a series of one chapter.
- A chapter **picks its cast and locations** from the series, and owns its
  plot, script, panels and pages. A character made while working on a
  chapter joins the series (and that chapter's cast), ready for later ones.
- A chapter **pins the version** of each character (and location) it was
  made with. A redesign in the series shows as "newer version available" in
  earlier chapters instead of silently changing finished pages.
- Navigation: the home page lists series; a series has Style, Characters,
  Locations and its chapters; a chapter's sidebar has Cast and Locations
  (pickers), then Plot, Script, Panels and Pages.
- Existing manga become a series of the same name with one chapter.

As built: the pinned version is the character's design (its reference
picture), a version of the character's reference item (v0.13). A character
added before it has a design takes the first one chosen. Chapters are
numbered in order; deleting one renumbers the rest. The chapter's
Locations picker waits for locations.

### Every generation is kept

Every AI generation, text or image, is a version of a versioned item (see
"Versioned items" below), so nothing the AI wrote or drew is lost and any of
it can be recovered. The style and the characters (since v0.13) work this way,
and plot, script and the later steps are built on it.

Each manga starts with a style, then moves through the creative phases. Each phase produces structured data
(not just prose), and later phases build on it. Every phase has a **mentor**:
the LLM explains the phase, asks the user questions, drafts suggestions, and
runs a checklist review before the user advances.

### 0. Style

The drawing style is itself an AI-assisted, versioned artifact, settled
before any character is drawn so every reference sheet is made in it.

- Settings: **color** (black-and-white with screentones, grayscale, limited
  palette, full color), line weight and texture, shading approach, panel
  border and gutter look, genre conventions (shōnen, shōjo, chibi, …).
- The mentor turns a plain-language description ("gritty 90s seinen, heavy
  blacks") into a structured style spec plus a prompt fragment.
- **Style sheet**: a fixed set of test images — a neutral figure, a face
  close-up, an interior, an exterior, an action shot — generated in the style.
  The user iterates until satisfied, locking what they like; the current
  versions are the style reference for all later generations.
- **Reading direction** (right-to-left or left-to-right) is a per-project
  setting next to the style; it drives page layout, panel order and bubble
  order, not image generation.
- A new manga can start from a copy of another manga's style.

### 1. Characters

- Interview-style creation: role in the story, want vs. need, flaw,
  personality, relationships, speech style.
- Structured **visual spec**: age, build, hair, eyes, face, signature outfit,
  props, color notes. The spec — not free text — drives every image prompt.
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

### Backlog: precise staging, as a refine pass

**Fast production comes first:** panels are generated straight from prompts
and references. Precise control is a later, optional pass that refines an
image already generated, never a required step before generating one.

- **Posable figure:** a rigged 3D mannequin in the browser (three.js) to
  set a character's pose exactly. It renders a pose skeleton (and depth) as a
  guide image for the model, with the character's reference supplying
  identity.
- **3D scene block-out:** crude primitives (boxes, planes, cylinders) for a
  location's buildings, walls and furniture, plus the posed mannequins, with
  a real camera: position, angle, height and field of view. Renders depth,
  outline and pose guides; the location's reference supplies the look. The AI
  could stage it from a description ("Jun by the door, low angle").
  Converting a generated location picture into real 3D is out of scope at
  first: a depth estimate from one image only allows small camera moves.
- **Line drawings before rendering:** an optional pencils stage, to judge
  pose and composition without tone and lighting, then render with the
  approved lines as an edge guide so the composition holds. It saves
  attention, not compute (a line drawing costs as much as a full render),
  and each extra pass is a chance for identity to drift, so the render takes
  the reference and the lines together.
- **Spike before building:** test that the models obey pose, depth and edge
  guides with our characters: Qwen-Image-Edit 2509 accepts these maps as
  input images, and Qwen-Image 2.1 has a union ControlNet
  (`qwen_image_2.1_fun_controlnet_union`, not downloaded yet). Then build
  in order: mannequin and camera, block-out scenes, line-drawing pass.

### Backlog: names as references

The plot, scenes and dialogue should refer to characters and locations by
id, not by name, so a later revision can rename someone ("Jovi" → "Jun")
without rewriting the story: names are filled in when text is shown, and
when dialogue is lettered into the final pages. For now, a character's first
name is its canonical name: the AI's first name for a character is locked,
the plot uses it, and a global replace when lettering is the planned way to
change it.

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
screentones (and each color mode) on demand, how well does Qwen-Image-Edit hold a
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

| Entity          | Key fields                                                                          |
| --------------- | ----------------------------------------------------------------------------------- |
| user            | username (unique), password hash (scrypt), created                                  |
| session         | token hash, user, expires                                                           |
| style           | owner, name, color mode, spec (JSON), prompt fragment, model settings, sheet assets |
| series          | owner, title, logline, reading direction, style (its own copy)                      |
| chapter         | series, number, title, logline                                                      |
| chapter_cast    | chapter ↔ character, pinned design (reference picture)                              |
| character       | owner, name, role, profile (JSON), visual spec (JSON)                               |
| location        | owner, name, description, mood                                                      |
| story           | project, structure template, beats (ordered)                                        |
| page / panel    | order, layout slot, shot, location, characters, action, text blocks                 |
| reference_sheet | (character or location) × style → approved reference assets                         |
| project_cast    | project ↔ character / location links (library reuse)                                |
| asset           | sha256, mime, size, dimensions — file at `data/assets/ab/cd/<sha256>`               |
| generation      | target (sheet/panel/…), compiled prompt, refs, seed, model, status                  |
| job             | kind, payload, status, progress, error, priority, timestamps                        |
| mentor_thread   | project, phase, messages                                                            |

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
are queued again, and canceled jobs are aborted (ComfyUI prompts are removed
from its queue or interrupted). Pages poll every two seconds while their jobs
run; with one or two users that is simpler than server-sent events.

### Versioned items

Anything the user and the AI make in rounds is a versioned **item**
(`items` and `versions` tables, `src/lib/server/versions.ts`), scoped to what
it belongs to ("style:3"). Every round is kept as a version. The newest is
**current** unless the user goes back to an older one; a **locked** item is
never regenerated, singly or in bulk, until unlocked. Each version records
the **inputs** it was made from, so an item whose inputs have since changed
shows **Out of date** with the reason. Versions can be deleted one at a time,
or all but the current one. A regeneration can carry the user's **guidance**
for that one round.

### Pipeline registry and engine

The plumbing every pipeline needs — what each item is made from, where it
stands, what is due, starting versions and their jobs, finishing them and
carrying a cascade on — lives once in `src/lib/server/pipeline/`, not in each
domain module:

- `ids.ts`: typed scopes (`scopeOf.character(12)` → `"character:12"`,
  `parseScope`) and slots (`slot('design', '3')`, `parseSlot`, `slotKey`),
  validated, instead of template literals and `split(':')`.
- `registry.ts`: the declarative shape. A **pipeline** is a domain, a `load`
  for its state, input labels and an ordered list of **stages**. Each stage
  names the item kinds it makes, its fan-out (`slots`), each slot's
  `inputs` and `upstream` slots, an optional `ready` gate, `anchored` rule,
  `prepare` hook (seeds, models, guidance) and **job** (`per: 'stage'` or
  `'slot'`, with a `run` that returns content by slot, or null to drop it),
  whether it `cascades` (default yes) and its `staleness` (`'transitive'`
  by default; `'own'` ignores earlier steps), and `afterFinish`.
- `engine.ts`: one generic engine for any pipeline. `describe` scans the
  scope once and memoises statuses (missing, pending, outdated, upstream,
  ok); kept items and anchored ones (a chosen reference) count as settled
  and are never due. `dueSlots`, `start` (pending versions plus queued jobs,
  payloads unchanged from before), `advance` (stage by stage, waiting on
  what was just started) and `handlers` (finish only while still pending,
  current only where not locked; abandon on null; `afterFinish`; carry the
  cascade on unless `cascades: false`).
- `entity.ts`: `entityPipeline(config)`, the profile → designs → pictures →
  reference → sheet pipeline, parameterised by the domain's data (profile
  and look kinds, design keys, sheet views, picture size) and hooks (text
  jobs, prompts, `afterDevelop`). Characters and locations run on it;
  prompts stay in the domain module. A character's `afterDevelop` locks the
  first name the AI writes; a location's only copies the name to its row.
- Plots (`plots.ts`) build their four stages directly on `engine`. The
  beats' fan-out is the chosen structure's beats and the review's upstream
  is those beats, so beats of an earlier structure stay in the scope as
  orphans (shown as busy while pending, dropped from a job that finds them
  orphaned). A job's `run` may return null to say it had nothing to do (its
  versions were dropped, or no structure is chosen): its versions are left,
  and neither `afterFinish` nor the cascade runs. The beats job keeps its
  payload keyed by whole slots (`payloadKeys: 'slot'`, "beat:hook"); the
  engine reads either form back. The questions → answers → notes clarify
  flow stays outside the engine in `plots.ts`; the pipeline's
  `inputsOutside` gives its questions their inputs so they go out of date.
- Styles (`styles.ts`) build prompt → scenes → pictures on `engine`, with
  `cascades: false` on every stage: a style never regenerates by itself,
  and each request starts exactly what it names (pictures still queue a
  missing prompt or scene first, and are queued right behind it). The
  "outdated" bulk requests still pick items by their own inputs. Statuses
  are transitive as elsewhere, so a picture whose prompt or scene is out of
  date (or being rewritten) shows "Earlier step changed". The description
  and keep-out list are upstream of the prompt and scenes but made by no
  stage; the pipeline's `anchoredOutside` counts them settled unless being
  rewritten, so a keep-out list never written holds nothing back. Their
  jobs keep their lean payloads (only the style's and versions' ids) with
  the stage's `job.payload: 'ids'`. One escape hatch: when the AI leaves a
  scene out, the scenes job finishes the ones it wrote itself and then
  fails, leaving the missing one pending with the error, as before (the
  engine finishes a job's versions only when its run succeeds).
- Clarify stays per domain. Styles and plots both ask questions, fold the
  answers into the user's own text and put the questions away, but differ
  where a shared `pipeline/clarify.ts` would change one of them: plots
  refuse a kept questions item and refuse to ask without an idea, styles
  skip a kept item quietly; and each job reads its own domain's context.
  Both stay beside the engine as a documented "Clarify" section, with
  `inputsOutside` giving the questions their inputs.

- Prompts (`src/lib/server/prompts/`): every AI text step's system prompt
  is registered once with `definePrompt(id, text)` → `{ id, text, hash }`,
  the hash being the first 12 hex digits of the SHA-256 of the exact text.
  Ids are namespaced by domain: `style.prompt`, `style.scenes`,
  `style.questions`, `style.fold`, `character.develop`,
  `character.designs`, `location.develop`, `location.designs`,
  `plot.structure`, `plot.elements`, `plot.beats`, `plot.review`,
  `plot.questions`, `plot.fold`. The texts live in one module per domain
  (`prompts/style.ts` …) and `prompts/index.ts` collects them into one
  table (a duplicate id throws at load), so every prompt is known whichever
  domain modules have loaded, and a dev-server reload rebuilds the table
  whole. Texts are fixed at load; per-call state goes in the user message.
  `registry.spec.ts` pins each prompt's hash and length, so a wording
  change is deliberate and shows in review.
- Every AI text call goes through `askJson(ai, promptId, messages, schema,
signal)` (`prompts/ask.ts`): it puts `prompt(id).text` first as the
  system message, passes the id to `TextModel.json` as a trailing option
  (Ollama ignores it; `FakeTextModel` records it in `promptIds`), and
  returns `{ value, prompt: { promptId, promptHash }, run }`: the step
  spreads `prompt` into the version it finishes and stores `run` with
  `putRun` as its `runHash`.
- Fake replies (`AI_BACKEND=fake`, and the unit tests) are routed by
  prompt id, never by the system prompt's wording: `fakeReplies` in
  `ai/index.ts` is a `Record<PromptId, (messages) => unknown>`, so a new
  prompt without a fake fails the type check, and `fakeReply` is
  `byPrompt(fakeReplies)`. `FakeTextModel`'s responder gets
  `(messages, promptId)`; a call without a prompt id, or with an unknown
  one, throws, and `byPrompt({...})` throws for an id its table leaves
  out. Specs build their own responders with `byPrompt` and find requests
  through `promptIds`. A few fakes still read the user message (the
  feedback, the beats to write, the writer's notes), so they depend on its
  format. `ai/fake.spec.ts` checks every id has a fake and that a reworded
  prompt (`setPromptOverride`) gets the same reply.
- Run records (`src/lib/server/runs.ts`): every AI-made version made since
  v0.26.0 keeps a record of the call that made it, in `versions.run_hash`
  (null for the user's own versions and older ones). `TextModel.json`
  returns `{ value, run }`, the run being `{ model, options, messages,
attempts, parsed }`: `messages` exactly as first sent, each attempt's
  raw `reply` and, if it could not be used, its parse `error`; a retry's
  `added` holds the bad reply and the correction message appended before
  it, so the retry's conversation is `messages` + `added`. Ollama records
  both attempts; when both fail the job fails and nothing is stored. Image
  steps record `{ model, seed, request: { prompt, negative?, width?,
height?, images? }, workflow }`: `workflow` is the filled backend input
  (`ImageResult.workflow`), `images` the asset hashes of an edit's source
  pictures, in the order sent (the logo's are the references it squares).
  A record is `{ kind: 'text' | 'image', version: 1, ... }` serialised as
  canonical JSON (keys sorted at every level) and stored with
  `putAsset(db, bytes, 'application/json')`, so the same record is one
  asset (all the scenes a job writes share one). Records are written by
  the engine's steps (through their `StepOutput.runHash`) and by every
  path outside it: the clarify questions and folds in plots and styles,
  and the logo. A copied style keeps its versions' records. `VersionView`
  carries `runHash`; `VersionNav` then shows a muted "Details" disclosure
  that fetches `/assets/{runHash}` when opened and lays the record out
  (messages, attempts and errors, parsed value; or model, seed, prompt and
  the workflow), each block scrolling on its own.
- Versions record `prompt_id` and `prompt_hash` (empty for the user's own,
  pictures, and versions made before). `VersionView.promptChanged` is true
  when a recorded hash differs from the prompt's current one (an unknown
  id or empty hash is never changed); `VersionNav` then shows a muted "made
  with an earlier version of the prompt" note. It is informational only:
  it never makes anything out of date, due or regenerated.
- Editing seam: `prompt(id)` is the only read path for a prompt's text, and
  it asks an override (`setPromptOverride`) first. Nothing installs one
  yet; an editor would install one backed by the database (the user's text
  for an id, or undefined for the built-in), and versions made before an
  edit would then show the note. Image prompts are built per call by the
  domains' `*Prompt()` builders and are not registered; image steps get
  run records instead.

The refactor landed in small, behaviour-preserving PRs:

1. Typed ids, the registry and engine, and characters on `entityPipeline`
   (v0.23.1).
2. Locations on the same `entityPipeline` factory (v0.23.2).
3. Plots: slots and upstream as functions of the state, `ready` gates, the
   cast sync as `afterFinish`. The questions → answers → fold "clarify" flow
   stays outside the engine, in `plots.ts` for now (v0.23.3).
4. Styles on the engine with `cascades: false` everywhere: never
   auto-rerender, but transitive "out of date"/"Earlier step changed"
   highlighting so users regenerate by hand. The clarify flow stays in
   each domain: unifying it would change one or the other (v0.24.0).
5. Prompt registry: `definePrompt(id, text)` → `{ id, text, hash }` with
   namespaced ids (`character.develop`); versions gain `prompt_id` and
   `prompt_hash`, and show a soft "made with an earlier version of the
   prompt" note that never counts as out of date (text steps only)
   (v0.25.0).
6. Run records: `TextModel.json` returns `{ value, run }` (messages, raw
   replies, parse errors and retries, parsed value); images record the
   filled workflow, model and seed. Stored as a content-addressed JSON asset
   (`putAsset`, `versions.run_hash`), shown in a small Details disclosure in
   `VersionNav` (v0.26.0).
7. Fake text replies routed by prompt id, replacing substring matching
   (v0.26.1).

All seven have landed (#33–#38 and the last), so the refactor is done.
Follow-ups noticed along the way are in CHECKLIST.md.

The logo stays outside the engine.

### Styles as built

A style is a pipeline of items, shown in the order they are made:

- the user's **description** and **keep-out list** (versioned) and the color
  mode and image model (settings);
- the **style prompt**, written by the AI art director from the description,
  color mode and keep-out list, with a note explaining it;
- five **sample scenes** (figure, face, interior, exterior, action), written
  by the AI from the description and keep-out list to fit the setting and era;
- five **sample pictures**, drawn from the prompt and each scene; a redraw
  keeps the picture's seed (shown and editable) so differences come from the
  prompt.

Each item can be regenerated alone, and each stage can regenerate whatever is
missing or out of date. The rest of the manga is drawn with the current style
once it has at least one sample picture; there is no separate approval step.
See `docs/style-evaluation.md`.

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
8. **Refinement (backlog)**: precise staging for images already generated:
   posable 3D mannequins, 3D scene block-out with camera and field of view,
   an optional line-drawing pass (see "Backlog: precise staging" above).

Each milestone ends usable on the tailnet.

## Open questions

None at the moment; new ones go in `QUESTIONS.md`.
