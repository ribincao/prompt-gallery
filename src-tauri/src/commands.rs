use crate::{
    asset::AssetPolicy,
    library::{self, Library, Outcome, PromptInput, ResultInput},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct LibraryState(pub Mutex<Option<PathBuf>>);
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub library_path: Option<String>,
}
fn config_path(app: &AppHandle) -> Outcome<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config.json");
    if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Config cannot be a symlink".into());
    }
    Ok(path)
}
#[tauri::command]
pub fn get_config(app: AppHandle) -> Outcome<Config> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(Config::default());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Cannot read config: {e}"))
}
#[tauri::command]
pub fn set_library(
    app: AppHandle,
    state: State<'_, LibraryState>,
    path: String,
    confirm_nonempty: Option<bool>,
) -> Outcome<()> {
    let chosen = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    if chosen.starts_with(repo) || repo.starts_with(&chosen) {
        return Err("Choose a dedicated library folder outside the app repository".into());
    }
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    let root = library::open_library(&chosen, confirm_nonempty.unwrap_or(false))?;
    let watcher = crate::watcher::start(app.clone(), root.clone())?;
    let config = Config {
        library_path: Some(root.to_string_lossy().into()),
    };
    let policy = app.state::<AssetPolicy>();
    let mut active_root = policy.0.write().map_err(|e| e.to_string())?;
    library::atomic_write(
        &config_path(&app)?,
        &serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
    )?;
    // The guarded asset handler consults this root on every request. No restart or
    // permanent scope deny rules are needed, including on first choice and A → B → A.
    *active_root = Some(root.clone());
    *current = Some(root);
    *app.state::<crate::watcher::WatchState>()
        .0
        .lock()
        .map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}
