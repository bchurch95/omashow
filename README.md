# Omashow

Modern PowerPoint clone built in Rust.

## Architecture

- `crates/omashow-core` — pure Rust core, PPTX read/write via office-toolkit
- `apps/omashow-tauri` — Tauri desktop app with web frontend

## Getting started

Create a demo PPTX:
```bash
cargo run --example create_demo -p omashow-core
```

Run Tauri app:
```bash
cd apps/omashow-tauri
cargo tauri dev
```

## Development

```bash
git init
git add .
git commit -m "Initial scaffold"
```

Project is a Cargo workspace. Core is pure Rust, UI is Tauri + web.


## Roadmap

- Phase 1: PPTX import/export
- Phase 2: Viewer
- Phase 3: Editor
- Phase 4: Export PDF/PNG
