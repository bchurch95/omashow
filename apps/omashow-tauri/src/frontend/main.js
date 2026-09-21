// Omashow frontend — talks to the Rust core via Tauri commands.
// The Rust side owns the full Presentation; we only ever see its
// lightweight JSON projection and send back small edits.

const $ = (id) => document.getElementById(id);
const invoke = (cmd, args = {}) => window.__TAURI__.core.invoke(cmd, args);

let model = null;          // current PresentationModel projection
let currentSlide = -1;     // selected slide index
let filePath = null;

// ---------- helpers ----------
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function flash(msg, cls = "ok") {
  const el = $("status-msg");
  el.textContent = msg;
  el.className = cls;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.textContent = ""; }, 4000);
}

function setPath(p) {
  filePath = p;
  $("status-path").textContent = p ? p : "no file (unsaved)";
}

function markState(s) {
  const el = $("doc-state");
  el.textContent = s;
  el.classList.toggle("edited", s === "edited");
}

function updateNotesCount() {
  const v = $("notes-input").value.trim();
  $("notes-count").textContent = v ? v.split(/\s+/).length + " words" : "";
}

// ---------- rendering ----------
function hasDeck() {
  $("empty-msg").style.display = model ? "none" : "flex";
  $("notes-bar").style.display = model && model.slides.length > 0 ? "block" : "none";
}

// ---------- slide content cache ----------
// Per-slide shape content, fetched lazily from get_slide_content and cached
// here so both the filmstrip and the canvas can paint from it.
const slideContents = new Map();

function slideDimensions() {
  if (currentSlide >= 0) {
    const cached = slideContents.get(currentSlide);
    if (cached) return cached.slide_dimensions;
  }
  if (model && model.slide_dimensions) return model.slide_dimensions;
  return { width_emu: 12_192_000, height_emu: 6_858_000 };
}

let zoomMode = "fit"; // "fit" | percent string ("25".."200"), 100% = 96 CSS px/in
let lastFitPct = null; // effective percentage of the last "fit" layout

// Fit #slide-canvas into #preview-wrap (or the whole window while presenting)
// at the slide's true aspect ratio, or render at an explicit zoom percentage.
function fitCanvas() {
  const d = slideDimensions();
  const canvas = $("slide-canvas");
  if (zoomMode !== "fit") {
    const pct = (parseFloat(zoomMode) || 100) / 100;
    canvas.style.width = (d.width_emu / 914400) * 96 * pct + "px";
    canvas.style.height = (d.height_emu / 914400) * 96 * pct + "px";
    return;
  }
  // While presenting, #preview-wrap already shrinks to make room for the
  // console side panel, so its box is the right reference in both modes.
  const availW = Math.max(100, $("preview-wrap").clientWidth - 56);
  const availH = Math.max(100, $("preview-wrap").clientHeight - 56);
  let w = availW;
  let h = (w * d.height_emu) / d.width_emu;
  if (h > availH) { h = availH; w = (h * d.width_emu) / d.height_emu; }
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  lastFitPct = Math.round((w / ((d.width_emu / 914400) * 96)) * 100);
  syncZoomUI();
}

function setZoom(mode) {
  zoomMode = mode;
  if (currentSlide >= 0) paintCurrentSlide();
}

// ---------- present mode: fullscreen slideshow on this screen ----------
function presenting() { return document.body.classList.contains("presenting"); }

