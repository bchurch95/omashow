use std::sync::Mutex;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use omashow_core::Presentation;

/// The full in-memory deck — the single source of truth. The frontend only ever
/// sees a lightweight JSON projection of it; every edit lands on the real
/// `Presentation` so nothing (pictures, charts, body text) is lost on save.
#[derive(Default)]
struct Deck {
    pres: Option<Presentation>,
    path: Option<String>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(Deck::default()))
        .invoke_handler(tauri::generate_handler![
            new_presentation,
            open_pptx,
            save_pptx,
            save_as,
            set_title,
            set_notes,
            add_slide,
            delete_slide,
            open_file_dialog,
            save_file_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn project(pres: &Presentation) -> Result<String, String> {
    serde_json::to_string(&omashow_core::model_of(pres)).map_err(|e| e.to_string())
}

#[tauri::command]
fn new_presentation(state: State<'_, Mutex<Deck>>) -> Result<String, String> {
    let mut deck = state.lock().map_err(|e| e.to_string())?;
    deck.pres = Some(omashow_core::new_presentation());
    deck.path = None;
    project(deck.pres.as_ref().unwrap())
}

#[tauri::command]
fn open_pptx(path: String, state: State<'_, Mutex<Deck>>) -> Result<String, String> {
    let mut deck = state.lock().map_err(|e| e.to_string())?;
    let pres = omashow_core::open_pptx_full(&path).map_err(|e| e.to_string())?;
    deck.pres = Some(pres);
    deck.path = Some(path);
    project(deck.pres.as_ref().unwrap())
}

#[tauri::command]
fn save_pptx(state: State<'_, Mutex<Deck>>) -> Result<String, String> {
    let deck = state.lock().map_err(|e| e.to_string())?;
    let pres = deck.pres.as_ref().ok_or("no presentation open")?;
    let path = deck.path.as_ref().ok_or("no file path set — use save_as")?;
    omashow_core::save_presentation(path, pres).map_err(|e| e.to_string())?;
    Ok(path.clone())
}

#[tauri::command]
fn save_as(path: String, state: State<'_, Mutex<Deck>>) -> Result<String, String> {
    let mut deck = state.lock().map_err(|e| e.to_string())?;
    let pres = deck.pres.as_ref().ok_or("no presentation open")?;
    omashow_core::save_presentation(&path, pres).map_err(|e| e.to_string())?;
    deck.path = Some(path.clone());
    Ok(path)
}

#[tauri::command]
fn set_title(slide: usize, title: String, state: State<'_, Mutex<Deck>>) -> Result<String, String> {
    let mut deck = state.lock().map_err(|e| e.to_string())?;
    let pres = deck.pres.as_mut().ok_or("no presentation open")?;
    omashow_core::set_slide_title(pres, slide, &title).map_err(|e| e.to_string())?;
    project(pres)
}

#[tauri::command]
fn set_notes(slide: usize, notes: Option<String>, state: State<'_, Mutex<Deck>>) -> Result<String, String> {
    let mut deck = state.lock().map_err(|e| e.to_string())?;
    let pres = deck.pres.as_mut().ok_or("no presentation open")?;
    omashow_core::set_slide_notes(pres, slide, notes).map_err(|e| e.to_string())?;
    project(pres)
}

#[tauri::command]
fn add_slide(title: Option<String>, state: State<'_, Mutex<Deck>>) -> Result<String, String> {
    let mut deck = state.lock().map_err(|e| e.to_string())?;
    let pres = deck.pres.as_mut().ok_or("no presentation open")?;
    omashow_core::add_slide(pres, title).map_err(|e| e.to_string())?;
    project(pres)
}

#[tauri::command]
fn delete_slide(slide: usize, state: State<'_, Mutex<Deck>>) -> Result<String, String> {
    let mut deck = state.lock().map_err(|e| e.to_string())?;
    let pres = deck.pres.as_mut().ok_or("no presentation open")?;
    omashow_core::delete_slide(pres, slide).map_err(|e| e.to_string())?;
    project(pres)
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
