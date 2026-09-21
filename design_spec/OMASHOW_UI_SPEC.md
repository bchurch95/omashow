# OmaShow UI & Architectural Specification
*Derived from the Official OmaShow Preview ("Bring the Joy") Demo Video*

This specification captures the exact visual layout, interaction paradigms, and feature set demonstrated in the OmaShow video preview. The autonomous loop and core developers should treat this document and the accompanying screenshots in `design_spec/screenshots/` as the ground truth target.

---

## 1. Application Shell & Mode Tabs

At the top of the interface, above the main content, sits the global title bar and top-level navigation:

### 1.1 Native Menu Bar
- **Menus**: `File`, `Edit`, `Insert`, `Slide`, `Format`, `Arrange`, `View`, `Present`, `Help`
- **Top Right Shortcut**: `Ctrl+Z Format chart` (or dynamic last-action undo indicator)

### 1.2 The Seven Primary Modes
Centered in the top bar are the 7 primary application modes:
1. **`EDIT`** (Active by default): The main authoring environment with canvas, filmstrip, tools, and inspectors.
2. **`DESIGN`**: Master slides, slide layouts, global color palettes, and typography tokens.
3. **`ANIMATE`**: Object build-in/build-out effects, easing curves, morph transitions, and multi-track animation timeline.
4. **`REVIEW`**: Collaborative review, comments, change tracking, and slide revisions.
5. **`PRESENT`**: Dual-screen presentation launcher and Presenter Console configuration.
6. **`EXPORT`**: Vector PDF export, standalone offline HTML5 presentations, and media export.
7. **`SORTER`**: Full-screen multi-column slide grid with section organization and global theme switching.

---

## 2. Editor Mode (`EDIT`) Layout

### 2.1 Main Toolbar (Sub-Header)
- **Document Quick-Actions**: New, Open, Save icons.
- **Creation Tools**:
  - `+ New Slide` (split button with layout picker)
  - `Layout ▾` (select slide layout from master)
  - `T Text` (create text box)
  - `Shape ▾` (geometric shapes, callouts, arrows)
  - `Picture` (insert image from file or clipboard)
  - `Table` (grid table insert)
  - `Chart` (line, bar, pie, scatter charts)
  - `Diagram` (tree hierarchies, mind maps, process flows)
  - `Media ▾` (embedded video and audio)
  - `Arrange ▾` (align, distribute, bring forward, send backward)
- **Undo / Redo**: Curved arrow icons.
- **Play Button**: Prominent accent button labeled `▷ Play` on the far right.

### 2.2 Slide Stage & Floating Tools
- **Floating Stage Overlays**:
  - Top Left: Tool pill with `Pen`, `Freehand`, `Nodes` vector pen tool.
  - Top Right: `🧲 Snap to guides` toggle.
- **Slide Canvas**:
  - High-fidelity 16:9 (or 4:3) canvas with rounded corners and subtle drop shadow.
  - Pixel-perfect typography and vector shapes with zero antialiasing artifacts.
- **Bottom Speaker Notes Drawer**:
  - Collapsible speaker notes drawer at the bottom of the canvas with expandable chevron.

### 2.3 Left Filmstrip Sidebar
- **Section Grouping**: Headers like `▾ OPENING (1-3)`, `▾ FILE NAMING (4-7)` with count.
- **Slide Items**:
  - Slide number index (1, 2, 3...).
  - Live slide thumbnail rendered faithfully.
  - Hover / bottom-left badges:
    - ✨ *Sparkle* (AI assistance / layout suggestions)
    - ✏️ *Edit / Rename* (inline slide title editing)
- **Drag & Drop**: Direct reordering across sections.

### 2.4 Right Inspector Panel
Contextual based on active selection:
- **When Slide is Selected**:
  - `Layout`: Dropdown (`Blank`, `Title & Content`, `Two Column`, etc.)
  - `Background`: Color picker (e.g. `#0c1018`), gradient, image.
  - `Use master background` button.
  - Guidance text: *"Select an object to style it. Themes and shared layouts live in Design."*
- **When Object is Selected**:
  - Geometry (Position, Size, Rotation).
  - Fill, Stroke, Shadow, Opacity.
  - Typography (Font Family, Weight, Size, Color, Alignment, Line Spacing).

---

## 3. Presenter Console (`PRESENT`)

When presenting with dual screens, the primary monitor transforms into a comprehensive mission-control dashboard:

### 3.1 Console Header
- Title: **`Presenter Console`**
- Status: **`● Live`** (green pulsing indicator)
- Display Selector: Dropdown showing target screen (e.g. `Projector · 1920 × 1080 ▾`)
- **`Swap Displays`** button (swaps console and audience windows)
- **`End Show`** button (red accent pill)
- System Wall Clock (e.g. `09:56`)

