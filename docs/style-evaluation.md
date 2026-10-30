# Style evaluation (milestone 1)

Can the local image models draw manga, and in the range of styles a user might
ask for? Tested 2026-10-30 on an M5 Ultra through ComfyUI, 1024×1024, seed 42.

## Black and white manga — Qwen-Image 2512 (Lightning, 4 steps)

Prompt prefix: _"Black and white manga illustration, clean ink line art,
screentone shading, high contrast, no color."_ followed by each sample subject.

![Qwen-Image black-and-white samples](images/style-eval-bw.jpg)

Clean inking, real screentone texture and speed lines. About **5 s per image**
once the model is loaded (13 s for the first).

## Range — Qwen-Image (top) and Z-Image Turbo (bottom)

Top row, Qwen-Image with five different style descriptions: shōjo watercolour,
gritty cross-hatched seinen, colour chibi, a black-and-red limited palette, and
painted greyscale. Bottom row, Z-Image Turbo with the black-and-white prompt.

![Style range](images/style-eval-range.jpg)

- **Qwen-Image** follows the style description closely; every look came out
  distinct. It is the default.
- **Z-Image Turbo** (~7 s) gives a flatter, cleaner printed-page look, but
  ignored "No people" in the interior and drew pseudo-Japanese text on a sign.
  Offered as an option per style. It is distilled, so it ignores negative
  prompts.

## Findings that shaped the code

- **Genre words leak subjects.** A "detective seinen" style put a man in a
  trench coat into the empty-street sample even with "No people." in the
  prompt. Fixes: the style fragment now ends with a full stop so the subject
  starts a new sentence, location subjects say "empty", and they add
  `people, person, human figure` to the negative prompt. That held in 5 of 6
  seeds tried; the remaining failure used a different wording that is not used.
- **Same seeds across versions** make revisions comparable: the draft's samples
  sit under the approved version's, and differences come from the prompt.

![Comparing a revision with the version in use](images/style-revision.jpg)

- **Ollama structured output** (`format`) is unavailable for the MLX models
  (Ollama 0.34.3). Both Qwen 3.8 27B and Gemma 4 26B return clean JSON when
  asked in the prompt (2–3 s), so the text adapter extracts and validates the
  JSON (zod) and retries once with the error.

## Open

- Identity consistency across panels with Qwen-Image-Edit (milestone 2,
  characters).
- Whether a manga-specific LoRA improves screentone fidelity.
