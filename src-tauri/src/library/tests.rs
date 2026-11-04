use super::*;
use tempfile::tempdir;
fn meta() -> PromptInput {
    PromptInput {
        title: "Portrait".into(),
        needs: vec!["single".into()],
        ..Default::default()
    }
}
#[test]
fn round_trip_copy_and_exact_text() {
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    assert!(root.join("library.json").exists());
    assert!(root.join("sources").is_dir());
    assert!(root.join("prompts").is_dir());
    let input = tempdir().unwrap();
    let original = input.path().join("Photo.JPG");
    fs::write(&original, b"original bytes").unwrap();
    let s = import_source(&root, Some(&original), None, vec!["single".into()]).unwrap();
    assert_eq!(fs::read(&original).unwrap(), b"original bytes");
    assert_eq!(
        fs::read(root.join("sources").join(&s.file)).unwrap(),
        b"original bytes"
    );
    assert!(s.file.ends_with(".JPG"));
    let text = "  exact text\n\nwith trailing space \n";
    let p = create_prompt(&root, meta(), text.into()).unwrap();
    let rid = add_result(
        &root,
        &p,
        Some(&original),
        None,
        ResultInput {
            source_photos: vec![s.id.clone()],
            chat_url: "https://chatgpt.com/c/test".into(),
            model: "ChatGPT".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let lib = load_library(&root).unwrap();
    assert!(lib.warnings.is_empty());
    assert_eq!(lib.sources.len(), 1);
    assert_eq!(lib.prompts[0].text, text);
    assert_eq!(lib.prompts[0].results[0].meta.id, rid);
    assert_eq!(
        lib.prompts[0].results[0].meta.fields.source_photos,
        vec![s.id]
    );
}
#[test]
fn malformed_records_are_preserved_and_reported() {
    let d = tempdir().unwrap();
    let r = open_library(d.path(), false).unwrap();
    let p = r.join("sources/20261104-120000-abcd.json");
    fs::write(&p, b"{bad").unwrap();
    let lib = load_library(&r).unwrap();
    assert!(lib.sources.is_empty());
    assert!(lib
        .warnings
        .iter()
        .any(|w| w.contains("20261104-120000-abcd.json")));
    assert_eq!(fs::read(&p).unwrap(), b"{bad");
    assert!(update_source(&r, "20261104-120000-abcd", vec![], "".into()).is_err());
    assert_eq!(fs::read(&p).unwrap(), b"{bad");
}
#[test]
fn atomic_writes_leave_no_temp_files() {
    let d = tempdir().unwrap();
    let p = d.path().join("record.json");
    atomic_write(&p, b"first").unwrap();
    atomic_write(&p, b"second").unwrap();
    assert_eq!(fs::read(p).unwrap(), b"second");
    assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
}
#[test]
fn nonempty_confirmation_and_bad_marker() {
    let d = tempdir().unwrap();
    fs::write(d.path().join("keep.txt"), "keep").unwrap();
    assert_eq!(
        open_library(d.path(), false).unwrap_err(),
        "CONFIRM_NONEMPTY"
    );
    open_library(d.path(), true).unwrap();
    fs::write(d.path().join("library.json"), "broken").unwrap();
    assert!(open_library(d.path(), true).is_err());
    assert_eq!(
        fs::read_to_string(d.path().join("library.json")).unwrap(),
        "broken"
    );
}
#[test]
fn rejects_path_traversal_and_symlinks() {
    let d = tempdir().unwrap();
    let r = open_library(d.path(), false).unwrap();
    assert!(safe(&r, "../escape").is_err());
    assert!(valid_id("../../file").is_err());
    #[cfg(unix)]
    {
        let outside = tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), r.join("sources/link")).unwrap();
        assert!(safe(&r, "sources/link/test.json").is_err());
    }
}
#[test]
fn edits_and_missing_source_reference_roundtrip() {
    let d = tempdir().unwrap();
    let r = open_library(d.path(), false).unwrap();
    let sid = import_source(&r, None, Some(b"\x89PNG\r\n\x1a\nfake"), vec![])
        .unwrap()
        .id;
    update_source(&r, &sid, vec!["custom".into()], "note".into()).unwrap();
    let p = create_prompt(&r, meta(), "old".into()).unwrap();
    let mut m = meta();
    m.favorite = true;
    update_prompt(&r, &p, m, "new".into()).unwrap();
    let rid = add_result(
        &r,
        &p,
        None,
        Some(b"\x89PNG\r\n\x1a\nfake"),
        ResultInput {
            source_photos: vec![sid],
            ..Default::default()
        },
    )
    .unwrap();
    update_result(
        &r,
        &p,
        &rid,
        ResultInput {
            source_photos: vec!["20261104-120000-dead".into()],
            favorite: true,
            ..Default::default()
        },
    )
    .unwrap();
    let lib = load_library(&r).unwrap();
    assert!(lib.tags.contains(&"custom".into()));
    assert_eq!(lib.sources[0].meta.note, "note");
    assert_eq!(lib.prompts[0].text, "new");
    assert!(lib.prompts[0].meta.fields.favorite);
    assert!(lib.prompts[0].results[0].meta.fields.favorite);
}

