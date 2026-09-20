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

// ---------- faithful slide rendering ----------
// One slide's shapes drawn into a positioned container, scaled from EMU
// slide coordinates: the filmstrip's .slide-thumb (mini) or #slide-stage.
const NON_SOLID_FILLS = new Set(["none", "gradient", "pattern", "image"]);

function renderSlideInto(container, content, mini = false) {
  container.querySelectorAll(".slide-shape,.slide-pic").forEach((el) => el.remove());
  const dims = content.slide_dimensions;
  const w = container.clientWidth || (mini ? 244 : 960);
  const pxPerEmu = w / dims.width_emu;
  const pxPerInch = pxPerEmu * 914400;
  drawShapes(container, content.shapes, pxPerEmu, pxPerInch, mini);
}

function drawShapes(container, shapes, pxPerEmu, pxPerInch, mini) {
  for (const sh of shapes) {
    if (sh.children) { drawShapes(container, sh.children, pxPerEmu, pxPerInch, mini); continue; }
    if (sh.kind === "picture") {
      if (!sh.bounds) continue;
      const pic = document.createElement("div");
      pic.className = "slide-pic";
      place(pic, sh.bounds, pxPerEmu);
      container.appendChild(pic);
      continue;
    }
    if (sh.kind !== "autoshape" || !sh.bounds) continue;
    const el = document.createElement("div");
    el.className = "slide-shape";
    place(el, sh.bounds, pxPerEmu);
    if (sh.fill && !NON_SOLID_FILLS.has(sh.fill)) el.style.background = sh.fill;
    if (sh.line && sh.line.color && sh.line.width_emu) {
      const bw = Math.max(mini ? 1 : 0.5, (sh.line.width_emu / 914400) * pxPerInch);
      el.style.border = bw + "px solid " + sh.line.color;
    }
    if (sh.runs.length) {
      const basePt = sh.placeholder === "title" || sh.placeholder === "ctrTitle" ? 28 : 18;
      el.style.fontSize = ptToPx(basePt, pxPerInch, mini);
      const aligned = sh.runs.find((r) => r.alignment);
      if (aligned) el.style.textAlign = aligned.alignment;
      appendRuns(el, sh.runs, pxPerInch, mini);
    }
    container.appendChild(el);
  }
}

function ptToPx(pt, pxPerInch, mini) {
  const px = (pt / 72) * pxPerInch;
  return (mini ? Math.max(4, Math.min(16, px)) : px) + "px";
}

function place(el, b, pxPerEmu) {
  el.style.left = b.x_emu * pxPerEmu + "px";
  el.style.top = b.y_emu * pxPerEmu + "px";
  el.style.width = b.width_emu * pxPerEmu + "px";
  el.style.height = b.height_emu * pxPerEmu + "px";
}

function appendRuns(el, runs, pxPerInch, mini = false) {
  let para = 0;
  for (const r of runs) {
    if (r.paragraph !== para) {
      el.appendChild(document.createElement("br"));
      para = r.paragraph;
    }
    if (r.text === "\n") {
      el.appendChild(document.createElement("br"));
      continue;
    }
    const s = document.createElement("span");
    s.textContent = r.text;
    if (r.bold) s.style.fontWeight = "700";
    if (r.italic) s.style.fontStyle = "italic";
    if (r.color) s.style.color = r.color;
    // Explicit sans fallback: an unknown family (e.g. Calibri on Linux) would
    // otherwise degrade to the browser's default serif.
    if (r.font_family) s.style.fontFamily = r.font_family + ", system-ui, sans-serif";
    if (r.font_size_pt) s.style.fontSize = ptToPx(r.font_size_pt, pxPerInch, mini);
    el.appendChild(s);
  }
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
  const presenting = document.body.classList.contains("presenting");
  const availW = presenting ? window.innerWidth : Math.max(100, $("preview-wrap").clientWidth - 56);
  const availH = presenting ? window.innerHeight : Math.max(100, $("preview-wrap").clientHeight - 56);
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
}
function exitPresent() {
  document.body.classList.remove("presenting");
  document.body.classList.remove("chrome-visible");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
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
        })
        .catch((e) => flash(String(e), "err"));
    }, 400);
    input.addEventListener("input", commit);
    input.addEventListener("blur", () => commit());

    cap.append(idx, input);
    item.append(thumb, cap);
    item.addEventListener("click", () => selectSlide(i));
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
  document.querySelectorAll(".slide-item").forEach((el, j) => {
    el.classList.toggle("active", j === i);
  });
  const active = document.querySelectorAll(".slide-item")[i];
  if (active) active.scrollIntoView({ block: "nearest" });
  paintCurrentSlide();
  updatePreview();
}

function applyModel(data, selectLast = false) {
  model = typeof data === "string" ? JSON.parse(data) : data;
  $("doc-title").textContent = model.title || "";
  markState("");
  if (selectLast) currentSlide = model.slides.length - 1;
  if (currentSlide >= model.slides.length) currentSlide = model.slides.length - 1;
  renderFilmstrip();
  refreshThumbs();
  paintCurrentSlide();
  if (currentSlide < 0) clearSlideCounter();
  else updatePreview();
  hasDeck();
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
$("btn-present").onclick = enterPresent;
syncZoomUI();
const addSlide = () => {
  invoke("add_slide", { title: null })
    .then((m) => {
      applyModel(m, true);
      markState("edited");
      flash("slide added");
      const items = document.querySelectorAll(".slide-item");
      const last = items[items.length - 1];
      if (last) last.querySelector("input").focus();
    })
    .catch((e) => flash(String(e), "err"));
};
$("btn-add").onclick = addSlide;

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
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
  if (presenting() && (e.key === "Escape" || e.key.toLowerCase() === "q")) {
    e.preventDefault();
    exitPresent();
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

hasDeck();
