/**
 * Helbling Options — offline exercise viewer.
 * Serve repo root:  npx --yes serve d:\work\user-task\english\helbling
 * Open: http://localhost:3000/viewer/
 */

const CONTENT_XML_RELATIVE_PATH =
  "options/level_1/options_1-options_1_2023_cyber_homework/content.xml";

function getCandidateContentXmlPaths() {
  // Support both hosting layouts:
  // - Served at repo root:    /options/.../content.xml
  // - Viewer served in /viewer: /viewer/ + ../options/.../content.xml
  return [
    CONTENT_XML_RELATIVE_PATH,
    `../${CONTENT_XML_RELATIVE_PATH}`,
    `../../${CONTENT_XML_RELATIVE_PATH}`,
  ];
}

const mainEl = document.getElementById("main");
const headerTitleEl = document.getElementById("header-title");
const footerEl = document.getElementById("app-footer");
const footerScoreEl = document.getElementById("footer-score");
const btnAnswer = document.getElementById("btn-answer");
const btnShowAll = document.getElementById("btn-show-all");
const btnReset = document.getElementById("btn-reset");
const btnClose = document.getElementById("btn-close");

/** @type {{ courseBase: string, fetchPrefix?: string, units: { id: string, exercises: { id: string, maxPoints: string }[] }[] } | null} */
let courseIndex = null;

/** @type {{ exerciseDir: string, data: object } | null} */
let currentSession = null;

