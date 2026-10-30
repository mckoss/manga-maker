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

- [ ] Asset store (content-addressed files under `data/assets`)
- [ ] Job queue + worker + progress over SSE
- [ ] `TextModel` (Ollama) and `ImageModel` (ComfyUI) adapters, with fakes
- [ ] Style library: create a style from a description (LLM drafts the spec)
- [ ] Refine prompt → generate a sample set → compare → approve
- [ ] Versioned styles: approving a new version replaces the active one
- [ ] Manga style evaluation notes (B&W line art, screentones, colour modes)
