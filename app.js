/**
 * Helbling Options — offline exercise viewer.
 * Deploy on Cloudflare Pages: serve at site root (/)
 */

const CONTENT_XML_RELATIVE_PATH =
  "options/level_1/options_1-options_1_2023_cyber_homework/content.xml";

function getCandidateContentXmlPaths() {
  // Support both hosting layouts:
  // - Served at repo root: /options/.../content.xml
  // - If this app is moved under a subfolder, ../options... still works.
  return [
    CONTENT_XML_RELATIVE_PATH,
    `../${CONTENT_XML_RELATIVE_PATH}`,
    `../../${CONTENT_XML_RELATIVE_PATH}`,
  ];
}

const mainEl = document.getElementById("main");
const headerTitleEl = document.getElementById("header-title");
const footerEl = document.getElementById("app-footer");
const appRootEl = document.getElementById("app");
const toggleAnswersEl = /** @type {HTMLInputElement} */ (document.getElementById("toggle-answers"));
const btnActionEl = document.getElementById("btn-action");
const btnClose = document.getElementById("btn-close");

/** Practice vs answer-key; Correct vs Check; share one action button */
let exerciseUi = {
  /** Answer-key toggle (green = on) */
  answersMode: false,
  lockedAfterCheck: false,
  /** practice: 'check' | 'correct' — only when !answersMode */
  practiceAction: "check",
  /** answer-key: global reveal */
  revealAll: false,
  /** show Check after user edits */
  practiceDirty: false,
  /** per-field reveal when !revealAll in answer-key mode */
  keyRevealedItemIds: /** @type {Set<string>} */ (new Set()),
};

/** @type {{ courseBase: string, fetchPrefix?: string, units: { id: string, exercises: { id: string, maxPoints: string }[] }[] } | null} */
let courseIndex = null;

/** @type {{ exerciseDir: string, data: object, unitId: string, exerciseId: string, courseId?: string } | null} */
let currentSession = null;

/** @type {{ courses: { id: string, name: string, description?: string }[] } | null} */
let dataCatalog = null;

/** @type {{ [courseId: string]: { courseBase: string, fetchPrefix: string, units: { id: string, exercises: { id: string, maxPoints: string }[] }[] } }} */
const dataCourseIndexCache = {};

function courseBaseFromContentPath() {
  const i = CONTENT_XML_RELATIVE_PATH.lastIndexOf("/");
  return i >= 0 ? CONTENT_XML_RELATIVE_PATH.slice(0, i) : "";
}

