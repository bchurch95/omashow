use office_toolkit::prelude::*;
use office_toolkit::SaveToFile;
use office_toolkit::powerpoint::{Slide, Presentation};

pub mod error;
pub mod model;
pub mod io;

pub use error::Error;
pub use model::{PresentationModel, SlideModel};

/// Open a PPTX file and convert to internal model
pub fn open_pptx(path: &str) -> Result<PresentationModel, Error> {
    let pres = Presentation::open_file(path).map_err(Error::OfficeToolkit)?;
    Ok(PresentationModel::from_presentation(pres))
}

/// Save internal model to PPTX
pub fn save_pptx(path: &str, model: &PresentationModel) -> Result<(), Error> {
    let pres = model.to_presentation();
    pres.save_to_file(path).map_err(Error::OfficeToolkit)?;
    Ok(())
}
