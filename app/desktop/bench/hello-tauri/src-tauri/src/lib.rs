// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // The benchmark reads this marker to measure process-to-app startup.
            // Use the platform temp directory rather than a developer-specific path.
            let marker = std::env::temp_dir().join("harness-bench-tauri-marker.txt");
            std::fs::write(
                marker,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("system clock must be after Unix epoch")
                    .as_millis()
                    .to_string(),
            )?;
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
