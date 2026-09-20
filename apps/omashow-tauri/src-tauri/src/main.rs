use tauri_plugin_dialog::DialogExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_pptx,
            save_pptx,
            open_file_dialog,
            save_file_dialog,
            new_presentation,
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

#[tauri::command]
fn open_file_dialog(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let file = app_handle
        .dialog()
        .file()
        .set_title("Open Presentation")
        .add_filter("PowerPoint", &["pptx"])
        .blocking_pick_file();
    Ok(file.map(|p| p.as_path().unwrap().to_string_lossy().to_string()))
}

#[tauri::command]
fn save_file_dialog(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let file = app_handle
        .dialog()
        .file()
        .set_title("Save Presentation")
        .add_filter("PowerPoint", &["pptx"])
        .blocking_save_file();
    Ok(file.map(|p| p.as_path().unwrap().to_string_lossy().to_string()))
}

#[tauri::command]
fn new_presentation() -> Result<String, String> {
    let model = omashow_core::PresentationModel { title: "Untitled".into(), slides: vec![] };
    serde_json::to_string(&model).map_err(|e| e.to_string())
}