function assetUrl(exerciseDir, nameOrUrl) {
  if (!nameOrUrl) return "";
  if (/^https?:\/\//i.test(nameOrUrl)) return nameOrUrl;
  const base = exerciseDir.endsWith("/") ? exerciseDir : `${exerciseDir}/`;
  return `${base}${encodeURI(nameOrUrl)}`;
}

function pickInstruction(obj) {
  if (!obj || typeof obj !== "object") return "";
  const en = obj.english;
  const de = obj.german;
  if (en && String(en).trim()) return en;
  if (de && String(de).trim()) return de;
  return "";
}

function stripHtml(s) {
  const d = document.createElement("div");
  d.innerHTML = s;
  return d.textContent || d.innerText || "";
}

function normInstructionHtml(html) {
  return stripHtml(String(html || ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatExerciseTitle(folderName) {
  return folderName.replaceAll("_", " ");
}

function normGap(s, ignoreCase) {
  let t = String(s ?? "").trim();
  if (ignoreCase) t = t.toLowerCase();
  return t;
}

function gapMatches(value, cfg, ignoreCase) {
  const v = normGap(value, ignoreCase);
  if (!v) return false;
  const primary = normGap(cfg.correctAnswer, ignoreCase);
  if (v === primary) return true;
  const alts = cfg.additionalAnswers || [];
  for (const a of alts) {
    const ans = typeof a === "string" ? a : a.answer;
    if (normGap(ans, ignoreCase) === v) return true;
  }
  return false;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseContentXml(xmlText, overrideCourseBase) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("Invalid content.xml");

  const units = [];
  for (const unitCol of doc.querySelectorAll("CourseContent > collection")) {
    const unitId = unitCol.getAttribute("name");
    if (!unitId) continue;
    const exercises = [];
    for (const inner of unitCol.querySelectorAll(":scope > collection")) {
      const exEl = inner.querySelector(":scope > exercise");
      if (!exEl) continue;
      const name = exEl.getAttribute("name");
      const max = exEl.getAttribute("maxPoints") || "";
      if (name) exercises.push({ id: name, maxPoints: max });
    }
    units.push({ id: unitId, exercises });
  }
  return { courseBase: overrideCourseBase || courseBaseFromContentPath(), units };
}

function computeFetchPrefix(loadedContentPath) {
  if (!loadedContentPath) return "";
  if (!loadedContentPath.endsWith(CONTENT_XML_RELATIVE_PATH)) return "";
  return loadedContentPath.slice(0, loadedContentPath.length - CONTENT_XML_RELATIVE_PATH.length);
}

async function loadCourseIndex() {
  let res = null;
  let usedPath = "";
  for (const p of getCandidateContentXmlPaths()) {
    // eslint-disable-next-line no-await-in-loop
    const r = await fetch(p);
    if (r.ok) {
      res = r;
      usedPath = p;
      break;
    }
  }
  if (!res) {
    const tried = getCandidateContentXmlPaths().join(", ");
    throw new Error(`Cannot load content.xml (tried: ${tried})`);
  }
  const text = await res.text();
  courseIndex = parseContentXml(text);
  courseIndex.courseBase = courseBaseFromContentPath();
  courseIndex.fetchPrefix = computeFetchPrefix(usedPath);
}

function exerciseDirHref(unitId, exerciseId) {
  return `#/ex/${encodeURIComponent(unitId)}/${encodeURIComponent(exerciseId)}`;
}

function parseHashRoute() {
  const h = (location.hash || "").replace(/^#/, "");
  const mDataEx = /^\/course\/([^/]+)\/ex\/([^/]+)\/([^/]+)\/?$/.exec(h);
  if (mDataEx)
    return {
      type: "data-exercise",
      courseId: decodeURIComponent(mDataEx[1]),
      unitId: decodeURIComponent(mDataEx[2]),
      exerciseId: decodeURIComponent(mDataEx[3]),
    };
  const mDataToc = /^\/course\/([^/]+)\/?$/.exec(h);
  if (mDataToc) return { type: "data-toc", courseId: decodeURIComponent(mDataToc[1]) };
  const mLegacy = /^\/ex\/([^/]+)\/([^/]+)\/?$/.exec(h);
  if (mLegacy)
    return { type: "legacy-exercise", unitId: decodeURIComponent(mLegacy[1]), exerciseId: decodeURIComponent(mLegacy[2]) };
  return { type: "home" };
}

function exerciseJsonPath(unitId, exerciseId) {
  const base = courseIndex?.courseBase || courseBaseFromContentPath();
  const prefix = courseIndex?.fetchPrefix || "";
  return `${prefix}${base}/${unitId}/${exerciseId}/exercise.json`;
}

function exerciseAssetDir(unitId, exerciseId) {
  const base = courseIndex?.courseBase || courseBaseFromContentPath();
  const prefix = courseIndex?.fetchPrefix || "";
  return `${prefix}${base}/${unitId}/${exerciseId}`;
}

async function loadDataCatalog() {
  if (dataCatalog) return;
  const res = await fetch("data/index.json");
  if (!res.ok) throw new Error("Cannot load data/index.json");
  dataCatalog = await res.json();
}

async function ensureDataCourseIndex(courseId) {
  if (dataCourseIndexCache[courseId]) return dataCourseIndexCache[courseId];
  const path = `data/${courseId}/content.xml`;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Cannot load ${path} (${res.status})`);
  const text = await res.text();
  const idx = parseContentXml(text, `data/${courseId}`);
  idx.fetchPrefix = "";
  dataCourseIndexCache[courseId] = idx;
  return idx;
}

function dataExerciseHref(courseId, unitId, exerciseId) {
  return `#/course/${encodeURIComponent(courseId)}/ex/${encodeURIComponent(unitId)}/${encodeURIComponent(exerciseId)}`;
}

async function renderCoursePicker() {
  headerTitleEl.textContent = "Helbling — Select a course";
  footerEl.hidden = true;
  currentSession = null;
  try {
    await loadDataCatalog();
  } catch (e) {
    mainEl.innerHTML = `<p class="empty-toc">Cannot load course list: ${escapeHtml(e.message)}</p>`;
    return;
  }
  const courses = dataCatalog?.courses || [];
  if (!courses.length) {
    mainEl.innerHTML = `<p class="empty-toc">No courses found.</p>`;
    return;
  }
  const cards = courses
    .map(
      (c) => `<a class="course-card" href="#/course/${encodeURIComponent(c.id)}">
        <span class="course-card-name">${escapeHtml(c.name || c.id)}</span>
        ${c.description ? `<span class="course-card-meta">${escapeHtml(c.description)}</span>` : ""}
      </a>`
    )
    .join("");
  mainEl.innerHTML = `<div class="course-picker"><h2 class="toc-title">Select a course</h2><div class="course-grid">${cards}</div></div>`;
}

async function renderDataCourseToc(courseId) {
  footerEl.hidden = true;
  currentSession = null;
  let idx;
  try {
    await loadDataCatalog().catch(() => {});
    idx = await ensureDataCourseIndex(courseId);
  } catch (e) {
    headerTitleEl.textContent = "Error";
    mainEl.innerHTML = `<p class="empty-toc">${escapeHtml(e.message)}</p>`;
    return;
  }
  const catalogEntry = dataCatalog?.courses?.find((c) => c.id === courseId);
  const displayName = catalogEntry?.name || formatExerciseTitle(courseId);
  headerTitleEl.textContent = displayName;
  const parts = [
    `<a class="toc-back-link" href="#/">&#8592; All courses</a>`,
    `<h2 class="toc-title">${escapeHtml(displayName)}</h2>`,
  ];
  for (const u of idx.units) {
    const lis = u.exercises
      .map(
        (e) =>
          `<li><a href="${dataExerciseHref(courseId, u.id, e.id)}">${formatExerciseTitle(e.id)} <span class="toc-points">(${e.maxPoints} pts)</span></a></li>`
      )
      .join("");
    parts.push(
      `<details class="toc-unit" open><summary>${formatExerciseTitle(u.id)}</summary><ul class="toc-ex-list">${lis}</ul></details>`
    );
  }
  mainEl.innerHTML = parts.join("");
}

async function openDataExercise(courseId, unitId, exerciseId) {
  let idx;
  try {
    idx = await ensureDataCourseIndex(courseId);
  } catch (e) {
    mainEl.innerHTML = `<p class="empty-toc">${escapeHtml(e.message)}</p>`;
    footerEl.hidden = true;
    return;
  }
  const path = `${idx.courseBase}/${unitId}/${exerciseId}/exercise.json`;
  const res = await fetch(path);
  if (!res.ok) {
    mainEl.innerHTML = `<p>Cannot load exercise: <code>${escapeHtml(path)}</code> (${res.status})</p>`;
    footerEl.hidden = true;
    return;
  }
  const data = await res.json();
  const dir = `${idx.courseBase}/${unitId}/${exerciseId}`;
  currentSession = { exerciseDir: dir, data, unitId, exerciseId, courseId };
  renderExercise(data, dir, formatExerciseTitle(exerciseId));
}

function renderToc() {
  headerTitleEl.textContent = "Helbling Options — Contents";
  footerEl.hidden = true;
  if (!courseIndex) {
    mainEl.innerHTML = `<p class="empty-toc">No course loaded.</p>`;
    return;
  }
  const parts = [`<h2 class="toc-title">Table of contents</h2>`];
  for (const u of courseIndex.units) {
    const lis = u.exercises
      .map(
        (e) =>
          `<li><a href="${exerciseDirHref(u.id, e.id)}">${formatExerciseTitle(e.id)} <span class="toc-points">(${e.maxPoints} pts)</span></a></li>`
      )
      .join("");
    parts.push(
      `<details class="toc-unit" open><summary>${formatExerciseTitle(u.id)}</summary><ul class="toc-ex-list">${lis}</ul></details>`
    );
  }
  mainEl.innerHTML = parts.join("");
}

function mergeConfigMaps(sequence, readingConfigs) {
  const map = new Map();
  const add = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const c of arr) {
      if (c && c.id) map.set(c.id, c);
    }
  };
  add(readingConfigs);
  if (sequence.staticConfigs) add(sequence.staticConfigs);
  if (sequence.configs) add(sequence.configs);
  return map;
}

function gapGlobalOpts(sequence) {
  const g = (sequence.globalTypesConfigs || []).find((x) => x && x.type === "gap");
  return {
    ignoreCase: !!(g && g.ignoreCaseSensitivity),
    widthMode: g && g.widthMode,
  };
}

function dropdownGlobalOpts(sequence) {
  const g = (sequence.globalTypesConfigs || []).find((x) => x && x.type === "dropdown");
  return { shuffle: !!(g && g.shuffle) };
}

function multipleChoiceGlobalOpts(sequence) {
  const g = (sequence.globalTypesConfigs || []).find((x) => x && x.type === "multiple-choice");
  return { shuffle: !!(g && g.shuffle) };
}

function gapWidthPx(cfg, globalWidthMode, allGapCfgs) {
  if (cfg.width != null && cfg.width > 0) return `${cfg.width}px`;
  if (globalWidthMode === "asLongestWord" && allGapCfgs && allGapCfgs.length) {
    let maxLen = 0;
    for (const g of allGapCfgs) {
      const pieces = [
        g.correctAnswer,
        ...(g.additionalAnswers || []).map((a) => (typeof a === "string" ? a : a.answer)),
      ];
      for (const p of pieces) {
        const L = stripHtml(String(p || "")).length;
        if (L > maxLen) maxLen = L;
      }
    }
    const ch = Math.max(maxLen, 4);
    return `${Math.min(ch * 0.65 + 2, 18)}rem`;
  }
  return "8rem";
}

function hlSvgEye() {
  return `<svg class="hl-svg-eye" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
}

function hlSvgEyeOff() {
  return `<svg class="hl-svg-eye-off" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;
}

function renderGapInput(cfg, globalGap, allGapsInScope) {
  const w = gapWidthPx(cfg, globalGap.widthMode, allGapsInScope);
  const size = stripHtml(String(cfg.correctAnswer || "")).length || 4;
  const expected = stripHtml(String(cfg.correctAnswer ?? ""));
  const id = escapeAttr(cfg.id);
  return `<span class="hl-field-wrap hl-field-inline" data-field-kind="gap" data-id="${id}" data-expected="${escapeAttr(expected)}">
  <span class="hl-field-badge" aria-hidden="true"></span>
  <span class="hl-key-shell">
    <span class="hl-real-control"><input type="text" class="gap-input" data-kind="gap" data-id="${id}" style="width:${w};max-width:100%" size="${Math.min(size + 2, 40)}" autocomplete="off" spellcheck="false" /></span>
    <span class="hl-key-facade" hidden>
      <span class="hl-key-facade-row">
        <span class="hl-key-answer-text">${escapeHtml(expected)}</span>
        <button type="button" class="hl-key-icon" data-key-toggle="${id}" aria-label="Hide answer"></button>
      </span>
    </span>
  </span>
</span>`;
}

function renderDropdown(cfg, shuffle) {
  const opts = [];
  const correct = cfg.additionalAnswers.find((a) => a.correct);
  const wrong = cfg.additionalAnswers.filter((a) => !a.correct);
  const ordered = [];
  if (correct) ordered.push({ label: correct.answer, value: correct.answer, correct: true });
  for (const w of wrong) ordered.push({ label: w.answer, value: w.answer, correct: false });
  let list = ordered.slice();
  if (shuffle) list = shuffleInPlace(list);
  opts.push(`<option value="">—</option>`);
  for (const o of list) {
    opts.push(
      `<option value="${escapeAttr(o.value)}" data-correct="${o.correct ? "1" : "0"}">${escapeHtml(o.label)}</option>`
    );
  }
  const id = escapeAttr(cfg.id);
  const expected = correct ? stripHtml(String(correct.answer)) : "";
  return `<span class="hl-field-wrap hl-field-inline hl-dropdown-field" data-field-kind="dropdown" data-id="${id}" data-expected="${escapeAttr(expected)}">
  <span class="hl-field-badge" aria-hidden="true"></span>
  <span class="hl-key-shell hl-key-shell-dropdown">
    <span class="hl-real-control"><select class="hl-dropdown" data-kind="dropdown" data-id="${id}" autocomplete="off">${opts.join("")}</select></span>
    <span class="hl-key-facade" hidden>
      <span class="hl-key-facade-row">
        <span class="hl-key-answer-text">${escapeHtml(expected)}</span>
        <button type="button" class="hl-key-icon" data-key-toggle="${id}" aria-label="Hide answer"></button>
      </span>
    </span>
  </span>
</span>`;
}

function renderSingleLetter(cfg) {
  const len = Math.max(String(cfg.correctAnswer || "").length, 1);
  const id = escapeAttr(cfg.id);
  const expected = stripHtml(String(cfg.correctAnswer ?? ""));
  return `<span class="hl-field-wrap hl-field-inline" data-field-kind="single-letter" data-id="${id}" data-expected="${escapeAttr(expected)}">
  <span class="hl-field-badge" aria-hidden="true"></span>
  <span class="hl-key-shell">
    <span class="hl-real-control"><input type="text" class="single-letter-input" data-kind="single-letter" data-id="${id}" maxlength="${len}" size="${len + 1}" autocomplete="off" spellcheck="false" /></span>
    <span class="hl-key-facade" hidden>
      <span class="hl-key-facade-row">
        <span class="hl-key-answer-text">${escapeHtml(expected)}</span>
        <button type="button" class="hl-key-icon" data-key-toggle="${id}" aria-label="Hide answer"></button>
      </span>
    </span>
  </span>
</span>`;
}

function renderQuizOrChoice(cfg, kind) {
  const qid = cfg.id;
  const opts = [];
  const answers = cfg.additionalAnswers || [];
  const effectiveOrientation =
    cfg.orientation === "horizontal" || answers.length <= 3 ? "row" : "column";
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    const label = typeof a === "string" ? a : a.answer;
    const display = stripHtml(label);
    opts.push(
      `<label class="radio-opt"><input type="radio" name="${escapeAttr(qid)}" data-kind="${kind}" data-id="${escapeAttr(qid)}" data-idx="${i}" value="${escapeAttr(display)}" /> <span class="radio-label">${escapeHtml(display)}</span></label>`
    );
  }
  return `<div class="hl-field-wrap ${kind === "quiz" ? "quiz-row" : "sc-row"}" data-field-kind="${kind}" data-id="${escapeAttr(qid)}" data-question-id="${escapeAttr(qid)}">
  <span class="hl-field-badge row-badge" aria-hidden="true"></span>
  <div class="${kind === "quiz" ? "quiz-q" : "sc-q"}">${cfg.question || ""}</div>
  <div class="${kind === "quiz" ? "quiz-options" : "sc-options"}" data-orient="${effectiveOrientation}" style="display:flex;flex-direction:${effectiveOrientation};flex-wrap:wrap;gap:0.35rem 1rem">${opts.join("")}</div>
</div>`;
}

function renderMultipleChoice(cfg, shuffle) {
  const qid = cfg.id;
  const correctSet = new Set(
    (cfg.correctAnswers || []).map((a) =>
      stripHtml(String(typeof a === "string" ? a : a.answer || "")).trim().toLowerCase()
    )
  );
  let opts = (cfg.additionalAnswers || []).map((a) => {
    const label = typeof a === "string" ? a : a.answer;
    const display = stripHtml(String(label || ""));
    return { label: display, correct: correctSet.has(display.trim().toLowerCase()) };
  });
  if (shuffle) opts = shuffleInPlace(opts.slice());
  const optsHtml = opts
    .map(
      (o, i) =>
        `<label class="checkbox-opt"><input type="checkbox" name="${escapeAttr(qid)}" data-kind="multiple-choice" data-id="${escapeAttr(qid)}" data-idx="${i}" value="${escapeAttr(o.label)}" data-correct="${o.correct ? "1" : "0"}" /> <span class="checkbox-label">${escapeHtml(o.label)}</span></label>`
    )
    .join("");
  return `<div class="hl-field-wrap mc-row" data-field-kind="multiple-choice" data-id="${escapeAttr(qid)}" data-question-id="${escapeAttr(qid)}">
  <span class="hl-field-badge row-badge" aria-hidden="true"></span>
  <div class="mc-q">${cfg.question || ""}</div>
  <div class="mc-options" style="display:flex;flex-direction:column;gap:0.35rem 1rem">${optsHtml}</div>
</div>`;
}

function renderCustomTable(cfg, exerciseDir, seq, readingCfgMap) {
  const rows = cfg.table || [];
  const widths = cfg.cellWidths || [];
  const border = cfg.border || "";
  const cellStyle = border ? ` style="border:${escapeAttr(border)}"` : "";
  const trs = rows
    .map((row) => {
      const tds = (row || [])
        .map((cellHtml, i) => {
          const w = widths[i] ? `width:${widths[i]}px;` : "";
          const inner = expandPartsHtml(String(cellHtml || ""), exerciseDir, seq, readingCfgMap);
          return `<td class="hl-custom-table-cell" style="${w}${border ? `border:${escapeAttr(border)};` : ""}">${inner}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<table class="hl-custom-table"${cellStyle}><tbody>${trs}</tbody></table>`;
}

function renderVideoPlayer(cfg) {
  const wistiaId = cfg.wistiaId;
  if (!wistiaId) return "";
  const w = cfg.width && cfg.width > 0 ? cfg.width : 640;
  return `<div class="hl-video-player" style="max-width:${w}px;width:100%">
  <div class="hl-video-aspect">
    <iframe src="https://fast.wistia.net/embed/iframe/${escapeAttr(wistiaId)}" title="video" allow="autoplay; fullscreen" allowfullscreen frameborder="0"></iframe>
  </div>
</div>`;
}

function parseSentenceOrderTokens(raw) {
  const str = String(raw || "");
  const idx = str.indexOf("{s}");
  const prefix = idx >= 0 ? str.slice(0, idx) : "";
  const rest = idx >= 0 ? str.slice(idx + 3) : str;
  const tokens = rest
    .split("|")
    .map((t) => stripHtml(t).trim())
    .filter((t) => t.length > 0);
  return { prefix, tokens };
}

function renderSentenceOrder(cfg) {
  const { prefix, tokens } = parseSentenceOrderTokens(cfg.sentence);
  const id = escapeAttr(cfg.id);
  const shuffled = shuffleInPlace(tokens.map((_, i) => i));
  const bankItems = shuffled
    .map(
      (origIdx) =>
        `<button type="button" class="so-token" data-orig-idx="${origIdx}">${escapeHtml(tokens[origIdx])}</button>`
    )
    .join("");
  const expected = tokens.join(" ");
  return `<div class="hl-field-wrap so-row" data-field-kind="sentence-order" data-id="${id}" data-expected="${escapeAttr(expected)}" data-token-count="${tokens.length}">
  <span class="hl-field-badge row-badge" aria-hidden="true"></span>
  ${prefix ? `<div class="so-prefix">${prefix}</div>` : ""}
  <div class="so-answer" data-so-answer></div>
  <div class="so-bank" data-so-bank>${bankItems}</div>
</div>`;
}

function renderPictureClick(cfg, exerciseDir) {
  const qid = cfg.id;
  const multi = !!cfg.multipleAnswers;
  const w = cfg.imageWidth && cfg.imageWidth > 0 ? cfg.imageWidth : 200;
  const pics = cfg.pictureList || [];
  const inputType = multi ? "checkbox" : "radio";
  const tiles = pics
    .map((p, i) => {
      const src = p.url && p.url.trim() ? p.url : assetUrl(exerciseDir, p.name);
      return `<label class="pic-click-opt" style="width:${w}px">
  <img src="${escapeAttr(src)}" alt="" loading="lazy" style="width:100%;height:auto" />
  <input type="${inputType}" name="${escapeAttr(qid)}" data-kind="picture-click" data-id="${escapeAttr(qid)}" data-idx="${i}" data-correct="${p.correct ? "1" : "0"}" />
</label>`;
    })
    .join("");
  return `<div class="hl-field-wrap pc-row" data-field-kind="picture-click" data-id="${escapeAttr(qid)}" data-question-id="${escapeAttr(qid)}">
  <span class="hl-field-badge row-badge" aria-hidden="true"></span>
  <div class="pc-options">${tiles}</div>
</div>`;
}

function renderPictureGap(cfg, seq, exerciseDir) {
  const src = cfg.url && cfg.url.trim() ? cfg.url : assetUrl(exerciseDir, cfg.name);
  const w = cfg.width && cfg.width > 0 ? cfg.width : 600;
  const byId = new Map();
  for (const c of seq.configs || []) if (c && c.id) byId.set(c.id, c);
  const gGap = gapGlobalOpts(seq);
  const allGaps = (seq.configs || []).filter((c) => c && c.type === "gap");
  const overlays = (cfg.items || [])
    .map((it) => {
      const gcfg = byId.get(it.gapId);
      if (!gcfg || gcfg.type !== "gap") return "";
      const inner = renderGapInput(gcfg, gGap, allGaps);
      return `<span class="hl-pic-overlay" style="left:${it.x}px;top:${it.y}px">${inner}</span>`;
    })
    .join("");
  return `<div class="hl-picture-gap" style="width:${w}px">
  <img class="hl-picture-gap-img" src="${escapeAttr(src)}" alt="" loading="lazy" />
  ${overlays}
</div>`;
}

function renderPictureDrag(cfg, exerciseDir) {
  const src = cfg.url && cfg.url.trim() ? cfg.url : assetUrl(exerciseDir, cfg.name);
  const w = cfg.width && cfg.width > 0 ? cfg.width : 600;
  const labels = (cfg.items || [])
    .map((it) => `<span class="hl-pic-label" style="left:${it.x}px;top:${it.y}px">${it.text || ""}</span>`)
    .join("");
  return `<div class="hl-picture-gap" style="width:${w}px">
  <img class="hl-picture-gap-img" src="${escapeAttr(src)}" alt="" loading="lazy" />
  ${labels}
</div>`;
}

function renderGridItem(cfg, exerciseDir, seq, readingCfgMap) {
  const cells = cfg.grid || [];
  const w = cfg.cellWidth && cfg.cellWidth > 0 ? cfg.cellWidth : 0;
  const align = cfg.verticalAlign === "center" || cfg.verticalAlign === "end" ? cfg.verticalAlign : "flex-start";
  const cellsHtml = cells
    .map((cellHtml) => {
      const inner = expandPartsHtml(String(cellHtml || ""), exerciseDir, seq, readingCfgMap);
      const style = w ? ` style="flex:0 0 ${w}px;width:${w}px"` : ` style="flex:1 1 0"`;
      return `<div class="hl-grid-item-cell"${style}>${inner}</div>`;
    })
    .join("");
  return `<div class="hl-grid-item" style="align-items:${align}">${cellsHtml}</div>`;
}

function unwrapOuterP(html) {
  const s = String(html || "").trim();
  const m = /^<p[^>]*>([\s\S]*)<\/p>$/i.exec(s);
  return m ? m[1] : s;
}

function renderJumbledDialogue(cfg) {
  const items = cfg.sentences || [];
  const id = escapeAttr(cfg.id);
  const fixedHtml = items
    .filter((it) => it && it.fixed)
    .map((it) => `<div class="so-prefix-line">${it.text || ""}</div>`)
    .join("");
  const movable = items
    .map((it, i) => ({ html: unwrapOuterP(it && it.text), origIdx: i }))
    .filter((_, i) => !(items[i] && items[i].fixed));
  const expected = movable.map((m) => stripHtml(m.html)).join(" ");
  const byIdx = new Map(movable.map((m) => [m.origIdx, m.html]));
  const shuffled = shuffleInPlace(movable.map((m) => m.origIdx));
  const bankItems = shuffled
    .map((origIdx) => `<button type="button" class="so-token" data-orig-idx="${origIdx}">${byIdx.get(origIdx)}</button>`)
    .join("");
  return `<div class="hl-field-wrap so-row" data-field-kind="sentence-order" data-id="${id}" data-expected="${escapeAttr(expected)}" data-token-count="${movable.length}">
  <span class="hl-field-badge row-badge" aria-hidden="true"></span>
  ${fixedHtml ? `<div class="so-prefix">${fixedHtml}</div>` : ""}
  <div class="so-answer" data-so-answer></div>
  <div class="so-bank" data-so-bank>${bankItems}</div>
</div>`;
}

function renderListAssign(cfg) {
  const lists = cfg.lists || [];
  const id = escapeAttr(cfg.id);
  const allWords = [];
  lists.forEach((l, li) => {
    String((l && l.words) || "")
      .split("|")
      .map((w) => w.trim())
      .filter(Boolean)
      .forEach((w) => allWords.push({ word: w, listIdx: li }));
  });
  const optionsHtml = lists
    .map((l, li) => `<option value="${li}">${escapeHtml(stripHtml((l && l.name) || ""))}</option>`)
    .join("");
  const order = shuffleInPlace(allWords.map((_, i) => i));
  const rows = order
    .map((i) => {
      const w = allWords[i];
      return `<div class="la-row">
  <span class="la-word">${escapeHtml(w.word)}</span>
  <select class="la-select" data-kind="list-assign" data-id="${id}" data-idx="${i}" data-correct-list="${w.listIdx}">
    <option value="">—</option>
    ${optionsHtml}
  </select>
</div>`;
    })
    .join("");
  return `<div class="hl-field-wrap la-block" data-field-kind="list-assign" data-id="${id}" data-question-id="${id}">
  <span class="hl-field-badge row-badge" aria-hidden="true"></span>
  <div class="la-rows">${rows}</div>
</div>`;
}

function parseSelectTextSegments(raw) {
  const parts = String(raw || "").split("|");
  return parts.map((seg, i) => ({ text: seg, correct: i % 2 === 1 }));
}

function renderSelectText(cfg) {
  const id = escapeAttr(cfg.id);
  const segments = parseSelectTextSegments(cfg.text);
  let html = "";
  for (const seg of segments) {
    const pieces = seg.text.split(/(\s+)/);
    for (const piece of pieces) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) {
        html += piece;
        continue;
      }
      html += `<span class="st-word" data-kind="select-text" data-id="${id}" data-correct="${seg.correct ? "1" : "0"}" tabindex="0" role="button">${escapeHtml(piece)}</span>`;
    }
  }
  return `<div class="hl-field-wrap st-row" data-field-kind="select-text" data-id="${id}" data-question-id="${id}">
  <span class="hl-field-badge row-badge" aria-hidden="true"></span>
  <p class="st-text">${html}</p>
</div>`;
}

function renderFreewrite(cfg) {
  return `<textarea class="freewrite-area" data-kind="freewrite" data-id="${cfg.id}" rows="8"></textarea>`;
}

function renderCustomImage(cfg, exerciseDir) {
  const src = cfg.url && cfg.url.trim() ? cfg.url : assetUrl(exerciseDir, cfg.name);
  const w =
    cfg.width && cfg.width > 0
      ? ` style="max-width:${cfg.width}px;width:100%;height:auto"`
      : ' style="max-width:100%;height:auto"';
  return `<img class="hl-custom-image" src="${escapeAttr(src)}" alt=""${w} loading="lazy" />`;
}

/** @type {readonly number[]} */
const HL_AUDIO_RATES = Object.freeze([0.7, 0.8, 0.9, 1.0]);

function formatAudioTime(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "00:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function renderAudioSpeedPresets() {
  return HL_AUDIO_RATES.map((r, idx) => {
    const label = `${String(r).replace(".", ",")}x`;
    return `<button type="button" class="hl-ap-preset" data-rate-index="${idx}" aria-label="Speed ${label}"><span class="hl-ap-dot" aria-hidden="true"></span><span class="hl-ap-rate-label">${escapeHtml(label)}</span></button>`;
  }).join("");
}

/** Inline SVG for play/pause (syncPlayIcon swaps HTML) */
const HL_AP_ICON_PLAY =
  '<svg class="hl-ap-play-svg" viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const HL_AP_ICON_PAUSE =
  '<svg class="hl-ap-play-svg" viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

/** Clock / playback speed */
const HL_AP_ICON_SPEED =
  '<svg class="hl-ap-speed-icon" viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm.5-13H11v6l5.2 3.1.8-1.3-4.5-2.7V7z"/></svg>';

function renderAudio(cfg, exerciseDir) {
  const src = cfg.url && cfg.url.trim() ? cfg.url : assetUrl(exerciseDir, cfg.name);
  const pres = renderAudioSpeedPresets();
  return `<div class="hl-audio-player" data-hl-audio>
  <audio class="hl-audio-el" preload="metadata" src="${escapeAttr(src)}"></audio>
  <div class="hl-audio-main-bar">
    <div class="hl-ap-cluster hl-ap-cluster-left">
      <button type="button" class="hl-ap-btn hl-ap-play" aria-label="Play"><span class="hl-ap-play-icon">${HL_AP_ICON_PLAY}</span></button>
      <button type="button" class="hl-ap-btn hl-ap-speed-btn" aria-label="Playback speed" title="Speed">${HL_AP_ICON_SPEED}</button>
      <button type="button" class="hl-ap-btn hl-ap-skip hl-ap-skip-back" data-skip="-5" aria-label="Rewind 5 seconds"><span class="hl-ap-skip-num">5</span></button>
    </div>
    <div class="hl-ap-cluster hl-ap-cluster-center">
      <span class="hl-ap-time hl-ap-cur">00:00</span>
      <input type="range" class="hl-ap-seek" min="0" max="1000" value="0" step="1" aria-label="Seek" />
      <span class="hl-ap-time hl-ap-dur">00:00</span>
    </div>
    <div class="hl-ap-cluster hl-ap-cluster-right">
      <button type="button" class="hl-ap-btn hl-ap-skip hl-ap-skip-fwd" data-skip="5" aria-label="Forward 5 seconds"><span class="hl-ap-skip-num">5</span></button>
    </div>
  </div>
  <div class="hl-audio-speed-panel" hidden>
    <button type="button" class="hl-ap-speed-step" data-delta="-1" aria-label="Slower">−</button>
    <div class="hl-ap-speed-presets">${pres}</div>
    <button type="button" class="hl-ap-speed-step" data-delta="1" aria-label="Faster">+</button>
  </div>
</div>`;
}

let hlAudioOutsideClickBound = false;

function bindHlAudioOutsideClickOnce() {
  if (hlAudioOutsideClickBound) return;
  hlAudioOutsideClickBound = true;
  document.addEventListener("click", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest(".hl-ap-speed-btn") || t.closest(".hl-audio-speed-panel")) return;
    document.querySelectorAll(".hl-audio-speed-panel").forEach((p) => {
      p.hidden = true;
    });
  });
}

function initCustomAudioPlayers(container) {
  bindHlAudioOutsideClickOnce();
  container.querySelectorAll("[data-hl-audio]").forEach((wrap) => {
    const audio = wrap.querySelector(".hl-audio-el");
    if (!audio || wrap.dataset.hlInited === "1") return;
    wrap.dataset.hlInited = "1";

    const playBtn = wrap.querySelector(".hl-ap-play");
    const playIcon = wrap.querySelector(".hl-ap-play-icon");
    const speedBtn = wrap.querySelector(".hl-ap-speed-btn");
    const panel = wrap.querySelector(".hl-audio-speed-panel");
    const curEl = wrap.querySelector(".hl-ap-cur");
    const durEl = wrap.querySelector(".hl-ap-dur");
    const seek = wrap.querySelector(".hl-ap-seek");
    let rateIndex = HL_AUDIO_RATES.length - 1;
    let seekDragging = false;

    function syncPlayIcon() {
      if (!playIcon) return;
      playIcon.innerHTML = audio.paused ? HL_AP_ICON_PLAY : HL_AP_ICON_PAUSE;
      playBtn?.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
    }

    function setRateIndex(i) {
      rateIndex = Math.max(0, Math.min(HL_AUDIO_RATES.length - 1, i));
      audio.playbackRate = HL_AUDIO_RATES[rateIndex];
      wrap.querySelectorAll(".hl-ap-preset").forEach((b, idx) => {
        b.classList.toggle("is-active", idx === rateIndex);
      });
    }

    playBtn?.addEventListener("click", () => {
      if (audio.paused) void audio.play();
      else audio.pause();
    });

    audio.addEventListener("play", syncPlayIcon);
    audio.addEventListener("pause", syncPlayIcon);
    audio.addEventListener("ended", syncPlayIcon);

    audio.addEventListener("loadedmetadata", () => {
      durEl.textContent = formatAudioTime(audio.duration);
    });

    audio.addEventListener("timeupdate", () => {
      curEl.textContent = formatAudioTime(audio.currentTime);
      if (!seekDragging && audio.duration && Number.isFinite(audio.duration)) {
        seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
      }
    });

    seek?.addEventListener("pointerdown", () => {
      seekDragging = true;
    });
    seek?.addEventListener("pointerup", () => {
      seekDragging = false;
    });
    seek?.addEventListener("pointercancel", () => {
      seekDragging = false;
    });
    seek?.addEventListener("change", () => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
      }
    });
    seek?.addEventListener("input", () => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
      }
    });

    wrap.querySelectorAll("[data-skip]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const delta = Number(btn.dataset.skip);
        const d = audio.duration;
        const t = audio.currentTime + delta;
        if (Number.isFinite(d)) audio.currentTime = Math.max(0, Math.min(d, t));
        else audio.currentTime = Math.max(0, t);
      });
    });

    speedBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = panel.hidden;
      document.querySelectorAll(".hl-audio-speed-panel").forEach((p) => {
        if (p !== panel) p.hidden = true;
      });
      panel.hidden = !willOpen;
    });

    wrap.querySelectorAll(".hl-ap-preset").forEach((b) => {
      b.addEventListener("click", () => setRateIndex(Number(b.dataset.rateIndex)));
    });
    wrap.querySelectorAll("[data-delta]").forEach((b) => {
      b.addEventListener("click", () => setRateIndex(rateIndex + Number(b.dataset.delta)));
    });

    syncPlayIcon();
    setRateIndex(rateIndex);
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("\n", " ");
}

