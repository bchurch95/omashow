use serde::{Deserialize, Serialize};
use office_toolkit::powerpoint::{Presentation, Slide};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresentationModel {
    pub title: String,
    pub slides: Vec<SlideModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideModel {
    pub index: usize,
    pub title: Option<String>,
}

impl PresentationModel {
    pub fn from_presentation(pres: Presentation) -> Self {
        // Simplified mapping - real implementation would walk shapes
        let slide_count = 0; // placeholder
        Self {
            title: "Untitled".to_string(),
            slides: vec![],
        }
    }

    pub fn to_presentation(&self) -> Presentation {
        Presentation::new()
    }
}
