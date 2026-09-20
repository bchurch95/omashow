// Audience window: borderless slide surface on the secondary monitor.
// Stays in sync with the presenter console via Tauri events; Esc or the
// console's present-exit event closes the window.

const invoke = (cmd, args = {}) => window.__TAURI__.core.invoke(cmd, args);
const canvas = document.getElementById("slide-canvas");
const events = window.__TAURI__.event;

events.listen("slide-changed", async (e) => {
  try {
    const content = await invoke("get_slide_content", { slide: e.payload.index });
    renderSlideInto(canvas, content, false);
  } catch (err) {
    console.error("audience: failed to render slide", err);
  }
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
