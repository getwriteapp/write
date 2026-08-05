/* The filesystem security boundary.

   `write` opens .docx files written by strangers and parses them inside a
   webview. That is the app's whole job, so the parser will always be exposed
   to hostile input — which means the question is not "can it be attacked?"
   but "what can an attack reach?".

   The answer used to be: everything. capabilities/default.json granted the
   frontend fs read AND write on `**`, so any script running in the webview
   owned the user's disk.

   Now the webview holds no general filesystem capability at all — the fs
   commands are granted with an EMPTY path scope, so every read and write is
   denied until something in this file widens it. Exactly two things do, and
   both require the user to have physically chosen the file:

     1. a native dialog they just clicked through (the two commands below),
     2. a real OS drag-drop event, observed here in the Rust process.

   A path the frontend picked for itself is never honoured. So the blast
   radius of any future parser bug is one file: the one the user opened. */

use std::path::Path;

use tauri::{DragDropEvent, Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_fs::FsExt;

/// The formats write can actually open. A drop of anything else is ignored
/// rather than scoped — dropping a file on a word processor says "open this",
/// and nothing write can open lives outside this list.
const OPENABLE: &[&str] = &["docx", "html", "htm", "txt", "png", "jpg", "jpeg", "gif"];

fn is_openable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| OPENABLE.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Widen the scope to this one file, then hand the path back to the frontend.
/// Returning the path is safe precisely because the grant already happened
/// here — the frontend is being told what it may touch, not choosing it.
fn grant(app: &tauri::AppHandle, picked: FilePath) -> Option<String> {
    let path = picked.into_path().ok()?;
    app.fs_scope().allow_file(&path).ok()?;
    Some(path.to_string_lossy().into_owned())
}

/* Both commands are `async` so Tauri runs them off the main thread, which is
   what makes the blocking dialog calls legal — a blocking dialog on the main
   thread deadlocks the UI on macOS and Windows alike. */

#[tauri::command]
async fn pick_document_to_open(app: tauri::AppHandle) -> Option<String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Documents", &["docx", "html", "htm", "txt"])
        .add_filter("Word document", &["docx"])
        .blocking_pick_file()?;
    grant(&app, picked)
}

#[tauri::command]
async fn pick_document_to_save(app: tauri::AppHandle, default_name: String) -> Option<String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter("Word document", &["docx"])
        .add_filter("Web page", &["html"])
        .blocking_save_file()?;
    grant(&app, picked)
}

/* No tray icon. write had one -- a themed badge with Show/Quit -- and it was
   removed in Session 35 (Brett: "am not sure it is really serving us here").
   It earned nothing: the app is a single ordinary window that the taskbar
   already represents, it never minimised to the tray, and the badge's only
   real behaviour was to re-show a window that was never hidden. The artwork
   is gone with it (icons/tray/), as is the tray-icon Cargo feature. */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            pick_document_to_open,
            pick_document_to_save
        ])
        .on_window_event(|window, event| {
            /* Dropping a file on the window is the user handing it over just
               as deliberately as the Open dialog is — but the paths are also
               delivered to the webview, and a compromised frontend could ask
               to read any path it fancied. Observing the real OS event here
               is the whole difference: only paths the operating system
               actually dropped on this window are ever scoped. */
            if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                let scope = window.app_handle().fs_scope();
                for path in paths.iter().filter(|p| is_openable(p)) {
                    let _ = scope.allow_file(path);
                }
            }
            /* ThemeChanged was handled here only to repaint the tray badge.
               The app's own light/dark is chosen by the room, not the OS, so
               with the tray gone there is nothing left to react to. */
        })
        .run(tauri::generate_context!())
        .expect("error while running write");
}
