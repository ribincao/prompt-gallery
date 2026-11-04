//! Current-library-only asset responses, independent of Tauri's additive scope grants.
use crate::library;
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
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
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "m4v" => "video/x-m4v",
        _ => return denied(),
    };
    let Ok(mut file) = fs::File::open(&path) else {
        return base.status(404).body(vec![]).unwrap();
    };
    let Ok(meta) = file.metadata() else {
        return base.status(404).body(vec![]).unwrap();
    };
    let len = meta.len();
    let base = base
        .header("Content-Type", mime)
        .header("Accept-Ranges", "bytes");
    // HEAD describes the full representation and ignores Range (RFC 9110).
    if request.method() == "HEAD" {
        return base.header("Content-Length", len).body(vec![]).unwrap();
    }
    let range = request.headers().get("Range");
    let (start, end, partial) = if let Some(range) = range {
        match range.to_str().ok().and_then(|r| byte_range(r, len)) {
            Some((start, end)) => (start, end, true),
            None => {
                return base
                    .status(416)
                    .header("Content-Range", format!("bytes */{len}"))
                    .header("Content-Length", 0)
                    .body(vec![])
                    .unwrap()
            }
        }
    } else if library::is_video(&path) && len > CHUNK {
        (0, CHUNK - 1, true)
    } else {
        (0, len.saturating_sub(1), false)
    };
    // Even an explicit huge range must never allocate a full video in memory.
    let (end, partial) = if library::is_video(&path) && end.saturating_sub(start) >= CHUNK {
        (start + CHUNK - 1, true)
    } else {
        (end, partial)
    };
    let size = if len == 0 { 0 } else { end - start + 1 };
    let mut bytes = vec![0; size as usize];
    if file
        .seek(SeekFrom::Start(start))
        .and_then(|_| file.read_exact(&mut bytes))
        .is_err()
    {
        return base.status(500).body(vec![]).unwrap();
    }
    let base = base.header("Content-Length", size);
    let base = if partial {
        base.status(206)
            .header("Content-Range", format!("bytes {start}-{end}/{len}"))
    } else {
        base
    };
    base.body(bytes).unwrap()
}

const CHUNK: u64 = 4 * 1024 * 1024;
fn byte_range(value: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let (a, b) = value.strip_prefix("bytes=")?.split_once('-')?;
    if a.is_empty() {
        let suffix = b.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some((len.saturating_sub(suffix), len - 1));
    }
    let start = a.parse::<u64>().ok()?;
    if start >= len {
        return None;
    }
    let end = if b.is_empty() {
        start.saturating_add(CHUNK - 1).min(len - 1)
    } else {
        b.parse::<u64>().ok()?.min(len - 1)
    };
    (end >= start).then_some((start, end))
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
    fn video_ranges_head_and_bounds() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("video.mp4");
        fs::write(&path, b"0123456789").unwrap();
        for (range, expected, content_range) in [
            ("bytes=0-2", "012", "bytes 0-2/10"),
            ("bytes=4-6", "456", "bytes 4-6/10"),
            ("bytes=-3", "789", "bytes 7-9/10"),
            ("bytes=7-", "789", "bytes 7-9/10"),
        ] {
            let mut request = get(&path);
            request
                .headers_mut()
                .insert("Range", range.parse().unwrap());
            let r = response(Some(root.path()), request);
            assert_eq!(r.status(), 206);
            assert_eq!(r.body(), expected.as_bytes());
            assert_eq!(r.headers()["Content-Range"], content_range);
            assert_eq!(r.headers()["Content-Length"], "3");
        }
        for range in [
            "bytes=10-",
            "bytes=4-2",
            "bytes=-0",
            "bytes=0-1,3-4",
            "junk",
        ] {
            let mut request = get(&path);
            request
                .headers_mut()
                .insert("Range", range.parse().unwrap());
            let r = response(Some(root.path()), request);
            assert_eq!(r.status(), 416);
            assert_eq!(r.headers()["Content-Range"], "bytes */10");
        }
        let mut request = get(&path);
        *request.method_mut() = tauri::http::Method::HEAD;
        request
            .headers_mut()
            .insert("Range", "bytes=0-2".parse().unwrap());
        let r = response(Some(root.path()), request);
        assert_eq!(r.status(), 200);
        assert!(r.body().is_empty());
        assert_eq!(r.headers()["Content-Length"], "10");
        assert_eq!(r.headers()["Accept-Ranges"], "bytes");
        let outside = tempfile::tempdir().unwrap();
        assert_eq!(response(Some(outside.path()), get(&path)).status(), 403);
        assert_eq!(byte_range("bytes=0-", CHUNK * 3), Some((0, CHUNK - 1)));
    }
    #[test]
    fn generated_video_temp_library_smoke() {
        let Ok(input) = std::env::var("PGALLERY_TEST_VIDEO") else {
            return;
        };
        let root = tempfile::tempdir().unwrap();
        let root = library::open_library(root.path(), false).unwrap();
        let s = library::import_source(&root, Some(Path::new(&input)), None, vec![]).unwrap();
        let path = root.join("sources").join(s.file);
        let mut request = get(&path);
        request
            .headers_mut()
            .insert("Range", "bytes=4-15".parse().unwrap());
        let r = response(Some(&root), request);
        assert_eq!(r.status(), 206);
        assert_eq!(r.body(), &fs::read(input).unwrap()[4..16]);
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