function replaceDropdownEmbeds(html, renderFn) {
  return html.replace(
    /<span class="dropdown-embed"><dropdown id="([^"]+)"><\/dropdown><\/span>/gi,
    (_, id) => renderFn(id) || `<span class="missing-widget">[dropdown ${escapeHtml(id)}]</span>`
  );
}

function replaceGapEmbeds(html, renderFn) {
  return html.replace(
    /<span class="gap-embed"><gap id="([^"]+)"><\/gap><\/span>/gi,
    (_, id) => renderFn(id) || `<span class="missing-widget">[gap ${escapeHtml(id)}]</span>`
  );
}

function replaceStandaloneTags(html, tagName, renderFn) {
  // Match HTML like: <gap id="gap_0"></gap>
  const re = new RegExp(`<${tagName} id="([^"]+)"><\\/${tagName}>`, "gi");
  return html.replace(
    re,
    (_, id) => renderFn(id) || `<span class="missing-widget">[${tagName} ${escapeHtml(id)}]</span>`
  );
}

function renderCustomGroupItem(item, exerciseDir, seq) {
  const shuffle = dropdownGlobalOpts(seq).shuffle;
  const gGap = gapGlobalOpts(seq);
  const allGaps = item.gaps || [];

  const byId = new Map();
  for (const d of item.dropdowns || []) byId.set(d.id, d);
  for (const g of allGaps) byId.set(g.id, g);

  const dropRender = (id) => {
    const cfg = byId.get(id);
    if (!cfg || cfg.type !== "dropdown") return "";
    return renderDropdown(cfg, shuffle);
  };
  const gapRender = (id) => {
    const cfg = byId.get(id);
    if (!cfg || cfg.type !== "gap") return "";
    return renderGapInput(cfg, gGap, allGaps);
  };

  let inner = item.quillContent || "";
  inner = replaceGapEmbeds(inner, gapRender);
  inner = replaceDropdownEmbeds(inner, dropRender);

  let imgHtml = "";
  if (item.imageConfig && item.imageConfig.name) {
    imgHtml = `<div class="cgi-image">${renderCustomImage(
      { ...item.imageConfig, type: "custom-image" },
      exerciseDir
    )}</div>`;
  }
  return `<div class="custom-group-item" data-cgi-id="${escapeAttr(item.id)}">${imgHtml}<div class="cgi-inner">${inner}</div></div>`;
}