let presentHideTimer = null;
function enterPresent() {
  if (!model || currentSlide < 0) { flash("open a deck first", "err"); return; }
  document.body.classList.add("presenting");
  const host = $("main");
  if (host.requestFullscreen) host.requestFullscreen().catch(() => {});
  paintCurrentSlide();
  updateConsole();
  startTimer();
}
function exitPresent() {
  document.body.classList.remove("presenting");
  document.body.classList.remove("chrome-visible");
  stopTimer();
  laserTool = false;
  laserCtrl = false;
  $("btn-laser").classList.remove("on");
  emitToAudience("laser-move", { on: false });
  invoke("close_audience_window").catch(() => {});
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// ---------- presenter console: next slide, notes, timer ----------
let presentStart = 0;
let timerInt = null;
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const mm = String(m).padStart(2, "0"), sec = String(ss).padStart(2, "0");
  return h ? h + ":" + mm + ":" + sec : mm + ":" + sec;
}
function tickTimer() {
  $("timer-elapsed").textContent = fmtElapsed(Date.now() - presentStart);
  $("timer-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function startTimer() {
  presentStart = Date.now();
  tickTimer();
  clearInterval(timerInt);
  timerInt = setInterval(tickTimer, 1000);
}
function stopTimer() {
  clearInterval(timerInt);
  timerInt = null;
}

function updateConsole() {
  if (!model) return;
  $("console-notes").textContent = currentSlide >= 0 ? (model.slides[currentSlide].notes || "") : "";
  if (currentSlide < 0) { $("next-label").textContent = "—"; return; }
  const next = currentSlide + 1;
  if (next < model.slides.length) {
    const t = model.slides[next].title;
    $("next-label").textContent = "Slide " + (next + 1) + (t ? " — " + t : "");
    fetchSlideContent(next);
    const cached = slideContents.get(next);
    if (cached) renderSlideInto($("next-thumb"), cached, true);
  } else {
    $("next-label").textContent = "End of deck";
  }
}

// ---------- audience window event sync ----------
function emitToAudience(event, payload) {
  const ev = window.__TAURI__ && window.__TAURI__.event;
  if (ev) ev.emit(event, payload).catch(() => {});
}
let blackedOut = false;
function toggleBlackout() {
  if (!presenting()) return;
  blackedOut = !blackedOut;
  emitToAudience("blackout-toggle", { on: blackedOut });
}

// ---------- laser pointer: dot on the audience screen follows the cursor ----------
// Cursor position is normalized against the #slide-canvas rect (which keeps
// the slide's aspect ratio), so the audience side can map it back to slide
// space regardless of its own size.
let laserTool = false;
let laserCtrl = false;
let lastPointer = null;
function laserActive() { return presenting() && (laserTool || laserCtrl); }
function sendLaser() {
  if (!presenting()) return;
  if (!laserActive() || !lastPointer) {
    emitToAudience("laser-move", { on: false });
    return;
  }
  const rect = $("slide-canvas").getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = Math.min(1, Math.max(0, (lastPointer.x - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (lastPointer.y - rect.top) / rect.height));
  emitToAudience("laser-move", { on: true, x, y });
}
function setLaserTool(on) {
  laserTool = on;
  $("btn-laser").classList.toggle("on", on);
  sendLaser();
}
document.addEventListener("pointermove", (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  sendLaser();
});

async function startPresentation() {
  if (!model || currentSlide < 0) { flash("open a deck first", "err"); return; }
  enterPresent();
  try {
    const name = await invoke("open_audience_window", { monitorName: null });
    flash("audience window on " + name);
  } catch (e) { flash(String(e), "err"); }
}

if (window.__TAURI__ && window.__TAURI__.event) {
  window.__TAURI__.event.listen("present-exit", () => exitPresent()).catch(() => {});
}
function nudgePresentChrome() {
  if (!presenting()) return;
  document.body.classList.add("chrome-visible");
  clearTimeout(presentHideTimer);
  presentHideTimer = setTimeout(() => document.body.classList.remove("chrome-visible"), 2200);
}
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    document.body.classList.remove("presenting");
    document.body.classList.remove("chrome-visible");
  }
});
document.addEventListener("mousemove", nudgePresentChrome);
$("slide-canvas").addEventListener("click", () => {
  if (!presenting()) return;
  if (currentSlide < model.slides.length - 1) selectSlide(currentSlide + 1);
  else exitPresent();
});

function fetchSlideContent(i, force = false) {
  if (!model || i < 0 || i >= model.slides.length) return;
  if (!force && slideContents.has(i)) return;
  invoke("get_slide_content", { slide: i })
    .then((content) => {
      slideContents.set(i, content);
      paintSlide(i, content);
    })
    .catch(() => {});
}

function refreshThumbs() {
  slideContents.clear();
  if (!model) return;
  model.slides.forEach((_, i) => fetchSlideContent(i));
}

function paintSlide(i, content) {
  const item = document.querySelectorAll(".slide-item")[i];
  if (item) renderSlideInto(item.querySelector(".slide-thumb"), content, true);
  if (i === currentSlide) {
    fitCanvas();
    renderSlideInto($("slide-stage"), content, false);
  }
  if (i === currentSlide + 1) renderSlideInto($("next-thumb"), content, true);
  updateInspector();
}

// ---------- inspector: read-only slide facts ----------
function countShapes(shapes) {
  let n = 0;
  for (const s of shapes || []) { n += 1; if (s.children) n += countShapes(s.children); }
  return n;
}

