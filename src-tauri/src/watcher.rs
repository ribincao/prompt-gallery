use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::{
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct WatchState(pub Mutex<Option<Box<dyn Watcher + Send>>>);

fn relevant(root: &Path, event: &Event) -> bool {
    !matches!(event.kind, EventKind::Access(_))
        && event.paths.iter().any(|path| {
            path.strip_prefix(root).is_ok_and(|relative| {
                !relative.as_os_str().is_empty()
                    && !path.is_dir()
                    && !relative
                        .components()
                        .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
            })
        })
}
const QUIET: Duration = Duration::from_millis(400);
fn ready(last: Option<Instant>, now: Instant) -> bool {
    last.is_some_and(|t| now.duration_since(t) >= QUIET)
}
fn watch(
    root: &Path,
    tx: mpsc::Sender<notify::Result<Event>>,
) -> Result<Box<dyn Watcher + Send>, String> {
    let native_tx = tx.clone();
    let native = notify::recommended_watcher(move |event| {
        let _ = native_tx.send(event);
    })
    .and_then(|mut watcher| {
        watcher.watch(root, RecursiveMode::Recursive)?;
        Ok(watcher)
    });
    match native {
        Ok(watcher) => Ok(Box::new(watcher)),
        Err(error) => {
            eprintln!("Native library watcher unavailable ({error}); using polling");
            let mut watcher = notify::PollWatcher::new(
                move |event| {
                    let _ = tx.send(event);
                },
                notify::Config::default()
                    .with_poll_interval(QUIET)
                    .with_compare_contents(true),
            )
            .map_err(|e| e.to_string())?;
            watcher
                .watch(root, RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
            Ok(Box::new(watcher))
        }
    }
}
pub fn start(app: AppHandle, root: PathBuf) -> Result<Box<dyn Watcher + Send>, String> {
    let (tx, rx) = mpsc::channel();
    let watcher = watch(&root, tx)?;
    // Dropping/replacing the watcher disconnects the channel and stops this worker.
    std::thread::spawn(move || {
        let mut last = None;
        loop {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(Ok(event)) if relevant(&root, &event) => last = Some(Instant::now()),
                Ok(Err(error)) => {
                    eprintln!("Library watcher: {error}");
                    last = Some(Instant::now());
                }
                Ok(_) => (),
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => (),
            }
            if ready(last, Instant::now()) {
                let _ = app.emit("library-changed", root.to_string_lossy().as_ref());
                last = None;
            }
        }
    });
    Ok(watcher)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filters_and_debounces() {
        let root = Path::new("/library");
        for path in [
            ".thumbs/x.jpg",
            "prompts/a/.write.tmp",
            ".prompt-gallery.lock",
        ] {
            assert!(!relevant(
                root,
                &Event::new(EventKind::Any).add_path(root.join(path))
            ));
        }
        assert!(relevant(
            root,
            &Event::new(EventKind::Any).add_path(root.join("prompts/a/meta.json"))
        ));
        assert!(!relevant(
            root,
            &Event::new(EventKind::Any).add_path("/outside/meta.json".into())
        ));
        let now = Instant::now();
        assert!(!ready(Some(now), now + Duration::from_millis(399)));
        assert!(ready(Some(now), now + QUIET));
        assert!(!ready(None, now));
    }
    #[test]
    fn watcher_observes_atomic_library_writes() {
        let dir = tempfile::tempdir().unwrap();
        let root = crate::library::open_library(dir.path(), false).unwrap();
        let (tx, rx) = mpsc::channel();
        let _watcher = watch(&root, tx).unwrap();
        crate::library::set_tags(&root, vec!["external".into()]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let event = rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .unwrap()
                .unwrap();
            if relevant(&root, &event) {
                break;
            }
        }
    }
}