function courseBaseFromContentPath() {
  // Use the canonical relative path for computing base, independent of how it was fetched.
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

function normInstructionHtml(html) {
  return stripHtml(String(html || ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatExerciseTitle(folderName) {
  return folderName.replaceAll("_", " ");
}

function stripHtml(s) {
  const d = document.createElement("div");
  d.innerHTML = s;
  return d.textContent || d.innerText || "";
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

function parseContentXml(xmlText) {
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
  return { courseBase: courseBaseFromContentPath(), units };
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
  // Keep canonical courseBase and remember the relative prefix that worked.
  courseIndex.courseBase = courseBaseFromContentPath();
  courseIndex.fetchPrefix = computeFetchPrefix(usedPath);
}

function exerciseDirHref(unitId, exerciseId) {
  return `#/ex/${encodeURIComponent(unitId)}/${encodeURIComponent(exerciseId)}`;
}

function parseHashRoute() {
  const h = (location.hash || "").replace(/^#/, "");
  const m = /^\/ex\/([^/]+)\/([^/]+)\/?$/.exec(h);
  if (!m) return null;
  return { unitId: decodeURIComponent(m[1]), exerciseId: decodeURIComponent(m[2]) };
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

function gapWidthPx(cfg, globalWidthMode, allGapCfgs) {
  if (cfg.width != null && cfg.width > 0) return `${cfg.width}px`;
  if (globalWidthMode === "asLongestWord" && allGapCfgs && allGapCfgs.length) {
    let maxLen = 0;
    for (const g of allGapCfgs) {
      const pieces = [g.correctAnswer, ...(g.additionalAnswers || []).map((a) => (typeof a === "string" ? a : a.answer))];
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

function renderGapInput(cfg, globalGap, allGapsInScope) {
  const w = gapWidthPx(cfg, globalGap.widthMode, allGapsInScope);
  const size = stripHtml(String(cfg.correctAnswer || "")).length || 4;
  return `<input type="text" class="gap-input" data-kind="gap" data-id="${cfg.id}" style="width:${w};max-width:100%" size="${Math.min(size + 2, 40)}" autocomplete="off" spellcheck="false" />`;
}

function renderDropdown(cfg, shuffle, exerciseDir) {
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
  return `<select class="hl-dropdown" data-kind="dropdown" data-id="${cfg.id}" autocomplete="off">${opts.join("")}</select>`;
}

function renderSingleLetter(cfg) {
  const len = Math.max(String(cfg.correctAnswer || "").length, 1);
  return `<input type="text" class="single-letter-input" data-kind="single-letter" data-id="${cfg.id}" maxlength="${len}" size="${len + 1}" autocomplete="off" spellcheck="false" />`;
}

function renderQuizOrChoice(cfg, kind) {
  const qid = cfg.id;
  const opts = [];
  const answers = cfg.additionalAnswers || [];
  // Many Helbling items (eg. TRUE/FALSE) look best as a single-row radio group,
  // even if the item config has orientation=vertical.
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
  return `<div class="${kind === "quiz" ? "quiz-row" : "sc-row"}" data-question-id="${escapeAttr(qid)}"><span class="status-icon row-status" aria-hidden="true"></span><div class="${kind === "quiz" ? "quiz-q" : "sc-q"}">${cfg.question || ""}</div><div class="${kind === "quiz" ? "quiz-options" : "sc-options"}" data-orient="${effectiveOrientation}" style="display:flex;flex-direction:${effectiveOrientation};flex-wrap:wrap;gap:0.35rem 1rem">${opts.join("")}</div></div>`;
}

function renderFreewrite(cfg) {
  return `<textarea class="freewrite-area" data-kind="freewrite" data-id="${cfg.id}" rows="8"></textarea>`;
}

function renderCustomImage(cfg, exerciseDir) {
  const src = cfg.url && cfg.url.trim() ? cfg.url : assetUrl(exerciseDir, cfg.name);
  const w = cfg.width && cfg.width > 0 ? ` style="max-width:${cfg.width}px;width:100%;height:auto"` : ' style="max-width:100%;height:auto"';
  return `<img class="hl-custom-image" src="${escapeAttr(src)}" alt=""${w} loading="lazy" />`;
}

function renderAudio(cfg, exerciseDir) {
  const src = cfg.url && cfg.url.trim() ? cfg.url : assetUrl(exerciseDir, cfg.name);
  return `<audio controls src="${escapeAttr(src)}" preload="metadata"></audio>`;
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
  return html.replace(/<span class="dropdown-embed"><dropdown id="([^"]+)"><\/dropdown><\/span>/gi, (_, id) => {
    const cfg = renderFn(id);
    return cfg || `<span class="missing-widget">[dropdown ${escapeHtml(id)}]</span>`;
  });
}

function replaceGapEmbeds(html, renderFn) {
  return html.replace(/<span class="gap-embed"><gap id="([^"]+)"><\/gap><\/span>/gi, (_, id) => {
    const cfg = renderFn(id);
    return cfg || `<span class="missing-widget">[gap ${escapeHtml(id)}]</span>`;
  });
}

function replaceStandaloneTags(html, tagName, renderFn) {
  const re = new RegExp(`<${tagName} id="([^"]+)"><\\/${tagName}>`, "gi");
  return html.replace(re, (_, id) => {
    const cfg = renderFn(id);
    return cfg || `<span class="missing-widget">[${tagName} ${escapeHtml(id)}]</span>`;
  });
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
    return renderDropdown(cfg, shuffle, exerciseDir);
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
        return renderDropdown(c, shuffle, exerciseDir);
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
  html = replaceStandaloneTags(html, "single-letter", (id) => renderById(id));
  html = replaceStandaloneTags(html, "freewrite", (id) => renderById(id));
  html = replaceStandaloneTags(html, "quiz", (id) => renderById(id));
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
  const showTopInstr = !!(topInstr && normInstructionHtml(topInstr) && normInstructionHtml(topInstr) !== normInstructionHtml(firstSeqInstr));

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
  setScoreText(0, countScorableItems());
}

function clearMarks() {
  mainEl.querySelectorAll(".gap-wrong, .gap-ok").forEach((el) => {
    el.classList.remove("gap-wrong", "gap-ok");
  });
  mainEl.querySelectorAll(".status-icon").forEach((el) => {
    el.textContent = "";
    el.classList.remove("is-ok", "is-wrong");
  });
}

function setScoreText(correct, total) {
  if (!footerScoreEl) return;
  if (!total) {
    footerScoreEl.textContent = "Score: -/-";
    return;
  }
  footerScoreEl.textContent = `Score: ${correct}/${total}`;
}

function countScorableItems() {
  const gaps = mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]').length;
  const drops = mainEl.querySelectorAll("select.hl-dropdown").length;
  const choices = mainEl.querySelectorAll(".quiz-row, .sc-row").length;
  return gaps + drops + choices;
}

function setControlState(controlEl, ok) {
  if (!controlEl) return;
  controlEl.classList.add(ok ? "gap-ok" : "gap-wrong");
  let icon = controlEl.nextElementSibling;
  if (!icon || !icon.classList.contains("status-icon")) {
    icon = document.createElement("span");
    icon.className = "status-icon";
    icon.setAttribute("aria-hidden", "true");
    controlEl.insertAdjacentElement("afterend", icon);
  }
  icon.textContent = ok ? "✓" : "✕";
  icon.classList.remove("is-ok", "is-wrong");
  icon.classList.add(ok ? "is-ok" : "is-wrong");
}

function setRowState(rowEl, ok) {
  if (!rowEl) return;
  rowEl.classList.add(ok ? "gap-ok" : "gap-wrong");
  const icon = rowEl.querySelector(".row-status");
  if (!icon) return;
  icon.textContent = ok ? "✓" : "✕";
  icon.classList.remove("is-ok", "is-wrong");
  icon.classList.add(ok ? "is-ok" : "is-wrong");
}

function evaluateExercise(data) {
  clearMarks();
  mainEl.querySelectorAll(".quiz-row, .sc-row").forEach((row) => row.classList.remove("gap-ok", "gap-wrong"));
  let total = 0;
  let correct = 0;

  const idToCfg = new Map();

  const register = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const c of arr) {
      if (c && c.id) idToCfg.set(c.id, c);
    }
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

  for (const inp of mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]')) {
    const seqEl = inp.closest(".sequence-block");
    const ignoreCase = seqEl?.getAttribute("data-ignore-case") === "1";
    const id = inp.getAttribute("data-id");
    const cfg = idToCfg.get(id);
    if (!cfg) continue;
    const ok = gapMatches(inp.value, cfg, ignoreCase);
    setControlState(inp, ok);
    total++;
    if (ok) correct++;
  }

  for (const sel of mainEl.querySelectorAll("select.hl-dropdown")) {
    const id = sel.getAttribute("data-id");
    const cfg = idToCfg.get(id);
    if (!cfg) continue;
    const opt = sel.selectedOptions[0];
    const ok = opt && opt.value && opt.getAttribute("data-correct") === "1";
    setControlState(sel, ok);
    total++;
    if (ok) correct++;
  }

  for (const row of mainEl.querySelectorAll(".quiz-row, .sc-row")) {
    const seqEl = row.closest(".sequence-block");
    const ignoreCase = seqEl?.getAttribute("data-ignore-case") === "1";
    const qid = row.getAttribute("data-question-id");
    const cfg = qid ? idToCfg.get(qid) : null;
    if (!cfg) continue;
    const checked = row.querySelector('input[type="radio"]:checked');
    const correctText = normGap(stripHtml(cfg.correctAnswer), ignoreCase);
    const picked = checked ? normGap(checked.value, ignoreCase) : "";
    const ok = picked && picked === correctText;
    setRowState(row, ok);
    total++;
    if (ok) correct++;
  }
  setScoreText(correct, total);
}

function showAllAnswers(data) {
  clearMarks();
  mainEl.querySelectorAll(".quiz-row, .sc-row").forEach((row) => row.classList.remove("gap-ok", "gap-wrong"));
  const idToCfg = new Map();
  const register = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const c of arr) {
      if (c && c.id) idToCfg.set(c.id, c);
    }
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

  for (const inp of mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]')) {
    const cfg = idToCfg.get(inp.getAttribute("data-id"));
    if (cfg) inp.value = stripHtml(String(cfg.correctAnswer ?? ""));
    setControlState(inp, true);
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
    setControlState(sel, true);
  }

  for (const row of mainEl.querySelectorAll(".quiz-row, .sc-row")) {
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
    setRowState(row, true);
  }
  const total = countScorableItems();
  setScoreText(total, total);
}