function setIns(id, val) {
  const el = $(id);
  el.textContent = val;
  el.title = val;
}
function updateInspector() {
  const d = slideDimensions();
  $("insp-size").textContent = (d.width_emu / 914400).toFixed(2) + " × " + (d.height_emu / 914400).toFixed(2) + " in";
  if (!model || currentSlide < 0) {
    setIns("insp-pos", "–");
    setIns("insp-shapes", "–");
    setIns("insp-title", "–");
    return;
  }
  setIns("insp-pos", (currentSlide + 1) + " / " + model.slides.length);
  setIns("insp-title", model.slides[currentSlide].title || "—");
  const content = slideContents.get(currentSlide);
  setIns("insp-shapes", content ? String(countShapes(content.shapes)) : "…");
}

function paintCurrentSlide() {
  if (currentSlide < 0) return;
  const cached = slideContents.get(currentSlide);
  if (cached) paintSlide(currentSlide, cached);
  else fetchSlideContent(currentSlide);
}

// ---------- filmstrip ----------
let dragFrom = -1;
function renderFilmstrip() {
  const list = $("slides");
  list.innerHTML = "";
  if (!model) return;
  model.slides.forEach((s, i) => {
    const item = document.createElement("div");
    item.className = "slide-item" + (i === currentSlide ? " active" : "");

    const thumb = document.createElement("div");
    thumb.className = "slide-thumb";

    const del = document.createElement("button");
    del.className = "slide-del";
    del.textContent = "\u00d7";
    del.title = "Delete slide";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      invoke("delete_slide", { slide: i })
        .then((m) => {
          model = JSON.parse(m);
          currentSlide = Math.min(currentSlide, model.slides.length - 1);
          renderFilmstrip();
          refreshThumbs();
          updatePreview();
          flash("slide deleted");
        })
        .catch((err) => flash(String(err), "err"));
    });

    thumb.append(del);

    const cap = document.createElement("div");
    cap.className = "slide-cap";
    const idx = document.createElement("span");
    idx.className = "slide-idx";
    idx.textContent = i + 1;

    const input = document.createElement("input");
    input.className = "slide-title";
    input.value = s.title || "";
    input.placeholder = "(no title)";
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("focus", () => selectSlide(i));
    const commit = debounce(() => {
      if (input.value === (s.title || "")) return;
      invoke("set_title", { slide: i, title: input.value })
        .then((m) => {
          model = JSON.parse(m);
          renderFilmstrip();
          if (i === currentSlide) updatePreview();
          fetchSlideContent(i, true);
          flash("title saved");
          markState("edited");
          refreshUndoUI();
        })
        .catch((e) => flash(String(e), "err"));
    }, 400);
    input.addEventListener("input", commit);
    input.addEventListener("blur", () => commit());

    cap.append(idx, input);
    item.append(thumb, cap);
    item.addEventListener("click", () => selectSlide(i));

    // drag & drop reorder: grab a thumb, drop it on another slide
    item.draggable = true;
    item.addEventListener("dragstart", (e) => {
      if (e.target.closest("input,button")) { e.preventDefault(); return; }
      dragFrom = i;
      e.dataTransfer.effectAllowed = "move";
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      dragFrom = -1;
      item.classList.remove("dragging");
      list.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    });
    item.addEventListener("dragover", (e) => {
      if (dragFrom < 0 || dragFrom === i) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragFrom < 0 || dragFrom === i) return;
      const from = dragFrom;
      dragFrom = -1;
      item.classList.remove("drag-over");
      const follow = currentSlide === from;
      invoke("move_slide", { from, to: i })
        .then((m) => {
          if (follow) currentSlide = i;
          model = JSON.parse(m);
          renderFilmstrip();
          refreshThumbs();
          paintCurrentSlide();
          updatePreview();
          refreshUndoUI();
          markState("edited");
          flash("slide moved");
        })
        .catch((err) => flash(String(err), "err"));
    });
    list.appendChild(item);

    const cached = slideContents.get(i);
    if (cached) renderSlideInto(thumb, cached, true);
  });
}

// ---------- selection ----------
function updatePreview() {
  if (!model || currentSlide < 0 || currentSlide >= model.slides.length) return;
  const notes = $("notes-input");
  if (document.activeElement !== notes) {
    notes.value = model.slides[currentSlide].notes || "";
  }
  updateNotesCount();
  $("status-slide").textContent = (currentSlide + 1) + " / " + model.slides.length;
}

function clearSlideCounter() {
  $("status-slide").textContent = "";
}

function selectSlide(i) {
  if (i === currentSlide) { updatePreview(); return; }
  currentSlide = i;
  if (i >= 0) invoke("set_current_slide", { slide: i }).catch(() => {});
  document.querySelectorAll(".slide-item").forEach((el, j) => {
    el.classList.toggle("active", j === i);
  });
  const active = document.querySelectorAll(".slide-item")[i];
  if (active) active.scrollIntoView({ block: "nearest" });
  paintCurrentSlide();
  updatePreview();
  updateConsole();
  emitToAudience("slide-changed", { index: i });
}

