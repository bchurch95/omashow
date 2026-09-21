// Audience window: slide surface on the secondary monitor (or preview window).
// Stays in sync with the presenter console via Tauri events; Esc or the
// console's present-exit event closes the window.

const invoke = (cmd, args = {}) => window.__TAURI__.core.invoke(cmd, args);
const canvas = document.getElementById("slide-canvas");
const events = window.__TAURI__.event;
let lastContent = null;

function fitAudienceCanvas(dims) {
  if (!dims) return;
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  let w = availW;
  let h = (w * dims.height_emu) / dims.width_emu;
  if (h > availH) {
    h = availH;
    w = (h * dims.width_emu) / dims.height_emu;
  }
  canvas.style.width = Math.floor(w) + "px";
  canvas.style.height = Math.floor(h) + "px";
}

async function loadSlide(index) {
  try {
    const content = await invoke("get_slide_content", { slide: index });
    lastContent = content;
    fitAudienceCanvas(content.slide_dimensions);
    renderSlideInto(canvas, content, false);
  } catch (err) {
    console.error("audience: failed to render slide", err);
  }
}

if (events) {
  events.listen("slide-changed", (e) => {
    if (e.payload && typeof e.payload.index === "number") {
      loadSlide(e.payload.index);
    }
  });

  events.listen("blackout-toggle", (e) => {
    canvas.classList.toggle("blackout", !!e.payload.on);
  });

  events.listen("present-exit", () => {
    invoke("close_audience_window").catch(() => {});
  });

  // Announce readiness so main window emits current slide immediately
  events.emit("audience-ready", {}).catch(() => {});
}

// Keep canvas letterboxed/pillarboxed on resize
window.addEventListener("resize", () => {
  if (lastContent) {
    fitAudienceCanvas(lastContent.slide_dimensions);
    renderSlideInto(canvas, lastContent, false);
  }
});

// Keyboard controls if audience window receives focus
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" || e.key.toLowerCase() === "q") {
    e.preventDefault();
    if (events) events.emit("present-exit", {}).catch(() => {});
  } else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " " || e.key === "Enter") {
    if (events) events.emit("present-next", {}).catch(() => {});
  } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
    if (events) events.emit("present-prev", {}).catch(() => {});
  }
});

// Hide cursor after 2.5s of inactivity
let cursorTimer = null;
window.addEventListener("mousemove", () => {
  document.body.classList.add("show-cursor");
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.remove("show-cursor"), 2500);
});
