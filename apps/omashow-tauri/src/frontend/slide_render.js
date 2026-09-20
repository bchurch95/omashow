// Faithful slide rendering, shared by the editor (main.js) and the audience
// window (audience.js). One slide's shapes are drawn into a positioned
// container, scaled from EMU slide coordinates: a filmstrip .slide-thumb,
// the main #slide-stage, or the audience #slide-canvas.

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
    el.dataset.shapeId = sh.id;
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
