use office_toolkit::{OpenFile, SaveToFile};
use office_toolkit::powerpoint::{AutoShape, Placeholder, PlaceholderKind, Shape, Slide};
use office_toolkit::drawing::{ShapeProperties, TextBody, TextRun, Transform2D};

use model::text_body_from_string;

pub mod error;
pub mod model;
pub mod io;
pub mod document;

pub use document::PptxDocument;
pub use error::Error;
pub use model::{PresentationModel, SlideModel};
pub use office_toolkit::powerpoint::Presentation;

/// Open a PPTX file into a lightweight model (title + per-slide title/notes).
pub fn open_pptx(path: &str) -> Result<PresentationModel, Error> {
    let pres = Presentation::open_file(path).map_err(Error::OfficeToolkit)?;
    Ok(PresentationModel::from_presentation(pres))
}

/// Open a PPTX file into the *full* deck, preserving every shape/picture/chart.
pub fn open_pptx_full(path: &str) -> Result<Presentation, Error> {
    Presentation::open_file(path).map_err(Error::OfficeToolkit)
}

/// Save a full deck to PPTX, losslessly.
pub fn save_presentation(path: &str, pres: &Presentation) -> Result<(), Error> {
    pres.save_to_file(path).map_err(Error::OfficeToolkit)
}

/// Save a lightweight model to PPTX (rebuilds the deck; use `save_presentation` for lossless saves).
pub fn save_pptx(path: &str, model: &PresentationModel) -> Result<(), Error> {
    let pres = model.to_presentation();
    save_presentation(path, &pres)
}

/// Lightweight model view of a deck, without consuming it.
pub fn model_of(pres: &Presentation) -> PresentationModel {
    PresentationModel::from_presentation_ref(pres)
}

/// Set the title of a slide in place — edits the existing title placeholder if present,
/// otherwise inserts a standard title text box. All other content is untouched.
pub fn set_slide_title(pres: &mut Presentation, slide: usize, title: &str) -> Result<(), Error> {
    let slide = pres
        .slides
        .get_mut(slide)
        .ok_or(Error::OutOfRange(slide))?;
    let title = title.to_string();

    // 1) Prefer an existing title/centerTitle placeholder shape.
    let idx = slide
        .shapes
        .iter()
        .position(|shape| matches!(shape, Shape::AutoShape(a) if a.placeholder.as_ref().is_some_and(|p| matches!(p.kind, PlaceholderKind::Title | PlaceholderKind::CenterTitle))));
    if let Some(i) = idx {
        if let Shape::AutoShape(auto) = &mut slide.shapes[i] {
            auto.text_body = Some(text_body_from_string(&title));
            return Ok(());
        }
    }

    // 2) Fallback: repurpose the first shape carrying text.
    let idx = slide
        .shapes
        .iter()
        .position(|shape| matches!(shape, Shape::AutoShape(a) if a.text_body.as_ref().is_some_and(|tb| !tb_text_is_empty(tb))));
    if let Some(i) = idx {
        if let Shape::AutoShape(auto) = &mut slide.shapes[i] {
            auto.text_body = Some(text_body_from_string(&title));
            return Ok(());
        }
    }

    // 3) No title shape at all — insert a standard one.
    let id = next_shape_id(slide);
    slide.shapes.push(Shape::AutoShape(
        AutoShape::new(id, "Title")
            .with_text_box(true)
            .with_placeholder(Placeholder::new(PlaceholderKind::Title))
            .with_properties(
                ShapeProperties::new().with_transform(
                    Transform2D::new()
                        .with_offset(685_800, 342_900)
                        .with_extent(10_820_400, 1_325_555),
                ),
            )
            .with_text_body(text_body_from_string(&title)),
    ));
    Ok(())
}

/// Set (or clear, with None) the speaker notes of a slide in place.
pub fn set_slide_notes(pres: &mut Presentation, slide: usize, notes: Option<String>) -> Result<(), Error> {
    let slide = pres
        .slides
        .get_mut(slide)
        .ok_or(Error::OutOfRange(slide))?;
    slide.notes = match notes {
        Some(n) if !n.trim().is_empty() => Some(text_body_from_string(&n)),
        _ => None,
    };
    Ok(())
}

/// Append a new empty slide with a standard title text box.
pub fn add_slide(pres: &mut Presentation, title: Option<String>) -> Result<usize, Error> {
    let mut s = Slide::new();
    if let Some(title) = title {
        if !title.trim().is_empty() {
            s.shapes.push(Shape::AutoShape(
                AutoShape::new(2, "Title")
                    .with_text_box(true)
                    .with_placeholder(Placeholder::new(PlaceholderKind::Title))
                    .with_properties(
                        ShapeProperties::new().with_transform(
                            Transform2D::new()
                                .with_offset(685_800, 342_900)
                                .with_extent(10_820_400, 1_325_555),
                        ),
                    )
                    .with_text_body(text_body_from_string(&title)),
            ));
        }
    }
    pres.slides.push(s);
    Ok(pres.slides.len() - 1)
}

/// Remove a slide from the deck in place.
pub fn delete_slide(pres: &mut Presentation, slide: usize) -> Result<(), Error> {
    if slide >= pres.slides.len() {
        return Err(Error::OutOfRange(slide));
    }
    pres.slides.remove(slide);
    Ok(())
}

/// Replace the whole deck (e.g. after a "New" action).
pub fn new_presentation() -> Presentation {
    Presentation::new()
}

fn tb_text_is_empty(tb: &TextBody) -> bool {
    tb.paragraphs.iter().all(|p| {
        p.runs.iter().all(|r| match r {
            TextRun::Regular { text, .. } => text.trim().is_empty(),
            _ => true,
        })
    })
}

fn next_shape_id(slide: &Slide) -> u32 {
    let max = slide.shapes.iter().filter_map(|s| match s {
        Shape::AutoShape(a) => Some(a.id),
        Shape::Picture(p) => Some(p.id),
        _ => None,
    }).max().unwrap_or(1);
    max + 1
}