function applyModel(data, selectLast = false) {
  model = typeof data === "string" ? JSON.parse(data) : data;
  $("doc-title").textContent = model.title || "";
  markState("");
  if (selectLast) currentSlide = model.slides.length - 1;
  if (currentSlide >= model.slides.length) currentSlide = model.slides.length - 1;
  if (currentSlide >= 0) invoke("set_current_slide", { slide: currentSlide }).catch(() => {});
  renderFilmstrip();
  refreshThumbs();
  paintCurrentSlide();
  if (currentSlide < 0) clearSlideCounter();
  else updatePreview();
  updateConsole();
  hasDeck();
  refreshUndoUI();
}

// ---------- actions ----------
$("btn-new").onclick = () => {
  invoke("new_presentation")
    .then((m) => {
      currentSlide = -1;
      applyModel(m);
      setPath(null);
      flash("new deck");
    })
    .catch((e) => flash(String(e), "err"));
};

$("btn-open").onclick = async () => {
  try {
    const path = await invoke("open_file_dialog");
    if (!path) return;
    const p = await invoke("open_presentation", { path });
    currentSlide = 0;
    applyModel(p);
    setPath(path);
    flash("opened");
  } catch (e) { flash(String(e), "err"); }
};

$("btn-save").onclick = () => {
  if (!model) { flash("nothing to save", "err"); return; }
  invoke("save_pptx")
    .then((p) => { setPath(p); markState(""); flash("saved"); })
    .catch((e) => flash(String(e), "err"));
};

$("btn-saveas").onclick = async () => {
  if (!model) { flash("nothing to save", "err"); return; }
  try {
    const path = await invoke("save_file_dialog");
    if (!path) return;
    const p = await invoke("save_as", { path });
    setPath(p);
    markState("");
    flash("saved");
  } catch (e) { flash(String(e), "err"); }
};

const zoomRange = $("zoom-range");
const zoomPct = $("zoom-pct");
function syncZoomUI() {
  if (zoomMode === "fit") {
    zoomPct.textContent = lastFitPct ? lastFitPct + "%" : "Fit";
    zoomRange.value = "100";
  } else zoomPct.textContent = zoomMode + "%";
  $("zoom-fit").classList.toggle("on", zoomMode === "fit");
  $("zoom-100").classList.toggle("on", zoomMode === "100");
}
$("zoom-fit").onclick = () => { setZoom("fit"); syncZoomUI(); };
$("zoom-100").onclick = () => { setZoom("100"); syncZoomUI(); };
zoomRange.addEventListener("input", () => { setZoom(zoomRange.value); syncZoomUI(); });
$("notes-label").onclick = () => $("notes-bar").classList.toggle("collapsed");
$("btn-present").onclick = startPresentation;
$("btn-laser").onclick = () => setLaserTool(!laserTool);
syncZoomUI();
const addSlide = () => {
  const idx = Math.max(0, currentSlide + 1);
  invoke("add_slide_at", { index: idx, title: null })
    .then((m) => {
      applyModel(m);
      currentSlide = idx;
      renderFilmstrip();
      markState("edited");
      flash("slide added");
      const item = document.querySelectorAll(".slide-item")[idx];
      if (item) item.querySelector("input").focus();
    })
    .catch((e) => flash(String(e), "err"));
};
$("btn-add").onclick = addSlide;

// ---------- undo / redo ----------
function refreshUndoUI() {
  const u = $("btn-undo"), r = $("btn-redo");
  if (!model) { u.disabled = true; r.disabled = true; return; }
  invoke("undo_state")
    .then((s) => {
      u.disabled = !s.can_undo;
      u.title = s.can_undo ? "Undo: " + s.last + " (Ctrl+Z)" : "Nothing to undo";
      r.disabled = !s.can_redo;
    })
    .catch(() => {});
}
function doUndo() {
  invoke("undo_presentation")
    .then((m) => { applyModel(m); markState("edited"); flash("undone"); })
    .catch((e) => flash(String(e), "err"));
}
function doRedo() {
  invoke("redo_presentation")
    .then((m) => { applyModel(m); markState("edited"); flash("redone"); })
    .catch((e) => flash(String(e), "err"));
}
$("btn-undo").onclick = doUndo;
$("btn-redo").onclick = doRedo;

