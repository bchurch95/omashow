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

use office_toolkit::powerpoint::Slide;

use crate::error::Error;
use crate::layout_geom::{LayoutGeometry, PhMap};
use crate::undo::{UndoCommand, UndoStack};

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
    /// Command-pattern history of every mutation, for undo/redo.
    history: UndoStack,
    /// Which original file slide each current slide descended from
    /// (`None` for slides created in-session), in model slide order.
    slide_ordinals: Vec<Option<usize>>,
    /// Per original-file slide, the placeholder geometry inherited from its
    /// layout/master chain.
    geom_by_ordinal: Vec<PhMap>,
}

impl Default for PptxDocument {
    fn default() -> Self {
        Self::new()
    }
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
            history: UndoStack::new(),
            slide_ordinals: Vec::new(),
            geom_by_ordinal: Vec::new(),
        }
    }

    /// Opens a `.pptx` file, keeping both the editable model and the original
    /// parts so later saves can preserve everything the model doesn't understand.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, Error> {
        let bytes = std::fs::read(path)?;
        let orig = Package::read_from(Cursor::new(&bytes))?;
        let pres = Presentation::read_from(Cursor::new(&bytes))?;
        let geom_by_ordinal = LayoutGeometry::from_package(&orig).into_maps();
        let geom_len = geom_by_ordinal.len();
        let slide_ordinals = (0..pres.slides.len())
            .map(|i| (i < geom_len).then_some(i))
            .collect();
        Ok(Self {
            pres,
            orig,
            orig_bytes: bytes,
            is_new: false,
            dirty: false,
            history: UndoStack::new(),
            slide_ordinals,
            geom_by_ordinal,
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

    /// Number of slides in the deck.
    pub fn slide_count(&self) -> usize {
        crate::inspect::slide_count(&self.pres)
    }

    /// Slide canvas size in EMUs.
    pub fn slide_dimensions(&self) -> crate::inspect::SlideDimensions {
        crate::inspect::slide_dimensions(&self.pres)
    }

    /// Serializable shape view for slide `slide` — kinds, placeholder roles,
    /// bounds in slide coordinates, and text runs (group children included
    /// with remapped bounds).
    pub fn get_slide_shapes(&self, slide: usize) -> Result<Vec<crate::inspect::ShapeInfo>, Error> {
        let geom = self.geom_for(slide);
        crate::inspect::get_slide_shapes_geom(&self.pres, slide, geom)
    }

    /// The resolved placeholder-geometry table for a current slide, when it
    /// descended from an original file slide carrying inherited placeholders.
    fn geom_for(&self, slide: usize) -> Option<&PhMap> {
        let ordinal = *self.slide_ordinals.get(slide)?.as_ref()?;
        self.geom_by_ordinal
            .get(ordinal)
            .filter(|m| !m.is_empty())
    }

    /// Set a slide's title in place (undoable).
    pub fn set_title(&mut self, slide: usize, title: &str) -> Result<(), Error> {
        let before = self.pres.slides.get(slide).map(|s| s.shapes.clone())
            .ok_or(Error::OutOfRange(slide))?;
        crate::set_slide_title(&mut self.pres, slide, title)?;
        self.history.record(UndoCommand::Shapes {
            slide,
            before,
            after: self.pres.slides[slide].shapes.clone(),
            description: "change title".into(),
        });
        self.dirty = true;
        Ok(())
    }

    /// Set (or clear) a slide's speaker notes in place (undoable).
    pub fn set_notes(&mut self, slide: usize, notes: Option<String>) -> Result<(), Error> {
        let before = self.pres.slides.get(slide).map(|s| s.notes.clone())
            .ok_or(Error::OutOfRange(slide))?;
        crate::set_slide_notes(&mut self.pres, slide, notes)?;
        self.history.record(UndoCommand::Notes {
            slide,
            before,
            after: self.pres.slides[slide].notes.clone(),
            description: "change notes".into(),
        });
        self.dirty = true;
        Ok(())
    }

    /// Append a new slide (optionally titled) and return its index (undoable).
    pub fn add_slide(&mut self, title: Option<String>) -> Result<usize, Error> {
        self.add_slide_at(self.pres.slides.len(), title)
    }

    /// Insert a new slide at `index` (optionally titled) and return its index (undoable).
    pub fn add_slide_at(&mut self, index: usize, title: Option<String>) -> Result<usize, Error> {
        let before = self.pres.slides.get(index..).map(|t| t.to_vec()).ok_or(Error::OutOfRange(index))?;
        let idx = crate::add_slide_at(&mut self.pres, index, title)?;
        self.slide_ordinals.insert(idx, None);
        self.record_slice_change(idx, before, "add slide");
        Ok(idx)
    }

    /// Remove a slide by index (undoable).
    pub fn delete_slide(&mut self, slide: usize) -> Result<(), Error> {
        let before = self.pres.slides.get(slide..).map(|t| t.to_vec()).ok_or(Error::OutOfRange(slide))?;
        crate::delete_slide(&mut self.pres, slide)?;
        self.slide_ordinals.remove(slide);
        self.record_slice_change(slide, before, "delete slide");
        Ok(())
    }

    /// Move a slide so the one at `from` ends up at position `to` (undoable).
    pub fn move_slide(&mut self, from: usize, to: usize) -> Result<(), Error> {
        let before = self.pres.slides.clone();
        let ord_before = self.slide_ordinals.clone();
        crate::move_slide(&mut self.pres, from, to)?;
        let ordinal = self.slide_ordinals.remove(from);
        self.slide_ordinals.insert(to.min(self.slide_ordinals.len()), ordinal);
        self.history.record(UndoCommand::Slides {
            from: 0,
            before,
            after: self.pres.slides.clone(),
            ord_before,
            ord_after: self.slide_ordinals.clone(),
            description: "move slide".into(),
        });
        self.dirty = true;
        Ok(())
    }

    /// Replace the text of a shape on a slide, keeping its base formatting (undoable).
    pub fn update_text_run(&mut self, slide: usize, shape_id: u32, new_text: &str) -> Result<(), Error> {
        let before = self.pres.slides.get(slide).map(|s| s.shapes.clone())
            .ok_or(Error::OutOfRange(slide))?;
        crate::update_text_run(&mut self.pres, slide, shape_id, new_text)?;
        self.history.record(UndoCommand::Shapes {
            slide,
            before,
            after: self.pres.slides[slide].shapes.clone(),
            description: "edit text".into(),
        });
        self.dirty = true;
        Ok(())
    }

    /// Records a slide-list change anchored at `from`: the captured tail is
    /// `slides[from..]` before the change, and the current tail is `after`.
    fn record_slice_change(&mut self, from: usize, before_tail: Vec<Slide>, description: &str) {
        let after_tail = self.pres.slides[from..].to_vec();
        self.history.record(UndoCommand::Slides {
            from,
            before: before_tail,
            after: after_tail,
            ord_before: self.slide_ordinals[from..].to_vec(),
            ord_after: self.slide_ordinals[from..].to_vec(),
            description: description.into(),
        });
        self.dirty = true;
    }

    /// Undoes the most recent mutation; returns its description.
    pub fn undo(&mut self) -> Option<String> {
        let command = self.history.undo(&mut self.pres)?;
        if let UndoCommand::Slides { from, ord_before, .. } = &command {
            self.splice_ordinals(*from, ord_before);
        }
        self.dirty = true;
        Some(command.description().to_string())
    }

    /// Re-applies the most recently undone mutation; returns its description.
    pub fn redo(&mut self) -> Option<String> {
        let command = self.history.redo(&mut self.pres)?;
        if let UndoCommand::Slides { from, ord_after, .. } = &command {
            self.splice_ordinals(*from, ord_after);
        }
        self.dirty = true;
        Some(command.description().to_string())
    }

    /// Replaces the ordinal tail starting at `from` with the captured side.
    fn splice_ordinals(&mut self, from: usize, ords: &[Option<usize>]) {
        let from = from.min(self.slide_ordinals.len());
        self.slide_ordinals.splice(from.., ords.iter().cloned());
        self.slide_ordinals.truncate(self.pres.slides.len());
    }

    /// Whether an undo is available.
    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    /// Whether a redo is available.
    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }

    /// Description of the most recent mutation, for "Undo: …" UI labels.
    pub fn undo_description(&self) -> Option<String> {
        self.history.last_description().map(str::to_string)
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
