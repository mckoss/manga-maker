# Checklist

Build progress against [PLAN.md](PLAN.md). Questions for the maintainer go in
[QUESTIONS.md](QUESTIONS.md).

## Milestone 1a: sign-in

- [x] SQLite + Drizzle schema and migrations (`users`, `sessions`)
- [x] scrypt password hashing, case-insensitive usernames
- [x] Server-side sessions (hashed tokens, 30-day sliding expiry)
- [x] Sign-in / sign-out, login rate limit, origin check that also runs in dev
- [x] Admins from gitignored `config/admins.txt`
- [x] Admin **Users** page: add, reset password, delete
- [x] Account page: change own password
- [x] `npm run user` CLI (`add`, `passwd`, `list`, `--generate`)
- [x] Unit tests; end-to-end check of the sign-in flow against a dev server

## Milestone 1b: style generator loop

- [x] Asset store (content-addressed files under `data/assets`, WebP thumbnails)
- [x] Job queue + worker (restart recovery, cancellation); pages poll while busy
- [x] `TextModel` (Ollama) and `ImageModel` (ComfyUI) adapters, with fakes
- [x] Style library: create a style from a description (AI drafts the prompt)
- [x] Refine prompt (AI with feedback, or by hand) → samples → compare → approve
- [x] Versioned styles: a revision replaces the active version only on approval
- [x] Style evaluation notes: `docs/style-evaluation.md`
- [x] End-to-end run with real Ollama and ComfyUI; UI checked in a browser
- [x] Fix: sample scenes written by the AI to fit the style's era and setting;
      negative prompts (ignored at CFG 1) replaced by a "keep out" list the AI
      works into the prompt; negated clauses stripped from AI text

## Milestone 1c: manga collection

- [x] Manga as the top level: collection page with title and cover thumbnail
- [x] Manga sidebar: Style, Characters, Locations, Plot, Script, Panels, Pages
      (placeholders for all but Style)
- [x] Each manga owns its style; start one, or copy another manga's approved
      style; existing styles migrated into manga of the same name
- [x] Settings: title, logline, reading direction; delete
- [x] Playwright end-to-end tests in CI; `main` requires `check` and `e2e`

## Milestone 2a: characters

- [x] Characters per manga: name, role, the user's notes, personality, wants
      and needs, backstory, speech; age, appearance, outfit
- [x] AI story editor develops the profile from a brief, using the logline,
      the style's setting and the rest of the cast; revises from feedback
- [x] Design options: four full-body pictures in the approved style; choose
      one as the reference; flags pictures from an older look or style
- [x] Cast count in the sidebar; unit and e2e tests
- [x] Real-AI check and prompt fixes: `docs/character-evaluation.md`

## Milestone 2b: character sheets

- [x] `ImageModel.edit` (Qwen-Image-Edit through ComfyUI, image upload)
- [x] Sheet: three-quarter, side and back views plus five expressions,
      redrawn from the reference; redraw one or all; flags a sheet made from
      a different reference
- [x] Fix: the server now exits on SIGTERM (the job worker's timer kept it
      alive)

## Milestone 2c: versioned style pipeline

- [x] Shared versioned items: every version kept; current, go back, lock in,
      delete one or all older; inputs recorded to flag out-of-date items
- [x] Style page as a pipeline: description and keep-out list → style prompt
      (with the art director's note) → sample scenes → sample pictures
- [x] Per-item regenerate with guidance; per-stage "missing and out of date"
      and "all unlocked"; locked items are skipped
- [x] Pictures show their seed; redraw keeps it unless changed (🎲 for new)
- [x] No style approval: characters open once the style has a sample picture
- [x] Character sheet: redraw one view with guidance
- [x] Existing styles migrated with their history; American spelling
      throughout

## Milestone 2d: questions about the description

- [x] The art director asks up to four specific questions, with suggested
      answers, when a style description leaves out what would change the
      pictures (era, genre, mood, line work, references); none when it is
      detailed. Asked on start and whenever the user rewrites it
- [x] Answers fold into a new description version (in the user's voice);
      questions can be skipped and never block the prompt or samples
- [x] Plan: series and chapters; every generation kept

## Milestone 2e: series and chapters

- [x] Each manga is now a series (same id) with one chapter holding its
      whole cast; `/manga/...` links redirect
- [x] The series owns the style and characters; chapters are added,
      renamed and deleted (later ones renumber)
- [x] A chapter's Cast page picks characters from the series; a character
      made there joins the series and the chapter
- [x] A chapter pins each character's design (reference picture); a
      redesign shows as "Newer design" until the chapter moves to it, and
      pinned designs are never cleared away by new candidates
- [ ] Chapter locations picker, once locations exist (milestone 3)

## Milestone 2f: varied character designs

- [x] Design options are four different designs, not one prompt with four
      seeds: the AI sorts the look into traits the user's notes fix and
      free ones (including details only the AI draft added), then spreads
      the designs across the free traits; each option shows its label
- [x] Choosing an option makes its appearance and outfit the character's
- [x] "Keep" replaces "Lock" throughout the style page

## Milestone 2g: editable designs (v0.12.0)

- [x] The AI writes new design options whenever the character's look
      changes (notes, age, appearance or outfit, saved by the user or
      revised by the AI); the reference and pinned designs stay
- [x] Designs are written first and drawn on request: each option's label,
      appearance and outfit can be edited before it is drawn, and edited
      again to redraw just that one (same words: new seed); editing the
      reference adds a new option beside it
- [x] "What the designs vary" lists the free traits and their ranges, and
      what stays fixed
- [x] Save on the character page says it saved (or that there are unsaved
      changes) next to the button

## Next

- [ ] Characters on the versioned items layer: every profile generation kept
      (v0.13)

- [ ] Locations (milestone 3)
- [ ] AI critique of samples with a vision model (Gemma 4)