### 3.2 Left Pane: Current Slide Stage
- Header: `CURRENT — Slide X of Y`
- Full view of the currently projected slide.
- **Build Stepper Bar**:
  - `Build 11 of 11 — Ready · Next to continue`
  - Visual dot progress indicator showing active build step within the slide.
- **Nav Buttons**: Large `← Previous` and `Next →` buttons.

### 3.3 Right Pane: Next Slide & Presenter Notes
- **Up Next Thumbnail**: `NEXT — Slide X+1 of Y` preview showing upcoming content.
- **Speaker Notes**:
  - Large, high-contrast readable text.
  - Font size controls: `A-`, `A`, `A+`.
- **Presentation Controls**:
  - `Elapsed`: Digital stopwatch with `Pause` and `Restart` buttons.
  - `Countdown`: Target time tracker (e.g. `00:19:57` remaining) with editable `Target: 20 min` input.
  - Screen Shutter Buttons:
    - `Black` (blackout screen)
    - `White` (whiteout screen)
    - `Freeze` (freeze projection while presenter browses ahead)

### 3.4 Bottom Pane: Slide Navigator
- Horizontal scrolling matrix of all slide thumbnails across the entire deck.
- Clicking any thumbnail immediately jumps to that slide without showing intermediate slides to the audience.

---

## 4. Animation & Motion Engine (`ANIMATE`)

### 4.1 Sub-Bar Controls
- `Object: [Target Shape Name] ▾`
- `+ Build In`, `+ Build Out`
- `Preview`, `Play`

### 4.2 Right Build Inspector
- **Object**: Target shape name.
- **Direction**: `Build in ▾` or `Build out ▾`.
- **Effect**: `Rise`, `Fade`, `Fly`, `Scale`, `Wipe`, `Pop`.
- **Order**: `↑ Earlier`, `↓ Later` buttons.
- **Start Condition**:
  - `● At time` (exact second delay, e.g. `0.30 s`)
  - `○ On click`
  - `○ With previous`
  - `○ After previous`
- **Duration**: Duration in seconds (e.g. `0.70 s`).
- **Easing**: `Ease out ▾`, `Ease in`, `Ease in-out`, `Linear`, `Spring`.
- **Slide Transition**:
  - **`Morph`**: *"objects that match between slides move into place; the rest cross-fade."* (Keynote Magic Move equivalent).

### 4.3 Animation Timeline (Bottom Panel)
- Multi-track timeline ruler in seconds (`0.0, 0.5, 1.0, 1.5, 2.0...`).
- Object tracks showing duration blocks and start times.
- Playhead scrubber bar showing current time (`1.10 / 1.80 s`).
- Speed playback dropdown: `Speed 1x ▾` (`0.5x`, `1x`, `2x`).

---

## 5. Slide Sorter Mode (`SORTER`)

- **Full-Screen Slide Matrix**: Multi-column grid displaying all slides.
- **Section Headers**: Visual divider bars with collapsible sections and slide ranges (`FILE NAMING (4-7)`, `PRINTER USAGE (8-11)`).
- **Global Theme Recoloring**:
  - Instant live recoloring of all slides across the entire deck (e.g. Sage Green palette to Cyan/Blue palette) via theme tokens.
- **Batch Reordering**: Dragging individual or multiple slides between sections.

---

## 6. Screenshots Reference Index

The following uncompressed 1080p frames extracted directly from the video demo are stored in `design_spec/screenshots/`:

| File | Feature Demonstrated |
| :--- | :--- |
| [`01_editor_canvas.png`](file:///home/ben/Projects/omashow/design_spec/screenshots/01_editor_canvas.png) | High-fidelity slide canvas, filmstrip sectioning, and floating stage tools. |
| [`02_editor_diagrams.png`](file:///home/ben/Projects/omashow/design_spec/screenshots/02_editor_diagrams.png) | Native tree diagrams, connecting lines, and right-hand slide inspector. |
| [`03_animate_timeline.png`](file:///home/ben/Projects/omashow/design_spec/screenshots/03_animate_timeline.png) | Animation timeline, Build In/Out timing, and Morph slide transition. |
| [`04_sorter_green_theme.png`](file:///home/ben/Projects/omashow/design_spec/screenshots/04_sorter_green_theme.png) | Full-screen Slide Sorter in Sage Green theme. |
| [`05_sorter_blue_theme.png`](file:///home/ben/Projects/omashow/design_spec/screenshots/05_sorter_blue_theme.png) | Full-screen Slide Sorter recolored to Cyan/Blue theme. |
| [`06_presenter_console.png`](file:///home/ben/Projects/omashow/design_spec/screenshots/06_presenter_console.png) | Complete Presenter Console (current slide, next slide, notes, elapsed/countdown timers, slide navigator). |
| [`07_chart_rendering.png`](file:///home/ben/Projects/omashow/design_spec/screenshots/07_chart_rendering.png) | Native vector line chart rendering on slide canvas. |
