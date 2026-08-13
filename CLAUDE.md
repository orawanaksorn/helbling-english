# Helbling Exercise Viewer

Offline exercise viewer for Helbling course content. Root files `index.html` +
`app.js` + `app.css` render courses stored under `data/<course-id>/` (each
course has `content.xml`, `navigation.xml`, and per-exercise `exercise.json` +
assets).

- Home (`#/`) reads `data/index.json` (`{ courses: [{id, name, description}] }`)
  to list courses.
- `#/course/<id>` reads `data/<id>/content.xml` for the unit/exercise TOC.
- `#/course/<id>/ex/<unit>/<exercise>` fetches
  `data/<id>/<unit>/<exercise>/exercise.json` and renders it via
  `renderExercise()` in `app.js`.
- Legacy route `#/ex/<unit>/<exercise>` still points at the old
  `options/level_1/...` content path (kept for backward compat, that data set
  has since been removed from the repo per git status).

## Exercise types currently rendered (`app.js`, `expandPartsHtml` switch)

Supported: `dropdown`, `gap`, `single-letter`, `freewrite`, `quiz`,
`single-choice`, `custom-image`, `audio-player`, `custom-group-item`.

Any `type` not in that switch renders as an empty `[missing-widget: ...]`
placeholder — no input, no scoring, no answer-key support.

## Known gap: `data/potential_a2_level2-SB` and `data/potential_a2_level2-WB`

Audited 2026-08-13. These two course folders (580 `exercise.json` files
total) are **not fully supported** by the current viewer:

1. **`data/index.json` is missing entirely.** The home course picker
   (`renderCoursePicker`) fails to load, so these courses are unreachable
   from the UI (only reachable via a hand-typed `#/course/<id>` hash).
2. **11 exercise types used in the data have no renderer**, so 267 fields
   across 192/580 files (144 in SB, 48 in WB) render blank:

   | type | count | notes |
   |---|---|---|
   | `gap` | 2139 | supported |
   | `dropdown` | 525 | supported |
   | `quiz` | 311 | supported |
   | `custom-image` | 180 | supported |
   | `audio-player` | 164 | supported |
   | `single-letter` | 52 | supported |
   | `freewrite` | 27 | supported |
   | `single-choice` | 28 | supported |
   | **`custom-table`** | 65 | **unsupported** — table wrapper; cells already contain supported `gap`/`dropdown` tags, needs a `<table>` render + recurse into `expandPartsHtml` per cell |
   | **`multiple-choice`** | 32 | **unsupported** — different schema from `single-choice` (checkbox, multi-answer `correctAnswers[]`, not radio/`correctAnswer`) |
   | **`sentence-order`** | 45 | **unsupported** — reorder UI |
   | **`picture-gap`** | 47 | **unsupported** — coordinate overlay on image |
   | **`picture-click`** | 15 | **unsupported** — coordinate overlay on image |
   | **`picture-drag`** | 4 | **unsupported** — coordinate overlay on image |
   | **`grid-item`** | 7 | **unsupported** — coordinate overlay on image |
   | **`video-player`** | 30 | **unsupported** — same shape as `audio-player`, cheap to add |
   | **`jumbled-dialogue`** | 6 | **unsupported** — reorder UI |
   | **`list-assign`** | 6 | **unsupported** — assign-to-category UI |
   | **`select-text`** | 10 | **unsupported** — click-to-select-words in text |

   Example file exercising several unsupported types at once:
   `data/potential_a2_level2-SB/unit_1/p11_ex2abc/exercise.json`
   (`custom-table`, `multiple-choice`).

## Phased plan to close the gap

- **Phase 0 — DONE.** Created `data/index.json` so the two courses are
  reachable from the home picker.
- **Phase 1 — DONE.** Added renderers + full scoring/answer-key/lock
  wiring for `custom-table`, `video-player`, `multiple-choice`,
  `sentence-order`. See "Phase 1 implementation notes" below.