function expandPartsHtml(partsHtml, exerciseDir, seq, readingCfgMap) {
  const map = mergeConfigMaps(seq, []);
  const readingMap = readingCfgMap || new Map();
  for (const c of seq.configs || []) if (c && c.id) map.set(c.id, c);

  const shuffle = dropdownGlobalOpts(seq).shuffle;
  const gGap = gapGlobalOpts(seq);
  const allGapsSeq = (seq.configs || []).filter((c) => c && c.type === "gap");

  const renderById = (id, typeHint) => {
    let c = map.get(id) || readingMap.get(id);
    if (!c && typeHint === "custom-group-item") {
      c = (seq.configs || []).find((x) => x && x.id === id && x.type === "custom-group-item");
    }
    if (!c) return "";
    switch (c.type) {
      case "dropdown":
        return renderDropdown(c, shuffle);
      case "gap":
        return renderGapInput(c, gGap, allGapsSeq);
      case "single-letter":
        return renderSingleLetter(c);
      case "freewrite":
        return renderFreewrite(c);
      case "quiz":
        return renderQuizOrChoice(c, "quiz");
      case "single-choice":
        return renderQuizOrChoice(c, "single-choice");
      case "custom-image":
        return renderCustomImage(c, exerciseDir);
      case "audio-player":
        return renderAudio(c, exerciseDir);
      case "custom-group-item":
        return renderCustomGroupItem(c, exerciseDir, seq);
      case "multiple-choice":
        return renderMultipleChoice(c, multipleChoiceGlobalOpts(seq).shuffle);
      case "custom-table":
        return renderCustomTable(c, exerciseDir, seq, readingMap);
      case "video-player":
        return renderVideoPlayer(c);
      case "sentence-order":
        return renderSentenceOrder(c);
      case "picture-click":
        return renderPictureClick(c, exerciseDir);
      case "picture-gap":
        return renderPictureGap(c, seq, exerciseDir);
      case "picture-drag":
        return renderPictureDrag(c, exerciseDir);
      case "grid-item":
        return renderGridItem(c, exerciseDir, seq, readingCfgMap);
      case "jumbled-dialogue":
        return renderJumbledDialogue(c);
      case "list-assign":
        return renderListAssign(c);
      case "select-text":
        return renderSelectText(c);
      default:
        return "";
    }
  };

  let html = partsHtml;
  html = replaceStandaloneTags(html, "custom-group-item", (id) => renderById(id, "custom-group-item"));
  html = replaceStandaloneTags(html, "custom-image", (id) => renderById(id));
  html = replaceStandaloneTags(html, "dropdown", (id) => renderById(id));
  html = replaceStandaloneTags(html, "gap", (id) => renderById(id));
  html = replaceStandaloneTags(html, "audio-player", (id) => renderById(id));
  html = replaceStandaloneTags(html, "video-player", (id) => renderById(id));
  html = replaceStandaloneTags(html, "single-letter", (id) => renderById(id));
  html = replaceStandaloneTags(html, "freewrite", (id) => renderById(id));
  html = replaceStandaloneTags(html, "quiz", (id) => renderById(id));
  html = replaceStandaloneTags(html, "custom-table", (id) => renderById(id));
  html = replaceStandaloneTags(html, "sentence-order", (id) => renderById(id));
  html = replaceStandaloneTags(html, "picture-click", (id) => renderById(id));
  html = replaceStandaloneTags(html, "picture-gap", (id) => renderById(id));
  html = replaceStandaloneTags(html, "picture-drag", (id) => renderById(id));
  html = replaceStandaloneTags(html, "grid-item", (id) => renderById(id));
  html = replaceStandaloneTags(html, "jumbled-dialogue", (id) => renderById(id));
  html = replaceStandaloneTags(html, "list-assign", (id) => renderById(id));
  html = replaceStandaloneTags(html, "select-text", (id) => renderById(id));
  // Helbling sometimes uses <multiple-choice> tag for single-choice items.
  html = replaceStandaloneTags(html, "multiple-choice", (id) => renderById(id));
  html = replaceStandaloneTags(html, "single-choice", (id) => renderById(id));
  return html;
}

