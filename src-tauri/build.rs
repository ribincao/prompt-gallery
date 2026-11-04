fn main() {
    // tauri-cli 2.9 sets this obsolete Windows-only variable even on macOS.
    // Do not pass it to newer tauri-build versions on a non-Windows target.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        std::env::remove_var("STATIC_VCRUNTIME");
    }
    tauri_build::build()
}
