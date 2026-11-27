#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod menu;
mod pytest;
mod system;
mod term;
mod tutor;
mod workspace;

use tauri::{Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
use workspace::AppState;

/// Claude Code finds its login through the user's name, which a bare launch environment may lack.
fn ensure_user_env() {
    if std::env::var_os("USER").is_some() {
        return;
    }
    let name = unsafe {
        let pw = libc::getpwuid(libc::getuid());
        if pw.is_null() {
            return;
        }
        std::ffi::CStr::from_ptr((*pw).pw_name).to_string_lossy().to_string()
    };
    std::env::set_var("USER", name);
}

fn main() {
    ensure_user_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(files::FilesState::default())
        .setup(|app| {
            menu::build(app)?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Longhand")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 560.0)
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                // The window only ever shows the app itself; links open in the browser.
                .on_navigation(|url| matches!(url.scheme(), "tauri" | "about"))
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                term::kill(&state);
                tutor::cancel(&state);
                pytest::cancel(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            workspace::app_init,
            workspace::workspace_choose,
            workspace::workspace_open,
            workspace::config_set,
            workspace::log_record,
            workspace::log_summary,
            files::fs_list,
            files::fs_read,
            files::fs_write,
            files::fs_mtime,
            files::fs_create,
            files::fs_rename,
            files::fs_trash,
            // Files area: quick open, find in files, watching, Finder, the tree's memory.
            files::fs_search,
            files::fs_files,
            files::fs_watch,
            files::fs_reveal,
            files::files_memory_load,
            files::files_memory_save,
            system::confirm,
            system::open_external,
            system::smoke_result,
            // The terminals (term.rs).
            term::term_start,
            term::term_input,
            term::term_resize,
            term::term_ack,
            term::term_close,
            term::term_busy,
            term::term_run_command,
            term::term_resolve,
            pytest::tests_run,
            pytest::tests_cancel,
            tutor::auth_status,
            tutor::tutor_ask,
            tutor::tutor_cancel,
            tutor::tutor_reset,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Longhand")
        .run(|app, event| {
            // Quitting from the menu may skip the window's Destroyed event; the terminals'
            // processes must not outlive the app either way.
            if let tauri::RunEvent::Exit = event {
                term::kill(&app.state::<AppState>());
            }
        });
}
