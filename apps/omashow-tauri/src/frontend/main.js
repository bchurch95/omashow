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
    if (r.font_family) s.style.fontFamily = r.font_family;
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

// Fit #slide-canvas into #preview-wrap at the slide's true aspect ratio.
function fitCanvas() {
  const wrap = $("preview-wrap");
  const pad = 56; // 28px padding per side
  const availW = Math.max(100, wrap.clientWidth - pad);
  const availH = Math.max(100, wrap.clientHeight - pad);
  const d = slideDimensions();
  let w = availW;
  let h = (w * d.height_emu) / d.width_emu;
  if (h > availH) { h = availH; w = (h * d.width_emu) / d.height_emu; }
  const canvas = $("slide-canvas");
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
}

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

    const num = document.createElement("span");
    num.className = "slide-num";
    num.textContent = i + 1;

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

    thumb.append(num, del);

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
        })
        .catch((e) => flash(String(e), "err"));
    }, 400);
    input.addEventListener("input", commit);
    input.addEventListener("blur", () => commit());

    item.append(thumb, input);
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
  if (selectLast) currentSlide = model.slides.length - 1;
  if (currentSlide >= model.slides.length) currentSlide = model.slides.length - 1;
  renderFilmstrip();
  refreshThumbs();
  paintCurrentSlide();
  updatePreview();
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
    .then((p) => { setPath(p); flash("saved"); })
    .catch((e) => flash(String(e), "err"));
};

$("btn-saveas").onclick = async () => {
  if (!model) { flash("nothing to save", "err"); return; }
  try {
    const path = await invoke("save_file_dialog");
    if (!path) return;
    const p = await invoke("save_as", { path });
    setPath(p);
    flash("saved");
  } catch (e) { flash(String(e), "err"); }
};

$("btn-add").onclick = () => {
  invoke("add_slide", { title: null })
    .then((m) => {
      applyModel(m, true);
      flash("slide added");
      const items = document.querySelectorAll(".slide-item");
      const last = items[items.length - 1];
      if (last) last.querySelector("input").focus();
    })
    .catch((e) => flash(String(e), "err"));
};

// notes editor — live, debounced
const commitNotes = debounce(() => {
  if (!model || currentSlide < 0) return;
  const val = $("notes-input").value;
  const s = model.slides[currentSlide];
  if (val === (s.notes || "")) return;
  invoke("set_notes", { slide: currentSlide, notes: val || null })
    .then((m) => {
      model = JSON.parse(m);
      flash("notes saved");
    })
    .catch((e) => flash(String(e), "err"));
}, 500);
$("notes-input").addEventListener("input", commitNotes);

// ---------- keyboard: arrows switch slides ----------
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
  if (!model) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") {
    if (currentSlide < model.slides.length - 1) selectSlide(currentSlide + 1);
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
