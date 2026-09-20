use serde::{Deserialize, Serialize};
use office_toolkit::powerpoint::{Presentation, Slide, AutoShape, Shape};
use office_toolkit::drawing::{TextBody, TextParagraph, TextRun};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresentationModel {
    pub title: String,
    pub slides: Vec<SlideModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideModel {
    pub index: usize,
    pub title: Option<String>,
    pub notes: Option<String>,
}

impl PresentationModel {
    pub fn from_presentation(pres: Presentation) -> Self {
        let title = pres.properties.title.clone().unwrap_or_else(|| "Untitled".to_string());
        let slides = pres
            .slides
            .into_iter()
            .enumerate()
            .map(|(i, slide)| {
                let title_text = extract_slide_title(&slide);
                let notes_text = slide.notes.as_ref().map(|tb| text_body_to_string(tb));
                SlideModel {
                    index: i,
                    title: if title_text.is_empty() { None } else { Some(title_text) },
                    notes: if notes_text.as_deref().unwrap_or("").is_empty() { None } else { notes_text },
                }
            })
            .collect();
        Self { title, slides }
    }

    pub fn to_presentation(&self) -> Presentation {
        // Minimal round-trip: create empty slides matching count
        let mut pres = Presentation::new();
        for _ in &self.slides {
            pres.add_slide();
        }
        // Title not preserved in this minimal implementation
        pres
    }
}

fn extract_slide_title(slide: &Slide) -> String {
    for shape in &slide.shapes {
        if let Shape::AutoShape(auto) = shape {
            // Prefer placeholder title shapes
            if let Some(ph) = &auto.placeholder {
                use office_toolkit::powerpoint::PlaceholderKind;
                if matches!(ph.kind, PlaceholderKind::Title | PlaceholderKind::CenterTitle) {
                    if let Some(tb) = &auto.text_body {
                        return text_body_to_string(tb);
                    }
                }
            }
        }
    }
    // Fallback: first non-empty text body
    for shape in &slide.shapes {
        if let Shape::AutoShape(auto) = shape {
            if let Some(tb) = &auto.text_body {
                let s = text_body_to_string(tb);
                if !s.trim().is_empty() {
                    return s;
                }
            }
        }
    }
    String::new()
}

fn text_body_to_string(tb: &TextBody) -> String {
    let mut out = String::new();
    for para in &tb.paragraphs {
        let mut line = String::new();
        for run in &para.runs {
            let txt = match run {
                TextRun::Regular { text, .. } => text.clone(),
                TextRun::LineBreak { .. } => "\n".to_string(),
                TextRun::Field { cached_text, .. } => cached_text.clone(),
            };
            line.push_str(&txt);
        }
        if !line.is_empty() {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&line);
        }
    }
    out
}