#[test]
fn metadata_matches_spec_without_ui_fields() {
    let d = tempdir().unwrap();
    let r = open_library(d.path(), false).unwrap();
    let s = import_source(&r, None, Some(b"\x89PNG\r\n\x1a\nfake"), vec![]).unwrap();
    let json: serde_json::Value = read(&r.join(format!("sources/{}.json", s.id))).unwrap();
    let keys: Vec<_> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        ["createdAt", "file", "id", "note", "originalName", "tags"]
    );
    let p = create_prompt(&r, meta(), "text".into()).unwrap();
    let json: serde_json::Value = read(&r.join(format!("prompts/{p}/meta.json"))).unwrap();
    assert!(json.get("fields").is_none());
    assert!(json.get("sourceUrl").is_some());
    assert!(json.get("updatedAt").is_some());
    assert!(json.get("text").is_none());
}

#[test]
fn corrupt_prompts_and_results_do_not_hide_valid_items() {
    let d = tempdir().unwrap();
    let r = open_library(d.path(), false).unwrap();
    let good = create_prompt(&r, meta(), "valid".into()).unwrap();
    let bad = create_prompt(&r, meta(), "invalid metadata".into()).unwrap();
    let bad_meta = r.join(format!("prompts/{bad}/meta.json"));
    fs::write(&bad_meta, "{bad").unwrap();
    let bad_result = r.join(format!("prompts/{good}/results/20261104-120000-abcd.json"));
    fs::write(&bad_result, "{bad").unwrap();
    let lib = load_library(&r).unwrap();
    assert_eq!(lib.prompts.len(), 1);
    assert_eq!(lib.prompts[0].meta.id, good);
    assert_eq!(lib.warnings.len(), 2);
    assert!(update_prompt(&r, &bad, meta(), "replacement".into()).is_err());
    assert_eq!(fs::read_to_string(bad_meta).unwrap(), "{bad");
    assert_eq!(fs::read_to_string(bad_result).unwrap(), "{bad");
}

#[test]
fn failed_atomic_write_cleans_only_its_own_temporary_file() {
    let d = tempdir().unwrap();
    let target = d.path().join("directory");
    fs::create_dir(&target).unwrap();
    fs::write(target.join("keep"), "untouched").unwrap();
    assert!(atomic_write(&target, b"replacement").is_err());
    assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    assert_eq!(
        fs::read_to_string(target.join("keep")).unwrap(),
        "untouched"
    );
}

#[test]
fn dotfiles_and_hidden_directories_are_ignored_in_every_scan() {
    let d = tempdir().unwrap();
    let root = open_library(d.path(), false).unwrap();
    let p = create_prompt(&root, meta(), "valid".into()).unwrap();
    let s = import_source(&root, None, Some(b"\x89PNG\r\n\x1a\nfake"), vec![]).unwrap();
    let result = add_result(
        &root,
        &p,
        None,
        Some(b"\x89PNG\r\n\x1a\nfake"),
        ResultInput::default(),
    )
    .unwrap();
    for dir in [
        "sources".to_string(),
        "prompts".to_string(),
        format!("prompts/{p}/results"),
    ] {
        for hidden in [
            ".DS_Store",
            "._20261104-120000-abcd.json",
            ".write-incomplete.tmp",
        ] {
            fs::write(root.join(&dir).join(hidden), "not JSON").unwrap();
        }
        fs::create_dir(root.join(&dir).join(".hidden-folder")).unwrap();
    }
    let lib = load_library(&root).unwrap();
    assert!(lib.warnings.is_empty(), "{:?}", lib.warnings);
    assert_eq!(lib.sources[0].meta.id, s.id);
    assert_eq!(lib.prompts[0].meta.id, p);
    assert_eq!(lib.prompts[0].results[0].meta.id, result);
    assert!(root.join("prompts/.DS_Store").exists());
}

#[test]
fn stale_tag_lock_is_replaced() {
    use std::time::{Duration, SystemTime};
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    let path = root.join(".prompt-gallery.lock");
    fs::write(&path, "abandoned").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(SystemTime::now() - Duration::from_secs(31)))
        .unwrap();
    set_tags(&root, vec!["new".into()]).unwrap();
    assert!(marker(&root).unwrap().tags.contains(&"new".into()));
    assert!(!path.exists());
}
#[test]
fn simultaneous_tag_merges_keep_both() {
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let threads: Vec<_> = ["alpha", "beta"]
        .into_iter()
        .map(|tag| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                set_tags(&root, vec![tag.into()]).unwrap();
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    let tags = marker(&root).unwrap().tags;
    assert!(tags.contains(&"alpha".into()) && tags.contains(&"beta".into()));
    assert!(!root.join(".prompt-gallery.lock").exists());
}

#[test]
fn tag_lock_released_on_error() {
    let dir = tempdir().unwrap();
    let root = open_library(dir.path(), false).unwrap();
    fs::write(root.join("library.json"), "corrupt").unwrap();
    assert!(set_tags(&root, vec!["tag".into()]).is_err());
    assert!(!root.join(".prompt-gallery.lock").exists());
    assert_eq!(
        fs::read_to_string(root.join("library.json")).unwrap(),
        "corrupt"
    );
}
