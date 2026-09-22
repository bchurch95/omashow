// Audience window: borderless slide surface on the secondary monitor.
// Stays in sync with the presenter console via Tauri events; Esc or the
// console's present-exit event closes the window.

const invoke = (cmd, args = {}) => window.__TAURI__.core.invoke(cmd, args);
const canvas = document.getElementById("slide-canvas");
const laser = document.getElementById("laser");
const inkSvg = document.getElementById("ink-overlay");
const inkGroup = document.getElementById("ink-strokes");
const events = window.__TAURI__.event;
let slideDims = null;
let audCurrent = -1;

// Mirrors the console's INK_TOOL_STYLE — stroke width is a fraction of the
// slide width in the SVG's EMU viewBox, so both screens render identical
// relative line thickness.
const INK_TOOL_STYLE = {
  pen: { color: "#0f172a", widthFrac: 0.0022, opacity: 1 },
  marker: { color: "#ffd60a", widthFrac: 0.0085, opacity: 0.45 },
};
const audInk = new Map(); // slide index -> [{ tool, pts }]
let audLive = null; // { tool, pts, el } while a stroke is streaming in

function audPtsAttr(pts) {
  let s = "";
  for (let i = 0; i < pts.length; i += 2) {
    s += (pts[i] * slideDims.width_emu).toFixed(1) + "," + (pts[i + 1] * slideDims.height_emu).toFixed(1) + " ";
  }
  return s.trim();
}

function audStrokeEl(stroke) {
  const st = INK_TOOL_STYLE[stroke.tool];
  const el = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", st.color);
  el.setAttribute("stroke-width", (st.widthFrac * slideDims.width_emu).toFixed(0));
  el.setAttribute("opacity", st.opacity);
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  el.setAttribute("points", audPtsAttr(stroke.pts));
  return el;
}

function sizeInkOverlay() {
  // The canvas fills the window, but the slide itself only occupies the
  // top w x (w * slideH/slideW) box — the overlay must match that box.
  const w = canvas.clientWidth;
  const h = w * slideDims.height_emu / slideDims.width_emu;
  inkSvg.style.height = h + "px";
  inkSvg.setAttribute("viewBox", `0 0 ${slideDims.width_emu} ${slideDims.height_emu}`);
}

function audRenderInk(strokes) {
  if (!slideDims) return;
  sizeInkOverlay();
  inkGroup.innerHTML = "";
  for (const s of strokes || []) inkGroup.appendChild(audStrokeEl(s));
}

async function renderSlideAt(i) {
  const content = await invoke("get_slide_content", { slide: i });
  slideDims = content.slide_dimensions;
  audCurrent = i;
  renderSlideInto(canvas, content, false);
  audRenderInk(audInk.get(i) || []);
}

events.listen("slide-changed", (e) => {
  const p = e.payload;
  audInk.set(p.index, (p.ink || []).map((s) => ({ tool: s.tool, pts: [...s.pts] })));
  renderSlideAt(p.index).catch((err) =>
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

events.listen("ink", (e) => {
  const p = e.payload;
  if (!p || !slideDims) return;
  if (p.op === "begin") {
    audLive = { tool: p.tool, pts: [], el: null };
    audLive.el = audStrokeEl(audLive);
    inkGroup.appendChild(audLive.el);
  } else if (p.op === "point" && audLive) {
    audLive.pts.push(p.x, p.y);
    audLive.el.setAttribute("points", audPtsAttr(audLive.pts));
  } else if (p.op === "end" && audLive) {
    if (!audInk.has(audCurrent)) audInk.set(audCurrent, []);
    audInk.get(audCurrent).push({ tool: audLive.tool, pts: audLive.pts });
    audLive = null;
  } else if (p.op === "undo") {
    const list = audInk.get(audCurrent) || [];
    list.pop();
    audLive = null;
    audRenderInk(list);
  } else if (p.op === "clear") {
    audLive = null;
    audInk.set(audCurrent, []);
    audRenderInk([]);
  }
});

// Screen shutter from the presenter console: "black", "white" or "clear".
// The console holds the event while frozen, so the audience keeps the last
// projected frame.
events.listen("shutter", (e) => {
  const mode = e.payload && e.payload.mode;
  canvas.classList.toggle("blackout", mode === "black");
  canvas.classList.toggle("whiteout", mode === "white");
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