function expandReadingHtml(data, exerciseDir) {
  const rt = data.readingText;
  if (!rt || !rt.content) return "";
  const cfgs = rt.configs || [];
  const readingMap = new Map();
  for (const c of cfgs) if (c.id) readingMap.set(c.id, c);
  const fakeSeq = { configs: [], staticConfigs: cfgs, globalTypesConfigs: [] };
  const body = expandPartsHtml(rt.content, exerciseDir, fakeSeq, readingMap);
  const instr = pickInstruction(rt.instruction);
  const instrHtml = instr ? `<div class="reading-instruction">${instr}</div>` : "";
  return `<section class="reading-block">${instrHtml}<div class="reading-body">${body}</div></section>`;
}

function renderExercise(data, exerciseDir, title) {
  headerTitleEl.textContent = title;
  footerEl.hidden = false;

  const topInstr = pickInstruction(data.instruction);
  const firstSeqInstr = (() => {
    for (const s of data.sequences || []) {
      const t = pickInstruction(s.instruction);
      if (t && normInstructionHtml(t)) return t;
    }
    return "";
  })();
  const showTopInstr = !!(
    topInstr &&
    normInstructionHtml(topInstr) &&
    normInstructionHtml(topInstr) !== normInstructionHtml(firstSeqInstr)
  );

  const reading = expandReadingHtml(data, exerciseDir);
  const seqBlocks = (data.sequences || []).map((seq, idx) => {
    const si = pickInstruction(seq.instruction);
    const parts = (seq.parts || []).map((p) => expandPartsHtml(p, exerciseDir, seq, null)).join("");
    const instrHtml = si ? `<div class="exercise-instruction">${si}</div>` : "";
    const ic = gapGlobalOpts(seq).ignoreCase ? "1" : "0";
    return `<section class="sequence-block" data-seq-idx="${idx}" data-ignore-case="${ic}">${instrHtml}<div class="exercise-body">${parts}</div></section>`;
  });

  mainEl.innerHTML = `
    ${showTopInstr && !reading ? `<div class="exercise-instruction">${topInstr}</div>` : ""}
    ${reading}
    ${showTopInstr && reading ? `<div class="exercise-instruction">${topInstr}</div>` : ""}
    ${seqBlocks.join("")}
  `;
  initCustomAudioPlayers(mainEl);
  resetExerciseUiForSession();
  if (toggleAnswersEl) toggleAnswersEl.checked = false;
  syncAnswerKeyModeClass();
  resetExerciseForm();
  clearMarks();
  syncKeyItemVisibility();
  applyPracticeLock(false);
  ensureExerciseDelegation();
  syncFooterActionButton();
}

