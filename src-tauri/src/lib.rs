use tauri::Manager;
mod asset;
pub mod cli;
mod commands;
pub mod library;
mod native;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::LibraryState::default())
        .manage(watcher::WatchState::default())
        .manage(asset::AssetPolicy::default())
        // Registering "asset" replaces Tauri's built-in asset responder. Automatic
        // dialog/drop scope grants cannot bypass our current-root authorization.
        .register_asynchronous_uri_scheme_protocol("asset", |context, request, responder| {
            let app = context.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let policy = app.state::<asset::AssetPolicy>();
                let root = policy.0.read().unwrap_or_else(|e| e.into_inner());
                // Keep the read lock through response submission so switching roots
                // waits for in-flight responses before committing the new selection.
                responder.respond(asset::response(root.as_deref(), request));
            });
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .invoke_handler(tauri::generate_handler![
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_sources,
            commands::get_config,
            commands::set_library,
            commands::pick_library_folder,
            commands::pick_image_files,
            commands::load_library,
            commands::import_sources,
            commands::import_source_bytes,
            commands::update_source,
            commands::create_prompt,
            commands::update_prompt,
            commands::add_results,
            commands::update_result,
            commands::trash_item,
            commands::set_tags,
            commands::tag_usage,
            commands::remove_tag,
            commands::rename_tag,
            commands::reveal_in_finder,
            commands::copy_image_to_clipboard,
            commands::open_chat,
            commands::clipboard_chat_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running Prompt Gallery");
}