- **Phase 2 — DONE.** Image-overlay group: `picture-gap`, `picture-click`,
  `picture-drag`, `grid-item`. See "Phase 2 implementation notes" below.
- **Phase 3 — DONE.** `jumbled-dialogue`, `list-assign`, `select-text`.
  See "Phase 3 implementation notes" below.
- **All 11 originally-unsupported types are now implemented.** Confirmed
  by a full-corpus sweep (see Phase 3 notes) that checked for both
  `[missing-widget]` placeholders AND any raw/unprocessed custom tag
  (`<custom-table>`, `<multiple-choice>`, `<video-player>`,
  `<picture-gap>`, `<grid-item>`, `<picture-drag>`, `<sentence-order>`,
  `<jumbled-dialogue>`, `<select-text>`, `<list-assign>`,
  `<picture-click>`) still surviving in the rendered DOM across all 580
  exercise files in both courses — zero of either.
- **Phase 4** — runs alongside every phase above, not after: for each new
  type wire up `evaluateExercise()` (check/mark), `applyAnswersFromKey()`
  (answer-key mode), and `resetExerciseForm()`/`applyPracticeLock()`, then
  verify against a real sample file for that type. Phase 1 followed this
  and each of its 4 types got full check/answer-key/lock/reset support.

## Phase 1 implementation notes (for resuming Phase 2/3)

- New render functions live in `app.js` next to the existing ones:
  `renderMultipleChoice`, `renderCustomTable`, `renderVideoPlayer`,
  `renderSentenceOrder` (+ `parseSentenceOrderTokens` helper). Wired into
  the `expandPartsHtml` switch and into `replaceStandaloneTags(...)` list
  right below it.
- `multiple-choice` differs from `single-choice`: it's genuinely
  multi-answer (checkboxes, `correctAnswers[]` matched by text against
  `additionalAnswers[]`, no per-option `correct` flag in the source data
  — computed once at render time and baked into `data-correct="0|1"` on
  each checkbox). Scoring/reset/lock/answer-key all branch on
  `[data-field-kind="multiple-choice"]` in `evaluateExercise`,
  `resetExerciseForm`, `applyPracticeLock`, `applyAnswersFromKey`,
  `countScorableItems`, `userHasStartedExercise`, `allScorableAnswered`.
- `custom-table` is a thin wrapper: renders a `<table>` and recurses
  each cell's HTML back through `expandPartsHtml` (cells already contain
  ordinary `<gap>`/`<dropdown>` tags) — no new scoring logic needed, it
  rides on whatever field types are embedded in the cells.
- `video-player` embeds Wistia via
  `https://fast.wistia.net/embed/iframe/<wistiaId>` in an iframe
  (16:9 aspect wrapper, `.hl-video-aspect`). **Note:** every sample in
  this data set is a Wistia-hosted video (`wistiaId` field, no local
  file) — this needs network access, unlike the rest of the app which
  works from local files only. Confirmed no local-file variant exists in
  either course's data.
- `sentence-order`: `cfg.sentence` is a string like
  `"<b>1</b>{s}| this |song| was| written| by| my| sister|."` — split on
  `{s}` to get the numbering prefix, then split the remainder on `|` and
  trim/strip-HTML each piece (dropping empties) to get the tokens in
  **correct order**. There is no separate shuffled-order field in the
  source data — shuffling happens client-side at render time
  (`shuffleInPlace` on the token indices), while each token button keeps
  its original-order index in `data-orig-idx` so scoring/answer-key can
  always recover the correct order. UI is click-to-move (not native drag)
  between a `.so-bank` pool and a `.so-answer` build area — click a bank
  token to append it to the answer, click an answer token to send it back
  to the bank. Scoring joins the answer area's current children with a
  space and compares against `data-expected` (also space-joined) via the
  same `normGap`/ignoreCase helper `gap` uses.
