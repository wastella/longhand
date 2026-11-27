#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod documents;
mod feedback;
mod files;
mod menu;
mod prefs;
mod pytest;
mod system;
mod term;
mod tutor;
mod workspace;

use tauri::{LogicalPosition, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_window_state::StateFlags;
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

/// Stops everything the app started, so nothing outlives it: every terminal's session, the
/// tutor's runs and its warm lookup process, and any test run (waiting for it, then removing the
/// pytest reporter). Runs once, from whichever comes first: the window being destroyed (closing
/// it) or the app exiting (Quit, which exits without destroying the window).
fn stop_processes(app: &tauri::AppHandle) {
    static STOPPED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if STOPPED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let state = app.state::<AppState>();
    term::kill(&state);
    tutor::cancel(&state);
    pytest::shutdown(&state);
}

fn main() {
    ensure_user_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Remembers the window's size and position. Visibility is left out: a window saved while
        // the app was hidden would otherwise never show again. The window is shown below instead.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE - StateFlags::DECORATIONS)
                .build(),
        )
        .manage(AppState::default())
        .manage(files::FilesState::default())
        .setup(|app| {
            menu::build(app)?;
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Longhand")
                .inner_size(1440.0, 900.0)
                // Below about 800px wide the tutor and then the files panel fold away (shell/layout.js).
                .min_inner_size(720.0, 480.0)
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                // Centres the window buttons in the 38px title bar (--titlebar-height).
                .traffic_light_position(LogicalPosition::new(16.0, 13.0))
                // Hidden until the saved size and position are restored, so it does not jump.
                .visible(false)
                // The window only ever shows the app itself; links open in the browser.
                .on_navigation(|url| matches!(url.scheme(), "tauri" | "about"))
                .build()?;
            window.show()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                stop_processes(window.app_handle());
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
            // The editor's open documents (documents.rs).
            documents::doc_read,
            documents::doc_write,
            documents::doc_stat,
            system::confirm,
            system::open_external,
            system::smoke_result,
            system::app_quit,
            // Shell: app-wide settings, recent folders, layout, appearance and the shortcut list
            prefs::settings_set,
            prefs::recents_list,
            prefs::recent_forget,
            prefs::layout_save,
            workspace::folder_check,
            system::window_set_theme,
            menu::shortcuts_list,
            // The terminals (term.rs).
            term::term_start,
            term::term_reset,
            term::term_input,
            term::term_resize,
            term::term_ack,
            term::term_close,
            term::term_busy,
            term::term_run_command,
            term::term_resolve,
            pytest::tests_run,
            pytest::tests_cancel,
            // The tutor: requests on independent threads, their transcripts and the usage record.
            tutor::auth_status,
            tutor::tutor_request,
            tutor::tutor_prepare,
            tutor::tutor_cancel,
            tutor::tutor_threads,
            tutor::tutor_thread,
            tutor::tutor_record,
            // Feedback: the tutor's margin notes, kept per folder (feedback.rs).
            feedback::feedback_notes_load,
            feedback::feedback_notes_save,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Longhand")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                stop_processes(app);
            }
        });
}
