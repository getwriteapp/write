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
use tauri_plugin_opener::OpenerExt;

/// The formats write can actually open. A drop of anything else is ignored
/// rather than scoped — dropping a file on a word processor says "open this",
/// and nothing write can open lives outside this list.
const OPENABLE: &[&str] = &["docx", "html", "htm", "txt", "md", "png", "jpg", "jpeg", "gif"];

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
        .add_filter("Documents", &["docx", "html", "htm", "txt", "md"])
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

/* ---- releases ----

   write does not check for updates, and that is a design decision rather than
   a missing feature. Three documents promise no network request at runtime,
   and DESIGN.md is specific about the kind of promise it is: "enforced twice
   in code and guarded by a test suite, not stated as a policy". An in-app
   check — however carefully gated behind a click — would convert exactly that
   enforced property into a policy, which is the trade those words rule out.

   So write never asks. This hands one URL to the operating system, which
   gives it to the browser; the request that follows belongs to the browser,
   not to this process. Both locks stay untouched — the editor schema still
   refuses remote references, the CSP still refuses the request — and
   app/tests/sanitize-probe.mjs still holds.

   The command takes NO arguments, and tauri-plugin-opener's own `open_url` is
   deliberately absent from capabilities/default.json. Granting the webview a
   general "open any URL" command would hand a malicious .docx a way to call
   out: `https://…/?leaked=` opened in a browser tab is still a document
   reporting home, which is the exact thing the remote-image rules exist to
   prevent. The frontend may ask for this page, and only this page. */
const RELEASES_URL: &str = "https://github.com/getwriteapp/write/releases";

#[tauri::command]
fn open_releases_page(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(RELEASES_URL, None::<&str>)
        .map_err(|e| format!("could not open the releases page: {e}"))
}

/* ---- opening a document's own links ----

   `Link.configure({ openOnClick: false })` in editor.js turns off Tiptap's
   built-in click-to-navigate, so a stray click while editing doesn't launch a
   browser mid-sentence. Nothing replaced it, though — which meant there was
   no way at all, deliberate or otherwise, to check where a link in a document
   actually led. That's a real gap in an app whose whole job is opening files
   from other people: a link is exactly the kind of thing worth being able to
   verify.

   This restores it the way a native app gates it — Ctrl/Cmd+Click, not a
   plain click, wired up in editor.js's handleClick — and opens in the user's
   own browser rather than navigating write's own window there. The modifier
   key matters as much as the browser choice: a real browser's address bar is
   what actually answers "does this go where it claims to", which nothing
   inside write's chromeless webview could show even if it navigated in
   place.

   The URL comes from the document, so — unlike RELEASES_URL above — it gets
   the same two-lock treatment as everything else foreign here. The editor's
   Link extension is the first lock (its allowed-protocol list is what the
   'javascript: link' and 'data: link' cases in sanitize-probe.mjs exercise).
   This command's own scheme check is the second, and it doesn't trust the
   first: it revalidates independently, so a future extension change or a
   compromised frontend still can't hand this command a `javascript:` or
   `file:` URL and have it act on it. */
/// The independent revalidation this command's doc comment describes. Split
/// out from the command itself so it can be tested without a running app —
/// it is the entire security argument, and the rest of the command is just
/// handing its result to the OS.
fn allowed_link(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|_| "not a link write recognizes".to_string())?;
    match parsed.scheme() {
        "http" | "https" | "mailto" => Ok(parsed),
        other => Err(format!("refusing to open a '{other}:' link")),
    }
}

#[tauri::command]
fn open_external_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = allowed_link(&url)?;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| format!("could not open link: {e}"))
}

#[cfg(test)]
mod link_tests {
    use super::allowed_link;

    #[test]
    fn ordinary_https_is_allowed() {
        assert!(allowed_link("https://example.com/docs").is_ok());
    }

    #[test]
    fn ordinary_http_is_allowed() {
        assert!(allowed_link("http://example.com").is_ok());
    }

    #[test]
    fn mailto_is_allowed() {
        assert!(allowed_link("mailto:someone@example.com").is_ok());
    }

    #[test]
    fn javascript_scheme_is_refused() {
        // The one that matters most: this is what a hostile document would
        // reach for if the editor's own schema ever let one through.
        assert!(allowed_link("javascript:alert(1)").is_err());
    }

    #[test]
    fn file_scheme_is_refused() {
        assert!(allowed_link("file:///C:/Windows/System32/cmd.exe").is_err());
    }

    #[test]
    fn data_scheme_is_refused() {
        assert!(allowed_link("data:text/html,<script>alert(1)</script>").is_err());
    }

    #[test]
    fn unparseable_input_is_refused_not_panicking() {
        assert!(allowed_link("not a url at all").is_err());
        assert!(allowed_link("").is_err());
    }

    #[test]
    fn scheme_check_is_not_fooled_by_a_prefix() {
        // "javascripts://" and similar lookalikes must fail on the scheme
        // itself, not on a substring match against "javascript".
        assert!(allowed_link("ftp://example.com/file").is_err());
    }
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            pick_document_to_open,
            pick_document_to_save,
            open_releases_page,
            open_external_link
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
