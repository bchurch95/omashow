# Omashow Development Backlog

## Milestone 1: Robust Lossless PPTX Roundtripping (In Progress)
- [x] Run and verify `crates/omashow-core/examples/verify_real.rs` against real `python-pptx` decks (`/tmp/omashow-rt/real.pptx`).
- [x] Ensure non-writer-modified OPC package parts (media, audio, video, embedded fonts, unknown XML relations) are preserved.
- [x] Add integration test in `crates/omashow-core/tests/roundtrip.rs` asserting no-op save is byte-identical to source.
- [ ] Run `cargo clippy --workspace --all-targets -- -D warnings` and fix any compiler warnings or lint issues.

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

## Milestone 4: Slide Editing & Mutation Operations (Phase 3)
- [ ] Add `update_text_run(slide_idx, shape_id, new_text)` in `omashow-core`.
- [ ] Add `add_blank_slide(index)` and `delete_slide(index)`.
- [ ] Connect Tauri frontend text editing events to core mutation commands.
