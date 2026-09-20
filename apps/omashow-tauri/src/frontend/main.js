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

function renderSlides() {
  const list = $("slides");
  list.innerHTML = "";
  if (!model) return;
  model.slides.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "slide-row" + (i === currentSlide ? " active" : "");

    const num = document.createElement("div");
    num.className = "slide-num";
    num.textContent = i + 1;

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
          if (i === currentSlide) updatePreview();
          flash("title saved");
        })
        .catch((e) => flash(String(e), "err"));
    }, 400);
    input.addEventListener("input", commit);
    input.addEventListener("blur", () => commit());

    const del = document.createElement("button");
    del.className = "slide-del";
    del.textContent = "×";
    del.title = "Delete slide";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      invoke("delete_slide", { slide: i })
        .then((m) => {
          model = JSON.parse(m);
          currentSlide = Math.min(currentSlide, model.slides.length - 1);
          renderSlides();
          updatePreview();
          flash("slide deleted");
        })
        .catch((err) => flash(String(err), "err"));
    });

    row.append(num, input, del);
    row.addEventListener("click", () => selectSlide(i));
    list.appendChild(row);
  });
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
  renderSlides();
  updatePreview();
}

function applyModel(json, selectLast = false) {
  model = JSON.parse(json);
  if (selectLast) currentSlide = model.slides.length - 1;
  if (currentSlide >= model.slides.length) currentSlide = model.slides.length - 1;
  renderSlides();
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
    const m = await invoke("open_pptx", { path });
    currentSlide = 0;
    applyModel(m);
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
      const rows = document.querySelectorAll(".slide-row");
      const last = rows[rows.length - 1];
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
      renderSlides();
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

hasDeck();
