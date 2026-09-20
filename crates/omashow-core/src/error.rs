use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Office toolkit error: {0}")]
    OfficeToolkit(#[from] office_toolkit::Error),
    
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Slide index {0} out of range")]
    OutOfRange(usize),
}