#[tauri::command]
pub async fn pick_library_folder(app: AppHandle) -> Outcome<Option<String>> {
    // Rust dialog API deliberately avoids the JS dialog command's automatic asset grants.
    tauri::async_runtime::spawn_blocking(move || {
        let mut picker = app.dialog().file().set_title("Choose a library folder");
        if let Ok(p) = app.path().picture_dir() {
            picker = picker.set_directory(p);
        }
        picker
            .blocking_pick_folder()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn pick_image_files(app: AppHandle) -> Outcome<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Images", &["jpg", "jpeg", "png", "webp", "heic", "gif"])
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into())
                    .map_err(|e| e.to_string())
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}
fn with_root<T>(state: &LibraryState, action: impl FnOnce(&Path) -> Outcome<T>) -> Outcome<T> {
    let root = state.0.lock().map_err(|e| e.to_string())?;
    let root = root.as_ref().ok_or("Choose a library first")?;
    library::marker(root)?;
    action(root)
}
#[tauri::command]
pub async fn load_library(state: State<'_, LibraryState>) -> Outcome<Library> {
    with_root(&state, library::load_library)
}
#[tauri::command]
pub async fn import_sources(
    state: State<'_, LibraryState>,
    paths: Vec<String>,
    tags: Vec<String>,
) -> Outcome<Vec<String>> {
    with_root(&state, |root| {
        let mut ids = vec![];
        for path in paths {
            ids.push(
                library::import_source(root, Some(Path::new(&path)), None, tags.clone())
                    .map_err(|e| {
                        format!(
                            "{path}: {e}. {} earlier imports completed; reload to see them.",
                            ids.len()
                        )
                    })?
                    .id,
            );
        }
        Ok(ids)
    })
}
#[tauri::command]
pub async fn import_source_bytes(
    state: State<'_, LibraryState>,
    bytes: Vec<u8>,
    tags: Vec<String>,
) -> Outcome<String> {
    with_root(&state, |r| {
        library::import_source(r, None, Some(&bytes), tags).map(|s| s.id)
    })
}
#[tauri::command]
pub async fn update_source(
    state: State<'_, LibraryState>,
    id: String,
    tags: Vec<String>,
    note: String,
) -> Outcome<()> {
    with_root(&state, |r| library::update_source(r, &id, tags, note))
}
#[tauri::command]
pub async fn create_prompt(
    state: State<'_, LibraryState>,
    meta: PromptInput,
    text: String,
) -> Outcome<String> {
    with_root(&state, |r| library::create_prompt(r, meta, text))
}
#[tauri::command]
pub async fn update_prompt(
    state: State<'_, LibraryState>,
    id: String,
    meta: PromptInput,
    text: String,
) -> Outcome<()> {
    with_root(&state, |r| library::update_prompt(r, &id, meta, text))
}
#[tauri::command]
pub async fn add_results(
    state: State<'_, LibraryState>,
    prompt_id: String,
    paths: Option<Vec<String>>,
    bytes: Option<Vec<u8>>,
    source_photos: Vec<String>,
    chat_url: String,
    note: String,
) -> Outcome<Vec<String>> {
    with_root(&state, |r| {
        let fields = ResultInput {
            source_photos,
            chat_url,
            note,
            model: "ChatGPT".into(),
            favorite: false,
        };
        match (paths, bytes) {
            (Some(paths), None) if !paths.is_empty() => {
                let mut ids = vec![];
                for p in paths {
                    ids.push(
                        library::add_result(
                            r,
                            &prompt_id,
                            Some(Path::new(&p)),
                            None,
                            fields.clone(),
                        )
                        .map_err(|e| {
                            format!(
                                "{p}: {e}. {} earlier imports completed; reload to see them.",
                                ids.len()
                            )
                        })?,
                    );
                }
                Ok(ids)
            }
            (None, Some(bytes)) => Ok(vec![library::add_result(
                r,
                &prompt_id,
                None,
                Some(&bytes),
                fields,
            )?]),
            _ => Err("Provide image paths or PNG bytes".into()),
        }
    })
}
#[tauri::command]
pub async fn update_result(
    state: State<'_, LibraryState>,
    prompt_id: String,
    id: String,
    meta: ResultInput,
) -> Outcome<()> {
    with_root(&state, |r| library::update_result(r, &prompt_id, &id, meta))
}
#[tauri::command]
pub async fn trash_item(
    state: State<'_, LibraryState>,
    kind: String,
    id: String,
    prompt_id: Option<String>,
) -> Outcome<()> {
    with_root(&state, |r| {
        library::trash_item(r, &kind, &id, prompt_id.as_deref())
    })
}
#[tauri::command]
pub async fn set_tags(state: State<'_, LibraryState>, tags: Vec<String>) -> Outcome<()> {
    with_root(&state, |r| library::set_tags(r, tags))
}
#[tauri::command]
pub async fn reveal_in_finder(state: State<'_, LibraryState>, path: String) -> Outcome<()> {
    with_root(&state, |r| {
        let p = library::owned_file(r, Path::new(&path))?;
        let status = std::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg(p)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Finder could not reveal this file".into())
        }
    })
}
#[tauri::command]
pub fn open_chat(app: AppHandle, url: String) -> Outcome<()> {
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if !["https", "http"].contains(&parsed.scheme()) || parsed.host_str().is_none() {
        return Err("Only http/https links can be opened".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn copy_image_to_clipboard(state: State<'_, LibraryState>, path: String) -> Outcome<()> {
    with_root(&state, |r| {
        crate::native::copy_image(&library::owned_file(r, Path::new(&path))?)
    })
}

#[tauri::command]
pub fn clipboard_chat_url() -> Outcome<String> {
    crate::native::clipboard_chat_url()
}

#[tauri::command]
pub async fn tag_usage(state: State<'_, LibraryState>) -> Outcome<Vec<library::TagUsage>> {
    with_root(&state, library::tag_usage)
}
#[tauri::command]
pub async fn remove_tag(
    state: State<'_, LibraryState>,
    tag: String,
) -> Outcome<library::TagChange> {
    with_root(&state, |r| library::remove_tag(r, &tag))
}
#[tauri::command]
pub async fn rename_tag(
    state: State<'_, LibraryState>,
    from: String,
    to: String,
) -> Outcome<library::TagChange> {
    with_root(&state, |r| library::rename_tag(r, &from, &to))
}