function resetExerciseUiForSession() {
  exerciseUi.answersMode = false;
  exerciseUi.lockedAfterCheck = false;
  exerciseUi.practiceAction = "check";
  exerciseUi.revealAll = false;
  exerciseUi.practiceDirty = false;
  exerciseUi.keyRevealedItemIds = new Set();
}

function buildIdToCfg(data) {
  const idToCfg = new Map();
  const register = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const c of arr) if (c && c.id) idToCfg.set(c.id, c);
  };
  register(data.readingText?.configs);
  for (const seq of data.sequences || []) {
    register(seq.configs);
    register(seq.staticConfigs);
    for (const c of seq.configs || []) {
      if (c && c.type === "custom-group-item") {
        register(c.gaps);
        register(c.dropdowns);
      }
    }
  }
  return idToCfg;
}

function itemKeyRevealed(id) {
  if (exerciseUi.revealAll) return true;
  return exerciseUi.keyRevealedItemIds.has(id);
}

function syncKeyItemVisibility() {
  if (!mainEl) return;
  mainEl.querySelectorAll(".hl-key-facade").forEach((facade) => {
    const wrap = facade.closest(".hl-field-wrap");
    if (!wrap) return;
    if (!exerciseUi.answersMode) {
      facade.hidden = true;
      wrap.classList.remove("hl-key-item-hidden");
      return;
    }
    // In answer-key mode we always show the facade and visually hide controls.
    facade.hidden = false;
    const id = wrap.getAttribute("data-id") || "";
    const revealed = itemKeyRevealed(id);
    const concealed = !revealed;
    wrap.classList.toggle("hl-key-item-hidden", concealed);

    const iconBtn = wrap.querySelector(".hl-key-icon");
    if (iconBtn) {
      // Concealed: open-eye icon centered on blue block (disabled)
      // Revealed: slashed-eye icon (clickable to conceal one item)
      iconBtn.innerHTML = concealed ? hlSvgEye() : hlSvgEyeOff();
      iconBtn.disabled = false;
      iconBtn.setAttribute("aria-label", concealed ? "Show answer" : "Hide answer");
    }
  });
}

/** In answer-key mode, fill inputs/selects with correct values (shown when revealed). */
function applyAnswersFromKey(data) {
  const idToCfg = buildIdToCfg(data);
  for (const inp of mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]')) {
    const cfg = idToCfg.get(inp.getAttribute("data-id"));
    if (cfg) inp.value = stripHtml(String(cfg.correctAnswer ?? ""));
  }
  for (const sel of mainEl.querySelectorAll("select.hl-dropdown")) {
    const cfg = idToCfg.get(sel.getAttribute("data-id"));
    if (!cfg) continue;
    const correct = (cfg.additionalAnswers || []).find((a) => a.correct);
    if (correct) {
      const val = correct.answer;
      for (const o of sel.options) {
        if (o.value === val) {
          sel.value = val;
          break;
        }
      }
    }
  }
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="quiz"], .hl-field-wrap[data-field-kind="single-choice"]')) {
    const qid = row.getAttribute("data-question-id");
    const cfg = qid ? idToCfg.get(qid) : null;
    if (!cfg) continue;
    const target = normGap(stripHtml(cfg.correctAnswer), false);
    for (const inp of row.querySelectorAll('input[type="radio"]')) {
      if (normGap(inp.value, false) === target) {
        inp.checked = true;
        break;
      }
    }
  }
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="multiple-choice"]')) {
    for (const box of row.querySelectorAll('input[type="checkbox"]')) {
      box.checked = box.getAttribute("data-correct") === "1";
    }
  }
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="sentence-order"]')) {
    const answerEl = row.querySelector("[data-so-answer]");
    if (!answerEl) continue;
    const tokens = [...row.querySelectorAll(".so-token")].sort(
      (a, b) => Number(a.dataset.origIdx) - Number(b.dataset.origIdx)
    );
    for (const t of tokens) answerEl.appendChild(t);
  }
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="picture-click"]')) {
    for (const inp of row.querySelectorAll('input[data-kind="picture-click"]')) {
      inp.checked = inp.getAttribute("data-correct") === "1";
    }
  }
  for (const sel of mainEl.querySelectorAll(".la-select")) {
    sel.value = sel.getAttribute("data-correct-list") || "";
  }
  for (const w of mainEl.querySelectorAll(".st-word")) {
    w.classList.toggle("is-selected", w.getAttribute("data-correct") === "1");
  }
}

function clearMarks() {
  mainEl.querySelectorAll(".hl-field-wrap").forEach((w) => {
    w.classList.remove("hl-mark-ok", "hl-mark-wrong");
    const b = w.querySelector(".hl-field-badge");
    if (b) b.textContent = "";
  });
  mainEl.querySelectorAll(".gap-input, .single-letter-input, select.hl-dropdown").forEach((el) => {
    el.classList.remove("gap-wrong", "gap-ok");
  });
}

function countScorableItems() {
  const gaps = mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]').length;
  const drops = mainEl.querySelectorAll("select.hl-dropdown").length;
  const choices = mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="quiz"], .hl-field-wrap[data-field-kind="single-choice"]').length;
  const multi = mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="multiple-choice"]').length;
  const order = mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="sentence-order"]').length;
  const picClick = mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="picture-click"]').length;
  const listAssign = mainEl.querySelectorAll(".la-select").length;
  const selectText = mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="select-text"]').length;
  return gaps + drops + choices + multi + order + picClick + listAssign + selectText;
}

