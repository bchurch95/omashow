fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_pptx,
            save_pptx,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn open_pptx(path: String) -> Result<String, String> {
    let model = omashow_core::open_pptx(&path).map_err(|e| e.to_string())?;
    serde_json::to_string(&model).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_pptx(path: String, data: String) -> Result<(), String> {
    let model: omashow_core::PresentationModel = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    omashow_core::save_pptx(&path, &model).map_err(|e| e.to_string())
}
