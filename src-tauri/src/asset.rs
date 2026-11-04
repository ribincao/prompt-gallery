//! Current-library-only asset responses, independent of Tauri's additive scope grants.
use crate::library;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::RwLock,
};
use tauri::http::{Request, Response};

#[derive(Default)]
pub struct AssetPolicy(pub RwLock<Option<PathBuf>>);

pub fn response(root: Option<&Path>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let base = Response::builder()
        .header("Access-Control-Allow-Origin", "tauri://localhost")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    let denied = || {
        Response::builder()
            .status(403)
            .header("Cache-Control", "no-store")
            .body(Vec::new())
            .unwrap()
    };
    let Some(root) = root else {
        return denied();
    };
    if request.method() != "GET" && request.method() != "HEAD" {
        return base.status(405).body(Vec::new()).unwrap();
    }
    // convertFileSrc percent-encodes the absolute path as a single URI component.
    // Url's file-path conversion decodes it without adding another dependency.
    let encoded = request
        .uri()
        .path()
        .strip_prefix('/')
        .unwrap_or(request.uri().path());
    let Some(path) = tauri::Url::parse(&format!("file:///{encoded}"))
        .ok()
        .and_then(|u| u.to_file_path().ok())
    else {
        return denied();
    };
    let path: PathBuf = path.components().collect();
    let Ok(path) = library::owned_file(root, &path) else {
        return denied();
    };
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "gif" => "image/gif",
        _ => return denied(),
    };
    match fs::read(path) {
        Ok(bytes) => base
            .header("Content-Type", mime)
            .header("Content-Length", bytes.len())
            .body(if request.method() == "HEAD" {
                Vec::new()
            } else {
                bytes
            })
            .unwrap(),
        Err(_) => base.status(404).body(Vec::new()).unwrap(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn get(path: &Path) -> Request<Vec<u8>> {
        let encoded: String = path
            .to_string_lossy()
            .as_bytes()
            .iter()
            .map(|b| format!("%{b:02X}"))
            .collect();
        Request::builder()
            .uri(format!("asset://localhost/{encoded}"))
            .body(vec![])
            .unwrap()
    }
    #[test]
    fn first_choice_and_switches_enforce_the_live_root_without_restarting() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let image_a = a.path().join("portrait # 你好.PNG");
        let image_b = b.path().join("other.png");
        fs::write(&image_a, b"image a").unwrap();
        fs::write(&image_b, b"image b").unwrap();
        let policy = AssetPolicy::default();
        assert_eq!(
            response(policy.0.read().unwrap().as_deref(), get(&image_a)).status(),
            403
        );
        for (root, allowed, rejected) in [
            (a.path(), &image_a, &image_b),
            (b.path(), &image_b, &image_a),
            (a.path(), &image_a, &image_b),
        ] {
            *policy.0.write().unwrap() = Some(root.to_path_buf());
            let active = policy.0.read().unwrap();
            let result = response(active.as_deref(), get(allowed));
            assert_eq!(result.status(), 200);
            assert!(!result.body().is_empty());
            assert_eq!(result.headers()["Cache-Control"], "no-store");
            assert_eq!(response(active.as_deref(), get(rejected)).status(), 403);
        }
    }
    #[test]
    fn refuses_non_images_traversal_and_external_symlinks() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = root.path().join("library.json");
        fs::write(&secret, "secret").unwrap();
        assert_eq!(response(Some(root.path()), get(&secret)).status(), 403);
        let external = outside.path().join("private.png");
        fs::write(&external, "private").unwrap();
        let escape = root
            .path()
            .join("..")
            .join(outside.path().file_name().unwrap())
            .join("private.png");
        assert_eq!(response(Some(root.path()), get(&escape)).status(), 403);
        #[cfg(unix)]
        {
            let link = root.path().join("linked.png");
            std::os::unix::fs::symlink(external, &link).unwrap();
            assert_eq!(response(Some(root.path()), get(&link)).status(), 403);
        }
    }
}
