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

## Next

- [ ] Projects: create a comic, pick an approved style and reading direction
- [ ] Characters (milestone 2): interview, visual spec, reference sheets per style
- [ ] AI critique of samples with a vision model (Gemma 4)
