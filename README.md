# Omashow

Modern PowerPoint clone built in Rust.

## Architecture

- `crates/omashow-core` — pure Rust core, PPTX read/write via office-toolkit
- `apps/omashow-tauri` — Tauri desktop app with web frontend

## Getting started

```bash
cargo run --bin omashow-tauri
```

## Development

```bash
git init
git add .
git commit -m "Initial scaffold"
```

## Roadmap

- Phase 1: PPTX import/export
- Phase 2: Viewer
- Phase 3: Editor
- Phase 4: Export PDF/PNG