function userHasStartedExercise() {
  if (!mainEl) return false;
  for (const inp of mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]')) {
    if (inp.value.trim()) return true;
  }
  for (const sel of mainEl.querySelectorAll("select.hl-dropdown")) {
    if (sel.value) return true;
  }
  for (const r of mainEl.querySelectorAll('input[type="radio"][data-kind="quiz"], input[type="radio"][data-kind="single-choice"]')) {
    if (r.checked) return true;
  }
  for (const c of mainEl.querySelectorAll('input[type="checkbox"][data-kind="multiple-choice"]')) {
    if (c.checked) return true;
  }
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="sentence-order"]')) {
    if (row.querySelector("[data-so-answer]")?.children.length) return true;
  }
  for (const i of mainEl.querySelectorAll('input[data-kind="picture-click"]')) {
    if (i.checked) return true;
  }
  for (const sel of mainEl.querySelectorAll(".la-select")) {
    if (sel.value) return true;
  }
  if (mainEl.querySelector(".st-word.is-selected")) return true;
  return false;
}

function setWrapMark(wrap, ok) {
  if (!wrap) return;
  wrap.classList.remove("hl-mark-ok", "hl-mark-wrong");
  wrap.classList.add(ok ? "hl-mark-ok" : "hl-mark-wrong");
  const badge = wrap.querySelector(".hl-field-badge");
  if (badge) badge.textContent = ok ? "✓" : "✕";
  const ctl = wrap.querySelector(".gap-input, .single-letter-input, select.hl-dropdown");
  if (ctl) {
    ctl.classList.remove("gap-wrong", "gap-ok");
    ctl.classList.add(ok ? "gap-ok" : "gap-wrong");
  }
}

function clearWrapMark(wrap) {
  if (!wrap) return;
  wrap.classList.remove("hl-mark-ok", "hl-mark-wrong");
  const badge = wrap.querySelector(".hl-field-badge");
  if (badge) badge.textContent = "";
  const ctl = wrap.querySelector(".gap-input, .single-letter-input, select.hl-dropdown");
  if (ctl) ctl.classList.remove("gap-wrong", "gap-ok");
}

function setControlState(controlEl, ok) {
  const wrap = controlEl?.closest(".hl-field-wrap");
  if (wrap) setWrapMark(wrap, ok);
}

function setRowState(rowEl, ok) {
  if (!rowEl) return;
  setWrapMark(rowEl, ok);
}

function allScorableAnswered() {
  for (const inp of mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]')) {
    if (!inp.value.trim()) return false;
  }
  for (const sel of mainEl.querySelectorAll("select.hl-dropdown")) {
    if (!sel.value) return false;
  }
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="quiz"], .hl-field-wrap[data-field-kind="single-choice"]')) {
    if (!row.querySelector('input[type="radio"]:checked')) return false;
  }
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="multiple-choice"]')) {
    if (!row.querySelector('input[type="checkbox"]:checked')) return false;
  }
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="sentence-order"]')) {
    const answerEl = row.querySelector("[data-so-answer]");
    const need = Number(row.getAttribute("data-token-count") || 0);
    if (!answerEl || answerEl.children.length < need) return false;
  }
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="picture-click"]')) {
    if (!row.querySelector('input[data-kind="picture-click"]:checked')) return false;
  }
  for (const sel of mainEl.querySelectorAll(".la-select")) {
    if (!sel.value) return false;
  }
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="select-text"]')) {
    if (!row.querySelector(".st-word.is-selected")) return false;
  }
  return countScorableItems() > 0;
}

function evaluateExercise(data) {
  if (exerciseUi.answersMode) return;
  clearMarks();
  const idToCfg = buildIdToCfg(data);

  for (const inp of mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]')) {
    const wrap = inp.closest(".hl-field-wrap");
    if (!inp.value.trim()) {
      clearWrapMark(wrap);
      continue;
    }
    const seqEl = inp.closest(".sequence-block");
    const ignoreCase = seqEl?.getAttribute("data-ignore-case") === "1";
    const cfg = idToCfg.get(inp.getAttribute("data-id"));
    if (!cfg) continue;
    const ok = gapMatches(inp.value, cfg, ignoreCase);
    setControlState(inp, ok);
  }

  for (const sel of mainEl.querySelectorAll("select.hl-dropdown")) {
    const wrap = sel.closest(".hl-field-wrap");
    if (!sel.value) {
      clearWrapMark(wrap);
      continue;
    }
    const cfg = idToCfg.get(sel.getAttribute("data-id"));
    if (!cfg) continue;
    const opt = sel.selectedOptions[0];
    const ok = !!(opt && opt.value && opt.getAttribute("data-correct") === "1");
    setControlState(sel, ok);
  }

  for (const row of mainEl.querySelectorAll(
    '.hl-field-wrap[data-field-kind="quiz"], .hl-field-wrap[data-field-kind="single-choice"]'
  )) {
    const checked = row.querySelector('input[type="radio"]:checked');
    if (!checked) {
      clearWrapMark(row);
      continue;
    }
    const seqEl = row.closest(".sequence-block");
    const ignoreCase = seqEl?.getAttribute("data-ignore-case") === "1";
    const qid = row.getAttribute("data-question-id");
    const cfg = qid ? idToCfg.get(qid) : null;
    if (!cfg) continue;
    const correctText = normGap(stripHtml(cfg.correctAnswer), ignoreCase);
    const picked = normGap(checked.value, ignoreCase);
    const ok = !!(picked && picked === correctText);
    setRowState(row, ok);
  }

  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="multiple-choice"]')) {
    const boxes = [...row.querySelectorAll('input[type="checkbox"]')];
    if (!boxes.some((b) => b.checked)) {
      clearWrapMark(row);
      continue;
    }
    const ok = boxes.every((b) => b.checked === (b.getAttribute("data-correct") === "1"));
    setRowState(row, ok);
  }

  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="sentence-order"]')) {
    const answerEl = row.querySelector("[data-so-answer]");
    if (!answerEl || !answerEl.children.length) {
      clearWrapMark(row);
      continue;
    }
    const seqEl = row.closest(".sequence-block");
    const ignoreCase = seqEl?.getAttribute("data-ignore-case") === "1";
    const picked = [...answerEl.children].map((el) => el.textContent).join(" ");
    const ok = normGap(picked, ignoreCase) === normGap(row.getAttribute("data-expected"), ignoreCase);
    setRowState(row, ok);
  }

  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="picture-click"]')) {
    const inputs = [...row.querySelectorAll('input[data-kind="picture-click"]')];
    if (!inputs.some((i) => i.checked)) {
      clearWrapMark(row);
      continue;
    }
    const ok = inputs.every((i) => i.checked === (i.getAttribute("data-correct") === "1"));
    setRowState(row, ok);
  }

  for (const sel of mainEl.querySelectorAll(".la-select")) {
    const wrap = sel.closest(".la-row");
    if (!sel.value) {
      wrap?.classList.remove("la-ok", "la-wrong");
      continue;
    }
    const ok = sel.value === sel.getAttribute("data-correct-list");
    wrap?.classList.toggle("la-ok", ok);
    wrap?.classList.toggle("la-wrong", !ok);
  }

  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="select-text"]')) {
    const words = [...row.querySelectorAll(".st-word")];
    if (!words.some((w) => w.classList.contains("is-selected"))) {
      clearWrapMark(row);
      continue;
    }
    const ok = words.every(
      (w) => w.classList.contains("is-selected") === (w.getAttribute("data-correct") === "1")
    );
    setRowState(row, ok);
  }

  // Spec: after pressing Check, lock exercise until user presses Correct.
  exerciseUi.lockedAfterCheck = true;
  exerciseUi.practiceAction = "correct";
  applyPracticeLock(true);
  syncFooterActionButton();
}

function unlockAfterCorrect() {
  exerciseUi.lockedAfterCheck = false;
  exerciseUi.practiceAction = "check";
  // Remove right/wrong marks but keep user's answers.
  clearMarks();
  applyPracticeLock(false);
  syncFooterActionButton();
}

function resetExerciseForm() {
  for (const inp of mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]')) {
    inp.value = "";
  }
  for (const sel of mainEl.querySelectorAll("select.hl-dropdown")) sel.value = "";
  for (const radio of mainEl.querySelectorAll(
    'input[type="radio"][data-kind="quiz"], input[type="radio"][data-kind="single-choice"]'
  )) {
    radio.checked = false;
  }
  for (const box of mainEl.querySelectorAll('input[type="checkbox"][data-kind="multiple-choice"]')) {
    box.checked = false;
  }
  for (const inp of mainEl.querySelectorAll('input[data-kind="picture-click"]')) inp.checked = false;
  for (const sel of mainEl.querySelectorAll(".la-select")) {
    sel.value = "";
    sel.closest(".la-row")?.classList.remove("la-ok", "la-wrong");
  }
  for (const w of mainEl.querySelectorAll(".st-word")) w.classList.remove("is-selected");
  for (const row of mainEl.querySelectorAll('.hl-field-wrap[data-field-kind="sentence-order"]')) {
    const answerEl = row.querySelector("[data-so-answer]");
    const bankEl = row.querySelector("[data-so-bank]");
    if (answerEl && bankEl) {
      while (answerEl.firstChild) bankEl.appendChild(answerEl.firstChild);
    }
  }
  for (const area of mainEl.querySelectorAll("textarea.freewrite-area")) area.value = "";
}