- All four were verified functionally (not just visually) via a small
  jsdom-based driver script run against a local `python -m http.server`
  instance, since no browser automation tool (chromium-cli / playwright)
  was available in this environment: it exercises real render → user
  interaction (checkbox clicks, token clicks) → the real `#btn-action`
  Check button → mark classes, plus the Answers-mode toggle. Confirmed:
  home picker lists both courses; `custom-table` + `multiple-choice`
  render and score right/wrong correctly; `video-player` emits the
  correct Wistia iframe URL; `sentence-order` scores a correctly-ordered
  row as OK and a reversed row as wrong, and Answers-mode correctly
  reorders tokens into the right sequence. Also spot-checked an ordinary
  pre-existing `gap` exercise afterward to confirm no regression.
- No actual browser screenshot was taken (no chromium-cli/playwright
  available in this sandbox) — if that tooling becomes available later,
  a real visual pass (especially on `.so-token` layout, `.hl-custom-table`
  borders, and the Wistia iframe embed) is still worth doing.

## Phase 2 implementation notes (for resuming Phase 3)

- New render functions in `app.js`: `renderPictureClick`,
  `renderPictureGap`, `renderPictureDrag`, `renderGridItem`. Wired into
  the `expandPartsHtml` switch and `replaceStandaloneTags(...)` list,
  same as Phase 1.
- `picture-gap` and `picture-drag` both render an image in a
  `position:relative` box sized to the data's own pixel `width` (not
  responsive — `overflow-x:auto` handles narrow screens instead of
  scaling, because the `(x, y)` overlay coordinates are only valid at
  that exact pixel width). `picture-gap` positions the *existing*
  `renderGapInput()` output absolutely at each `items[].{x,y}` —
  confirmed via the jsdom driver that this needed **zero** new
  scoring/reset/lock/answer-key code: the resulting `<input
  data-kind="gap">` is picked up automatically everywhere the ordinary
  `gap` type already is. `picture-drag` renders plain positioned caption
  `<span>`s (`.hl-pic-label`) — genuinely non-interactive, confirmed
  static-labels-only in all 4 real samples in this data set.
- `picture-click`: `pictureList[]` of images with a `.correct` flag +
  `multipleAnswers` boolean. Renders as a grid of image tiles with a
  radio (single-select) or checkbox (multi-select) baked with
  `data-correct="0|1"` at render time — deliberately mirrors the
  `multiple-choice` pattern from Phase 1 (evaluate: every input's
  `checked` must equal its `data-correct`). Wired into
  `evaluateExercise`, `resetExerciseForm`, `applyPracticeLock`,
  `applyAnswersFromKey`, `countScorableItems`, `userHasStartedExercise`,
  `allScorableAnswered` — same 7 spots as `multiple-choice` needed.
- `grid-item` is the exact same "recurse into cell HTML via
  `expandPartsHtml`" pattern as `custom-table` (Phase 1), just laid out
  as a flex row of cells (`cellWidth`) instead of an HTML `<table>` —
  no new scoring code, rides on whatever field types are embedded in
  each cell.
- Verified via the same jsdom-driven approach as Phase 1 (real render →
  real DOM interaction → real `#btn-action` click → check mark classes):
  `picture-gap` scores right/wrong per-field correctly; `picture-click`
  scores right/wrong correctly (both the correct-pick and wrong-pick
  paths); `picture-drag` renders 8/8 static labels as expected;
  `grid-item` renders all 3 columns with their embedded `gap` fields
  intact and scorable.
