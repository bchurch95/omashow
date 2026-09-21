# Omashow Development Backlog

## Milestone 1: Robust Lossless PPTX Roundtripping (Complete)
- [x] Run and verify `crates/omashow-core/examples/verify_real.rs` against real `python-pptx` decks (`/tmp/omashow-rt/real.pptx`).
- [x] Ensure non-writer-modified OPC package parts (media, audio, video, embedded fonts, unknown XML relations) are preserved.
- [x] Add integration test in `crates/omashow-core/tests/roundtrip.rs` asserting no-op save is byte-identical to source.
- [x] Run `cargo clippy --workspace --all-targets -- -D warnings` and fix any compiler warnings or lint issues.

## Milestone 2: Headless Slide Extraction & Inspection API (Complete)
- [x] Expose slide metadata APIs in `omashow-core` (`slide_count()`, `slide_dimensions()`, `get_slide_shapes()`).
- [x] Implement CLI inspect command: `cargo run -p omashow-cli -- inspect <path.pptx>` outputting structured JSON.
- [x] Add test cases verifying correct text run and bounding box extraction across multi-shape slides.

## Milestone 3: High-Fidelity Slide Canvas & Viewer (Complete)
- [x] Update Tauri backend commands in `apps/omashow-tauri/src-tauri/src/main.rs`:
  - `open_presentation(path)` returning metadata, slide list, and speaker notes.
  - `get_slide_content(slide_idx)` returning shapes, text runs, colors, bounding boxes, and dimensions.
  - `save_presentation(path)`.
- [x] Implement thumbnail filmstrip sidebar in the Tauri frontend with slide numbers and active indicator.
- [x] Build high-fidelity slide canvas preserving typography (fonts, sizes in pt, bold/italic, alignment) and proportional EMU bounding boxes.
- [x] Run visual audit with `python3 visual_critic.py` and refine CSS/layout aesthetics until Qwen Vision scores the interface 8/10 or higher.

## Milestone 4: Dual-Screen Presenter Mode & Multitasking (Complete)
- [x] Implement Tauri multi-window commands (`open_audience_window(monitor_id)`, `close_audience_window`):
  - Detect secondary monitor/projector via Tauri display API and position audience window fullscreen.
  - Keep audience window visible, borderless, and non-minimizing when primary window loses OS focus during multitasking.
- [x] Build Presenter Console on primary screen:
  - Live active slide view + Next-slide preview thumbnail.
  - Formatted speaker notes extracted from PPTX (`pres.slides[i].notes`).
  - Elapsed presentation timer and current clock.
- [x] Real-time event synchronization between Presenter Console and Audience Window (`slide-changed`, `blackout-toggle`).
- [x] Keyboard navigation: `F5` (launch dual-screen presentation), `Space`/`ArrowRight` (advance), `ArrowLeft` (previous), `B` (blackout audience screen), `Escape` (exit).

## Milestone 5: Slide Editing, Undo History & Filmstrip Reordering (Complete)
- [x] Add `UndoStack` command pattern for all slide and text mutations.
- [x] Add `update_text_run(slide_idx, shape_id, new_text)` in `omashow-core`.
- [x] Add `add_blank_slide(index)` and `delete_slide(index)` with filmstrip drag/reorder controls.
- [x] Connect Tauri frontend text editing events to core mutation commands.