function applyPracticeLock(lockedAfterCorrect) {
  const lock = exerciseUi.answersMode || !!lockedAfterCorrect;
  for (const inp of mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]')) {
    inp.readOnly = lock;
    inp.disabled = false;
  }
  for (const sel of mainEl.querySelectorAll("select.hl-dropdown")) sel.disabled = lock;
  for (const r of mainEl.querySelectorAll(
    'input[type="radio"][data-kind="quiz"], input[type="radio"][data-kind="single-choice"]'
  )) {
    r.disabled = lock;
  }
  for (const c of mainEl.querySelectorAll('input[type="checkbox"][data-kind="multiple-choice"]')) {
    c.disabled = lock;
  }
  for (const tok of mainEl.querySelectorAll(".so-token")) tok.disabled = lock;
  for (const inp of mainEl.querySelectorAll('input[data-kind="picture-click"]')) inp.disabled = lock;
  for (const sel of mainEl.querySelectorAll(".la-select")) sel.disabled = lock;
  mainEl.classList.toggle("hl-st-locked", lock);
  for (const area of mainEl.querySelectorAll("textarea.freewrite-area")) area.readOnly = lock;
}

function syncAnswerKeyModeClass() {
  appRootEl?.classList.toggle("hl-answer-key-mode", exerciseUi.answersMode);
}

const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3.6 12.2l1.3-1.3 2 2 4-4 1.3 1.3-5.3 5.3-3.3-3.3zM12 7h9v2h-9V7zm0 5h9v2h-9v-2zm0 5h9v2h-9v-2z"/></svg>';

const ICON_PENCIL = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

function syncFooterActionButton() {
  if (!btnActionEl) return;
  const iconEl = btnActionEl.querySelector(".btn-action-icon");
  const labelEl = btnActionEl.querySelector(".btn-action-label");
  const show =
    !!currentSession && (exerciseUi.answersMode || exerciseUi.lockedAfterCheck || userHasStartedExercise());
  btnActionEl.hidden = !show;
  if (!show) return;

  btnActionEl.classList.remove("btn-footer-outline");
  btnActionEl.classList.toggle("is-hide-all", false);
  if (exerciseUi.answersMode) {
    if (exerciseUi.revealAll) {
      btnActionEl.classList.add("btn-footer-outline");
      btnActionEl.classList.toggle("is-hide-all", true);
      if (iconEl) iconEl.innerHTML = hlSvgEyeOff();
      if (labelEl) labelEl.textContent = "Hide all";
    } else {
      if (iconEl) iconEl.innerHTML = hlSvgEye();
      if (labelEl) labelEl.textContent = "Show all";
    }
    return;
  }

  if (exerciseUi.lockedAfterCheck && exerciseUi.practiceAction === "correct") {
    if (iconEl) iconEl.innerHTML = ICON_PENCIL;
    if (labelEl) labelEl.textContent = "Correct";
    return;
  }

  if (iconEl) iconEl.innerHTML = ICON_CHECK;
  if (labelEl) labelEl.textContent = "Check";
}

let exerciseDelegationBound = false;

function getAllKeyFieldIds() {
  const ids = [];
  mainEl.querySelectorAll(".hl-field-wrap[data-id]").forEach((w) => {
    const id = w.getAttribute("data-id");
    if (id) ids.push(id);
  });
  return ids;
}

function ensureExerciseDelegation() {
  if (exerciseDelegationBound) return;
  exerciseDelegationBound = true;
  mainEl.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest && e.target.closest(".hl-key-icon");
    if (!btn || !currentSession || !exerciseUi.answersMode) return;
    e.preventDefault();
    const id = btn.getAttribute("data-key-toggle");
    if (!id) return;

    const isHiddenNow = !itemKeyRevealed(id);
    if (exerciseUi.revealAll) {
      // Global-show -> switch to per-item mode immediately when user hides one.
      exerciseUi.revealAll = false;
      const all = getAllKeyFieldIds();
      exerciseUi.keyRevealedItemIds = new Set(all);
      exerciseUi.keyRevealedItemIds.delete(id);
    } else {
      // Per-item toggle: hidden -> reveal, revealed -> hide.
      if (isHiddenNow) exerciseUi.keyRevealedItemIds.add(id);
      else exerciseUi.keyRevealedItemIds.delete(id);
    }

    syncKeyItemVisibility();
    syncFooterActionButton();
  });
  mainEl.addEventListener("click", (e) => {
    const tok = e.target && e.target.closest && e.target.closest(".so-token");
    if (!tok || tok.disabled || !currentSession || exerciseUi.answersMode) return;
    const row = tok.closest('.hl-field-wrap[data-field-kind="sentence-order"]');
    if (!row) return;
    const inAnswer = !!tok.closest("[data-so-answer]");
    const target = row.querySelector(inAnswer ? "[data-so-bank]" : "[data-so-answer]");
    if (!target) return;
    target.appendChild(tok);
    clearWrapMark(row);
    if (!exerciseUi.lockedAfterCheck) syncFooterActionButton();
  });
  mainEl.addEventListener("click", (e) => {
    const word = e.target && e.target.closest && e.target.closest(".st-word");
    if (!word || !currentSession || exerciseUi.answersMode || exerciseUi.lockedAfterCheck) return;
    word.classList.toggle("is-selected");
    const row = word.closest('.hl-field-wrap[data-field-kind="select-text"]');
    if (row) clearWrapMark(row);
    syncFooterActionButton();
  });
  const bump = () => {
    if (!currentSession || exerciseUi.answersMode || exerciseUi.lockedAfterCheck) return;
    syncFooterActionButton();
  };
  mainEl.addEventListener("input", bump);
  mainEl.addEventListener("change", bump);
}

function wireFooter() {
  if (toggleAnswersEl) {
    toggleAnswersEl.addEventListener("change", () => {
      if (!currentSession) return;
      const on = toggleAnswersEl.checked;
      exerciseUi.answersMode = on;
      exerciseUi.revealAll = false;
      exerciseUi.keyRevealedItemIds = new Set();
      exerciseUi.lockedAfterCheck = false;
      exerciseUi.practiceAction = "check";
      clearMarks();
      resetExerciseForm();
      if (on) applyAnswersFromKey(currentSession.data);
      syncAnswerKeyModeClass();
      syncKeyItemVisibility();
      applyPracticeLock(false);
      syncFooterActionButton();
    });
  }

  if (btnActionEl) {
    btnActionEl.addEventListener("click", () => {
      if (!currentSession) return;
      if (exerciseUi.answersMode) {
        exerciseUi.revealAll = !exerciseUi.revealAll;
        if (exerciseUi.revealAll) {
          // Global show: ignore per-item set.
          exerciseUi.keyRevealedItemIds = new Set();
        } else {
          // Global hide: nothing individually revealed.
          exerciseUi.keyRevealedItemIds = new Set();
        }
        syncKeyItemVisibility();
        syncFooterActionButton();
        return;
      }
      if (exerciseUi.lockedAfterCheck && exerciseUi.practiceAction === "correct") {
        unlockAfterCorrect();
        return;
      }
      evaluateExercise(currentSession.data);
    });
  }

  if (btnClose) {
    btnClose.addEventListener("click", () => {
      if (currentSession?.courseId) {
        location.hash = `#/course/${encodeURIComponent(currentSession.courseId)}`;
      } else {
        location.hash = "#/";
      }
    });
  }
}

async function openExercise(unitId, exerciseId) {
  const path = exerciseJsonPath(unitId, exerciseId);
  const res = await fetch(path);
  if (!res.ok) {
    mainEl.innerHTML = `<p>Cannot load exercise: <code>${escapeHtml(path)}</code> (${res.status})</p>`;
    footerEl.hidden = true;
    return;
  }
  const data = await res.json();
  const dir = exerciseAssetDir(unitId, exerciseId);
  currentSession = { exerciseDir: dir, data, unitId, exerciseId };
  renderExercise(data, dir, formatExerciseTitle(exerciseId));
}

async function route() {
  const r = parseHashRoute();
  if (r.type === "home") {
    await renderCoursePicker();
  } else if (r.type === "data-toc") {
    await renderDataCourseToc(r.courseId);
  } else if (r.type === "data-exercise") {
    await openDataExercise(r.courseId, r.unitId, r.exerciseId);
  } else if (r.type === "legacy-exercise") {
    if (!courseIndex) await loadCourseIndex();
    await openExercise(r.unitId, r.exerciseId);
  }
}

function init() {
  wireFooter();
  window.addEventListener("hashchange", () => route());
  route().catch((e) => {
    mainEl.innerHTML = `<p class="empty-toc">Failed to load: ${escapeHtml(e.message)}</p>`;
    footerEl.hidden = true;
  });
}

init();

