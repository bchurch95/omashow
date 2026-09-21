// Audience window: borderless slide surface on the secondary monitor.
// Stays in sync with the presenter console via Tauri events; Esc or the
// console's present-exit event closes the window.

const invoke = (cmd, args = {}) => window.__TAURI__.core.invoke(cmd, args);
const canvas = document.getElementById("slide-canvas");
const laser = document.getElementById("laser");
const events = window.__TAURI__.event;
let slideDims = null;

async function renderSlideAt(i) {
  const content = await invoke("get_slide_content", { slide: i });
  slideDims = content.slide_dimensions;
  renderSlideInto(canvas, content, false);
}

events.listen("slide-changed", (e) => {
  renderSlideAt(e.payload.index).catch((err) =>
    console.error("audience: failed to render slide", err)
  );
});

// The window may open after the presenter already advanced — pull the
// current slide on load so the audience never starts blank.
invoke("get_current_slide")
  .then(renderSlideAt)
  .catch((err) => console.error("audience: no current slide", err));

events.listen("laser-move", (e) => {
  const p = e.payload;
  if (!p || !p.on) { laser.style.display = "none"; return; }
  if (!slideDims) return;
  // Same scale renderSlideInto uses: canvas width spans the slide width.
  const w = canvas.clientWidth;
  const h = w * slideDims.height_emu / slideDims.width_emu;
  laser.style.left = p.x * w + "px";
  laser.style.top = p.y * h + "px";
  laser.style.display = "block";
});

events.listen("blackout-toggle", (e) => {
  canvas.classList.toggle("blackout", !!e.payload.on);
});

events.listen("present-exit", () => {
  invoke("close_audience_window").catch(() => {});
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    events.emit("present-exit", {}).catch(() => {});
  }
});