## Milestone 6: Image Extraction & Multi-Vendor Corpus Testing (Complete)
- [x] Support `<p:pic>` shape extraction and map embedded media relationships (`ppt/media/*`).
- [x] Render embedded slide pictures inside the Tauri slide canvas. (Editor canvas, filmstrip thumbnails, presenter console and audience window; `ShapeInfo.pic` carries format + data URI, e2e-verified under Xvfb.)
- [x] Add multi-vendor test suite in `crates/omashow-core/tests/corpus.rs` verifying decks from Google Slides, M365, and Keynote. (8 Apache-2.0 Apache POI fixtures: M365 PowerPoint 2007–2016 Windows + macOS, LibreOffice 5–25; no public corpus carries genuine Google Slides/Keynote exports — gap documented in `tests/fixtures/README.md`, tracked under Stretch. Two SmartArt/OLE fixtures pinned as `KNOWN_REJECTIONS` with a stable non-panicking error contract.)
- [x] Add negative tests ensuring corrupt PPTX files fail gracefully with typed `Result` errors. (6 cases in `tests/corrupt.rs`: empty file, garbage bytes, truncated zip, missing `[Content_Types].xml`, invalid content-types XML, corrupted slide XML.)

## Milestone 7: Presenter Stage Tools & Export Engine (PDF & Web)
- [x] Virtual Laser Pointer: Holding `Ctrl` or selecting pointer tool projects a glowing laser dot onto the audience screen synchronized with cursor movement. (Ctrl-hold + console toggle button; dot follows cursor 1:1 in slide space, e2e-verified on Xvfb.)
- [ ] Live Slide Drawing & Highlighter: Transparent SVG canvas overlay allowing in-show annotation and pen drawing over active slides.
- [ ] Slide Grid Navigator: Hitting `G` during presentation displays a full-screen thumbnail matrix to jump directly to any slide.
- [ ] Vector PDF Export: Implement `omashow-cli export-pdf <deck.pptx> <out.pdf>` and a Tauri "Export to PDF" dialog with 1:1 vector precision.
- [ ] Standalone HTML5 Bundle Export: Export presentation as an offline, single-file HTML presentation viewable in any browser.

## Milestone 8: Slide Transitions & Build Animations (Keynote-Grade Fluidity)
- [ ] Slide Transitions: Implement hardware-accelerated CSS transitions between slides (Fade, Push, Slide, Wipe).
- [ ] Magic Move / Morph: Detect shapes with matching IDs/names across consecutive slides and interpolate position, scale, and opacity smoothly.
- [ ] Element Build Animations: Support `On Click` sequential reveals for text bullet points and shapes (Fade In, Fly In from bottom/left).

## Milestone 9: Rich Media, Audio/Video & Tables
- [ ] Embedded Audio & Video Playback: Play slide media parts (`ppt/media/*.mp4`, `.wav`) with auto-play on slide entry, looping, and pause controls.
- [ ] Table Support (`a:tbl`): Extract, render, and format OpenXML tables with column widths, borders, cell margins, and background fills.
- [ ] Smart Magnetic Connectors: Lines and arrows that dynamically anchor between shape boundary points and adjust when shapes move.

## Stretch Milestone: iPadOS & AirPlay External Display Support
- [ ] Add touch navigation gestures to slide viewer (swipe left/right to advance, tap to toggle notes).
- [ ] Configure Tauri v2 iOS/iPadOS mobile target (`cargo tauri ios`).
- [ ] Implement secondary display routing for AirPlay / external screens via `UIScreen` / `UIWindowScene` (dedicated audience window, avoiding simple mirroring).
- [ ] Support Split View / Slide Over multitasking with live AirPlay slide presentation.
- [ ] Background AirPlay video stream mode allowing complete app minimization while keeping audience slides active.

## Stretch: office-toolkit reader gaps & vendor coverage (tracked, not blocking)

- [ ] SmartArt diagrams: office-toolkit mis-parses `dgm:relIds` (diagram parts) as chart relationships and rejects the package. Fix upstream (or vendor + patch) so SmartArt slides open; then promote `m365_smartart.bin` from `KNOWN_REJECTIONS` to `FIXTURES`.
- [ ] Legacy OLE objects / `mc:AlternateContent`: same rejection path (see `m365_bug64693.bin`). Model or gracefully skip `p:oleObj` so the rest of the slide still renders.
- [ ] Genuine Google Slides and Keynote export fixtures: requires licensed/first-party sample decks (no public corpus found); add once available.
