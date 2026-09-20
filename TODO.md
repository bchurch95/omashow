# Omashow Development Backlog

## Milestone 1: Robust Lossless PPTX Roundtripping (Complete)
- [x] Run and verify `crates/omashow-core/examples/verify_real.rs` against real `python-pptx` decks (`/tmp/omashow-rt/real.pptx`).
- [x] Ensure non-writer-modified OPC package parts (media, audio, video, embedded fonts, unknown XML relations) are preserved.
- [x] Add integration test in `crates/omashow-core/tests/roundtrip.rs` asserting no-op save is byte-identical to source.
- [x] Run `cargo clippy --workspace --all-targets -- -D warnings` and fix any compiler warnings or lint issues.

## Milestone 2: Headless Slide Extraction & Inspection API
- [ ] Expose slide metadata APIs in `omashow-core` (`slide_count()`, `slide_dimensions()`, `get_slide_shapes()`).
- [ ] Implement CLI inspect command: `cargo run -p omashow-cli -- inspect <path.pptx>` outputting structured JSON.
- [ ] Add test cases verifying correct text run and bounding box extraction across multi-shape slides.

## Milestone 3: Tauri IPC Bridge & Slide Viewer (Phase 2)
- [ ] Update Tauri backend commands in `apps/omashow-tauri/src-tauri/src/main.rs`:
  - `open_presentation(path)` returning metadata and slide previews.
  - `get_slide_content(slide_idx)` returning shapes, text blocks, colors, and layout.
  - `save_presentation(path)`.
- [ ] Implement thumbnail filmstrip sidebar in the Tauri frontend.
- [ ] Build slide canvas component rendering basic shapes, text boxes, and background styling.
- [ ] Run visual audit with `python3 visual_critic.py` and refine CSS/layout aesthetics until Qwen Vision scores the interface 8/10 or higher.

## Milestone 4: Slide Editing & Mutation Operations (Phase 3)
- [ ] Add `update_text_run(slide_idx, shape_id, new_text)` in `omashow-core`.
- [ ] Add `add_blank_slide(index)` and `delete_slide(index)`.
- [ ] Connect Tauri frontend text editing events to core mutation commands.

## Milestone 5: Presenter Mode, Undo History & Filmstrip Reordering
- [ ] Add `UndoStack` command pattern for all slide and text mutations.
- [ ] Implement slide reordering API (`reorder_slide(from_idx, to_idx)`) in core and Tauri backend.
- [ ] Implement drag-and-drop or move up/down controls in the thumbnail filmstrip.
- [ ] Build Full-Screen Slideshow mode in Tauri (`F5` / `Escape`) with arrow key navigation and black screen toggle (`B`).

## Milestone 6: Image Extraction & Multi-Vendor Corpus Testing
- [ ] Support `<p:pic>` shape extraction and map embedded media relationships (`ppt/media/*`).
- [ ] Render embedded slide pictures inside the Tauri slide canvas.
- [ ] Add multi-vendor test suite in `crates/omashow-core/tests/corpus.rs` verifying decks from Google Slides, M365, and Keynote.
- [ ] Add negative tests ensuring corrupt PPTX files fail gracefully with typed `Result` errors.