// ---------- text editing: double-click a shape to edit its text ----------
function findShapeById(shapes, id) {
  for (const s of shapes) {
    if (s.id === id) return s;
    if (s.children) {
      const hit = findShapeById(s.children, id);
      if (hit) return hit;
    }
  }
  return null;
}
const textEdit = $("text-edit");
let textEditCtx = null;
function openTextEdit(el) {
  if (presenting() || !model) return;
  const shapeId = Number(el.dataset.shapeId);
  if (!shapeId) return;
  const content = slideContents.get(currentSlide);
  const shape = content && findShapeById(content.shapes, shapeId);
  const initial = shape && shape.text != null ? shape.text : el.innerText;
  const canvas = $("slide-canvas").getBoundingClientRect();
  const r = el.getBoundingClientRect();
  textEditCtx = { slide: currentSlide, shapeId, initial };
  textEdit.value = initial;
  textEdit.style.left = (r.left - canvas.left) + "px";
  textEdit.style.top = (r.top - canvas.top) + "px";
  textEdit.style.width = r.width + "px";
  textEdit.style.height = r.height + "px";
  textEdit.style.fontSize = getComputedStyle(el).fontSize;
  textEdit.style.display = "block";
  textEdit.focus();
  textEdit.select();
}
function closeTextEdit(commit) {
  if (!textEditCtx) return;
  const ctx = textEditCtx;
  textEditCtx = null;
  textEdit.style.display = "none";
  const val = textEdit.value;
  if (!commit || val === ctx.initial) return;
  invoke("update_text_run", { slide: ctx.slide, shapeId: ctx.shapeId, newText: val })
    .then(() => {
      fetchSlideContent(ctx.slide, true);
      markState("edited");
      refreshUndoUI();
      flash("text updated");
    })
    .catch((e) => flash(String(e), "err"));
}
textEdit.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); closeTextEdit(true); }
  else if (e.key === "Escape") { e.preventDefault(); closeTextEdit(false); }
});
textEdit.addEventListener("blur", () => closeTextEdit(true));
$("slide-stage").addEventListener("dblclick", (e) => {
  const el = e.target.closest(".slide-shape[data-shape-id]");
  if (el) openTextEdit(el);
});

// notes editor — live, debounced
const commitNotes = debounce(() => {
  if (!model || currentSlide < 0) return;
  const val = $("notes-input").value;
  const s = model.slides[currentSlide];
  if (val === (s.notes || "")) return;
  invoke("set_notes", { slide: currentSlide, notes: val || null })
    .then((m) => {
      model = JSON.parse(m);
      markState("");
      flash("notes saved");
      updateConsole();
      refreshUndoUI();
    })
    .catch((e) => flash(String(e), "err"));
}, 500);
const notesInput = $("notes-input");
notesInput.addEventListener("input", () => {
  notesInput.style.height = "auto";
  notesInput.style.height = Math.min(notesInput.scrollHeight, 120) + "px";
  markState("edited");
  updateNotesCount();
  commitNotes();
});

// ---------- keyboard: arrows switch slides, Esc ends the show ----------
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) {
    if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
      e.preventDefault();
      if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") doRedo();
      else doUndo();
      return;
    }
  }
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
  if (presenting() && (e.key === "Escape" || e.key.toLowerCase() === "q")) {
    e.preventDefault();
    exitPresent();
    return;
  }
  if (presenting() && e.key === "Control" && !e.repeat) {
    laserCtrl = true;
    sendLaser();
    return;
  }
  if (e.key === "F5") {
    e.preventDefault();
    if (!presenting()) startPresentation();
    return;
  }
  if (presenting() && e.key.toLowerCase() === "b") {
    e.preventDefault();
    toggleBlackout();
    return;
  }
  if (!model) return;
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " " || e.key === "Enter") {
    if (currentSlide < model.slides.length - 1) selectSlide(currentSlide + 1);
    else if (presenting()) exitPresent();
  } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
    if (currentSlide > 0) selectSlide(currentSlide - 1);
  }
});

document.addEventListener("keyup", (e) => {
  if (presenting() && e.key === "Control") {
    laserCtrl = false;
    sendLaser();
  }
});

// Re-fit the canvas and re-paint slides when the window resizes.
let resizeT = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (!model) return;
    document.querySelectorAll(".slide-item").forEach((item, i) => {
      const cached = slideContents.get(i);
      if (cached) renderSlideInto(item.querySelector(".slide-thumb"), cached, true);
    });
    paintCurrentSlide();
  }, 200);
});

// Launched with a file argument? Open that deck once the UI is up.
invoke("initial_deck_path").then((p) => {
  if (!p) return;
  invoke("open_presentation", { path: p })
    .then((sum) => { currentSlide = 0; applyModel(sum); setPath(p); flash("opened"); })
    .catch((e) => flash(String(e), "err"));
}).catch(() => {});

hasDeck();
