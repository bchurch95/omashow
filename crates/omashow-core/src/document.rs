//! A PPTX document held in memory: the editable [`Presentation`] model *plus* the
//! original OPC package's parts, so that saving after edits stays lossless.
//!
//! office-toolkit 1.0 re-serializes only what its model covers — a minimal
//! slide-master/layout/theme web plus the slides, notes, and pictures it parses —
//! and silently drops everything else (unused layouts, the thumbnail, printer
//! settings, embedded fonts, media it can't parse, custom XML, ...).
//! [`PptxDocument::save`] restores those by merging: the writer's output is the
//! base, and every original part the writer did not re-emit is carried through
//! byte-for-byte (together with its content-type entry and root relationship).
//!
//! Parts that the model *did* re-emit keep the writer's bytes, so edits land;
//! parts no longer referenced after a slide deletion survive as orphan content,
//! which the OPC spec allows and PowerPoint ignores.

use std::fs::File;
use std::io::Cursor;
use std::path::Path;

use office_toolkit::powerpoint::Presentation;
use office_toolkit::SaveToFile;
use opc_ooxml::{Package, Relationship};

use crate::error::Error;

/// A PPTX document: the editable model plus the original parts, for lossless saves.
pub struct PptxDocument {
    /// The editable deck — the single source of truth for content.
    pub pres: Presentation,
    /// The original OPC package (all its content parts + root relationships).
    /// Empty for a freshly created document.
    orig: Package,
    /// The original file's raw bytes, kept so an unmodified save can be
    /// written back byte-for-byte (truly lossless no-op).
    orig_bytes: Vec<u8>,
    /// True when this document was created fresh (no file to preserve against).
    is_new: bool,
    /// True once any edit has landed on the model since open/create.
    dirty: bool,
}

impl PptxDocument {
    /// Creates a fresh, empty document (no slides).
    pub fn new() -> Self {
        Self {
            pres: Presentation::new(),
            orig: Package::new(),
            orig_bytes: Vec::new(),
            is_new: true,
            dirty: false,
        }
    }

    /// Opens a `.pptx` file, keeping both the editable model and the original
    /// parts so later saves can preserve everything the model doesn't understand.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, Error> {
        let bytes = std::fs::read(path)?;
        let orig = Package::read_from(Cursor::new(&bytes))?;
        let pres = Presentation::read_from(Cursor::new(&bytes))?;
        Ok(Self {
            pres,
            orig,
            orig_bytes: bytes,
            is_new: false,
            dirty: false,
        })
    }

    /// True when the document has no original file behind it (created via [`new`](Self::new)).
    pub fn is_new(&self) -> bool {
        self.is_new
    }

    /// True once an edit has modified the model since open/create.
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Set a slide's title in place.
    pub fn set_title(&mut self, slide: usize, title: &str) -> Result<(), Error> {
        crate::set_slide_title(&mut self.pres, slide, title)?;
        self.dirty = true;
        Ok(())
    }

    /// Set (or clear) a slide's speaker notes in place.
    pub fn set_notes(&mut self, slide: usize, notes: Option<String>) -> Result<(), Error> {
        crate::set_slide_notes(&mut self.pres, slide, notes)?;
        self.dirty = true;
        Ok(())
    }

    /// Append a new slide (optionally titled) and return its index.
    pub fn add_slide(&mut self, title: Option<String>) -> Result<usize, Error> {
        let idx = crate::add_slide(&mut self.pres, title)?;
        self.dirty = true;
        Ok(idx)
    }

    /// Remove a slide by index.
    pub fn delete_slide(&mut self, slide: usize) -> Result<(), Error> {
        crate::delete_slide(&mut self.pres, slide)?;
        self.dirty = true;
        Ok(())
    }

    /// Save the document to `path`.
    ///
    /// - Fresh documents write the model directly.
    /// - Unmodified opened documents write the original bytes back verbatim (a
    ///   byte-identical, truly lossless no-op).
    /// - Edited opened documents merge the model's output with the preserved
    ///   original parts (see `merge_and_write`).
    pub fn save(&self, path: impl AsRef<Path>) -> Result<(), Error> {
        if self.is_new {
            self.pres.save_to_file(path).map_err(Error::OfficeToolkit)?;
            return Ok(());
        }
        if !self.dirty {
            std::fs::write(path, &self.orig_bytes)?;
            return Ok(());
        }
        merge_and_write(&self.pres, &self.orig, path)
    }
}

/// Serialize the model, then merge in the original parts the writer dropped, and
/// write the result to `path`.
fn merge_and_write(pres: &Presentation, orig: &Package, path: impl AsRef<Path>) -> Result<(), Error> {
    let out_buf = pres.write_to(Cursor::new(Vec::new()))?;
    let mut merged = Package::read_from(Cursor::new(out_buf.get_ref()))?;

    // Carry through every original part the writer did not re-emit (matched by
    // name). These are the parts office-toolkit 1.0 silently drops: unused
    // layouts, the thumbnail, printer settings, embedded fonts, media the model
    // can't parse, custom XML, ... `add_part` also registers the part's content
    // type, so the regenerated `[Content_Types].xml` keeps covering it.
    for part in orig.parts() {
        if merged.part(&part.name).is_some() {
            continue;
        }
        merged.add_part(part.clone());
    }

    // Restore root relationships that point at preserved parts but that the writer
    // didn't emit (e.g. the thumbnail). A fresh rId is assigned to avoid colliding
    // with the writer's own rIds.
    for rel in orig.relationships().iter() {
        let target_part = format!("/{}", rel.target);
        if merged.part(&target_part).is_none() {
            continue; // external target or a part we didn't preserve
        }
        if merged.relationships().iter().any(|r| r.target == rel.target) {
            continue; // already referenced by the writer
        }
        merged.add_relationship(Relationship {
            id: next_rid(merged.relationships()),
            rel_type: rel.rel_type.clone(),
            target: rel.target.clone(),
            target_mode: rel.target_mode,
        });
    }

    let mut file = File::create(path)?;
    merged.write_to(&mut file)?;
    Ok(())
}

/// The next free `rId{n}` for a set of relationships (1-based, gap-filling not required).
fn next_rid(rels: &opc_ooxml::Relationships) -> String {
    let max = rels
        .iter()
        .filter_map(|r| r.id.strip_prefix("rId").and_then(|n| n.parse::<usize>().ok()))
        .max()
        .unwrap_or(0);
    format!("rId{}", max + 1)
}