function resetExercise() {
  for (const inp of mainEl.querySelectorAll('input[data-kind="gap"], input[data-kind="single-letter"]')) {
    inp.value = "";
  }
  for (const sel of mainEl.querySelectorAll("select.hl-dropdown")) {
    sel.value = "";
  }
  for (const radio of mainEl.querySelectorAll('input[type="radio"][data-kind="quiz"], input[type="radio"][data-kind="single-choice"]')) {
    radio.checked = false;
  }
  for (const area of mainEl.querySelectorAll("textarea.freewrite-area")) {
    area.value = "";
  }
  clearMarks();
  mainEl.querySelectorAll(".quiz-row, .sc-row").forEach((row) => row.classList.remove("gap-ok", "gap-wrong"));
  setScoreText(0, countScorableItems());
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

function wireFooter() {
  btnAnswer.onclick = () => {
    if (currentSession) evaluateExercise(currentSession.data);
  };
  btnShowAll.onclick = () => {
    if (currentSession) showAllAnswers(currentSession.data);
  };
  btnReset.onclick = () => {
    if (currentSession) resetExercise();
  };
  btnClose.onclick = () => {
    location.hash = "#/";
  };
}

async function route() {
  if (!courseIndex) await loadCourseIndex();
  const r = parseHashRoute();
  if (!r) {
    currentSession = null;
    renderToc();
    return;
  }
  await openExercise(r.unitId, r.exerciseId);
}

function init() {
  wireFooter();
  window.addEventListener("hashchange", () => route());
  route().catch((e) => {
    mainEl.innerHTML = `<p class="empty-toc">Failed to load: ${escapeHtml(e.message)}</p><p>Open this site via a local web server from the <strong>helbling</strong> project folder (not file://). Example: <code>npx serve .</code> then open <code>/viewer/</code>.</p>`;
    footerEl.hidden = true;
  });
}

init();
