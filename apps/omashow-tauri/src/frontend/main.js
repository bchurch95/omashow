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
  $("empty-msg").style.display = model ? "none" : "block";
  $("notes-bar").style.display = model && model.slides.length > 0 ? "block" : "none";
}

// ---------- thumbnail filmstrip ----------
// Per-slide shape content, fetched lazily from get_slide_content and cached
// here so the filmstrip can paint a scaled-down replica of each slide.
const slideContents = new Map();

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
    if (cached) paintThumb(thumb, cached);
  });
}

function fetchSlideContent(i, force = false) {
  if (!model || i < 0 || i >= model.slides.length) return;
  if (!force && slideContents.has(i)) return;
  invoke("get_slide_content", { slide: i })
    .then((content) => {
      slideContents.set(i, content);
      const item = document.querySelectorAll(".slide-item")[i];
      if (item) paintThumb(item.querySelector(".slide-thumb"), content);
    })
    .catch(() => {});
}

function refreshThumbs() {
  slideContents.clear();
  if (!model) return;
  model.slides.forEach((_, i) => fetchSlideContent(i));
}

// Paint a scaled-down copy of one slide into a .slide-thumb element.
function paintThumb(thumb, content) {
  thumb.querySelectorAll(".mini-shape,.mini-pic").forEach((el) => el.remove());
  const dims = content.slide_dimensions;
  thumb.style.aspectRatio = dims.width_emu + " / " + dims.height_emu;
  const w = thumb.clientWidth || 244;
  const pxPerEmu = w / dims.width_emu;
  const pxPerInch = pxPerEmu * 914400;

  const draw = (shapes) => {
    for (const sh of shapes) {
      if (sh.children) { draw(sh.children); continue; }
      if (sh.kind === "picture") {
        if (!sh.bounds) continue;
        const pic = document.createElement("div");
        pic.className = "mini-pic";
        place(pic, sh.bounds, pxPerEmu);
        thumb.appendChild(pic);
        continue;
      }
      if (sh.kind !== "autoshape" || !sh.bounds || !sh.runs.length) continue;
      const el = document.createElement("div");
      el.className = "mini-shape";
      place(el, sh.bounds, pxPerEmu);
      const basePt = sh.placeholder === "title" || sh.placeholder === "ctrTitle" ? 28 : 18;
      el.style.fontSize = clampPx((basePt / 72) * pxPerInch);
      if (sh.runs[0].color) el.style.color = sh.runs[0].color;
      appendRuns(el, sh.runs, pxPerInch);
      thumb.appendChild(el);
    }
  };
  draw(content.shapes);
}

function place(el, b, pxPerEmu) {
  el.style.left = b.x_emu * pxPerEmu + "px";
  el.style.top = b.y_emu * pxPerEmu + "px";
  el.style.width = b.width_emu * pxPerEmu + "px";
  el.style.height = b.height_emu * pxPerEmu + "px";
}

function clampPx(px) {
  return Math.max(4, Math.min(16, px)) + "px";
}

function appendRuns(el, runs, pxPerInch) {
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
    if (r.font_size_pt) s.style.fontSize = clampPx((r.font_size_pt / 72) * pxPerInch);
    el.appendChild(s);
  }
}

function updatePreview() {
  if (!model || currentSlide < 0 || currentSlide >= model.slides.length) return;
  const s = model.slides[currentSlide];
  const titleEl = $("slide-title-preview");
  if (titleEl.textContent !== (s.title || "")) {
    titleEl.textContent = s.title || "";
  }
  $("slide-notes-preview").textContent = s.notes || "";
  const notes = $("notes-input");
  if (document.activeElement !== notes) {
    notes.value = s.notes || "";
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
  updatePreview();
}

function applyModel(data, selectLast = false) {
  model = typeof data === "string" ? JSON.parse(data) : data;
  if (selectLast) currentSlide = model.slides.length - 1;
  if (currentSlide >= model.slides.length) currentSlide = model.slides.length - 1;
  renderFilmstrip();
  refreshThumbs();
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
      $("slide-notes-preview").textContent = model.slides[currentSlide].notes || "";
      flash("notes saved");
    })
    .catch((e) => flash(String(e), "err"));
}, 500);
$("notes-input").addEventListener("input", commitNotes);

// editable title on the slide canvas itself
const titleEl = $("slide-title-preview");
titleEl.contentEditable = "true";
titleEl.addEventListener("blur", () => {
  if (!model || currentSlide < 0) return;
  const val = titleEl.textContent.trim();
  const s = model.slides[currentSlide];
  if (val === (s.title || "")) {
    titleEl.textContent = s.title || "";
    return;
  }
  invoke("set_title", { slide: currentSlide, title: val })
    .then((m) => {
      model = JSON.parse(m);
      renderFilmstrip();
      fetchSlideContent(currentSlide, true);
      updatePreview();
      flash("title saved");
    })
    .catch((e) => { flash(String(e), "err"); updatePreview(); });
});
titleEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); }
});

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

// Re-paint thumbnails when the window resizes (font scaling is px-based).
let resizeT = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (!model) return;
    document.querySelectorAll(".slide-item").forEach((item, i) => {
      const cached = slideContents.get(i);
      if (cached) paintThumb(item.querySelector(".slide-thumb"), cached);
    });
  }, 200);
});

hasDeck();