- **Full-corpus regression sweep**: booted all 580 `exercise.json` files
  from both courses (SB + WB) through the real app route
  (`#/course/<id>/ex/<unit>/<exercise>`) via jsdom + a local
  `python -m http.server`. Result: 0 thrown errors, 0 `[missing-widget]`
  placeholders across the whole corpus. This confirms Phase 1 + Phase 2
  didn't regress anything and that every `custom-image`/`custom-table`/
  `multiple-choice`/`video-player`/`sentence-order`/`picture-gap`/
  `picture-click`/`picture-drag`/`grid-item` instance in the data
  renders without crashing. It does **not** prove Phase 3 types are
  handled (see the Phase 3 note above — they silently no-op instead of
  producing a `missing-widget` marker, so this sweep can't detect them).
- Also spot-checked an ordinary pre-existing `gap`+`dropdown` exercise
  again after these changes — still fine, no regression.

## Phase 3 implementation notes

- `jumbled-dialogue` (`renderJumbledDialogue` in `app.js`) turned out to
  need **zero new scoring/reset/lock/answer-key code**: `cfg.sentences[]`
  is stored in the JSON already in **correct order** (this mirrors
  `sentence-order`'s `{s}|...` format — the shuffling is a client-side
  render-time step, not present in the source data). Each sentence's
  leading bold letter (`<b>c</b>`, `<b>b</b>`, ...) is just a print-book
  answer-key label, not the sort key — do NOT sort by it. Items with
  `fixed: true` (seen only at index 0 in this data, e.g. the opening line
  of a conversation) are pinned and shown as a static intro line, outside
  the reorder puzzle. The render function reuses the exact same DOM shape
  and `data-field-kind="sentence-order"` as Phase 1's `sentence-order`,
  so every one of `evaluateExercise`/`resetExerciseForm`/
  `applyPracticeLock`/`applyAnswersFromKey`/the click-delegation handler
  works unmodified — confirmed via the jsdom driver (fixed line shown
  correctly, 6 movable tokens, scores "ok" when reassembled in order).
- `list-assign` (`renderListAssign`): `cfg.lists[]` gives categories
  (`name` = category label, `words` = pipe-separated words belonging to
  it — this **is** the answer key, there's no separate "user's pool"
  field). Rendered as one `<select>` per word (all words flattened and
  shuffled together) with the category names as options — a deliberate
  simplification of "sort into buckets" into "classify via dropdown",
  chosen because it's far more reliable to score and works on
  touch/mobile without native drag-and-drop. New CSS-only correctness
  classes `.la-row.la-ok` / `.la-row.la-wrong` (not the shared
  `.hl-mark-ok/wrong` classes, since `.la-row` isn't itself a
  `.hl-field-wrap`). Wired into the same 7 touch-points as
  `multiple-choice`/`picture-click` in Phase 1/2. Verified: all-correct
  → every row `la-ok`; deliberately-wrong picks → `la-wrong` (and a
  cleared row shows neither class).
- `select-text` (`renderSelectText`): `cfg.text` uses the same
  `|target|` pipe-delimiting convention as `sentence-order`, but here
  pipes mark which words *within running prose* are the correct
  clickable answer (e.g., "find the schwa-sound words"). Implementation
  tokenizes the **entire** sentence on whitespace (not just the piped
  segments) so every word — correct or not — becomes an independently
  clickable `.st-word` span with `data-correct="0|1"` baked in;
  surrounding whitespace is preserved as literal text between spans so
  wrapping looks natural. Click toggles `.is-selected`; **all** words in
  the row must match their `data-correct` flag for the row to score
  "ok" (same all-or-nothing evaluation shape as `multiple-choice`).
  Deliberately ignored `cfg.singleWords[]`/`cfg.colorPalette` — they're
  exercise-editor authoring metadata (position-in-text + highlight
  color for the editor UI), redundant with what's derivable directly
  from `cfg.text`'s pipes. Keyboard activation (Enter/Space on
  `tabindex="0"` spans) was **not** wired up — click-only for now; low
  priority since none of the other custom widgets in this app have
  keyboard support either.
- **Full-corpus regression sweep (final)**: same jsdom + local
  `python -m http.server` approach as Phase 1/2, extended to also grep
  the rendered HTML of all 580 files for any raw/unprocessed tag name
  among all 11 originally-unsupported types (not just the generic
  `[missing-widget]` marker, which the Phase 3 tag names wouldn't have
  triggered before this work — see the note in the Phase 3 planning
  section above about why the earlier "0 problems" sweep was
  incomplete). Result: 0 throws, 0 `missing-widget`, 0 raw unhandled
  tags — confirms all 11 types are fully wired across the entire
  data set, not just the sample files spot-checked individually.
