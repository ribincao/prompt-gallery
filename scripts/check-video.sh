#!/bin/bash
# Isolated media smoke check; never resolves the user's configured library.
set -euo pipefail
cd "$(dirname "$0")/.."
fixture_dir=$(mktemp -d /tmp/pgallery-video.XXXXXX)
trap 'rm -rf "$fixture_dir"' EXIT
mkdir "$fixture_dir/library" "$fixture_dir/config"
if ! command -v ffmpeg >/dev/null; then
  echo 'SKIP: ffmpeg unavailable; provide a generated MP4 for the handler test.'
  exit 0
fi
ffmpeg -y -f lavfi -i color=c=blue:s=160x120:d=1 -c:v libx264 -pix_fmt yuv420p "$fixture_dir/test.mp4" -loglevel error
# Native poster checks are explicit opt-in; normal automated checks never run Quick Look.
if [[ ${PGALLERY_CHECK_REAL_POSTERS:-0} == 1 ]]; then
  unset PROMPT_GALLERY_DISABLE_POSTERS
else
  export PROMPT_GALLERY_DISABLE_POSTERS=1
fi
PROMPT_GALLERY_CONFIG_DIR="$fixture_dir/config" src-tauri/target/debug/pgallery add \
  --library "$fixture_dir/library" --prompt-text 'Video smoke check' \
  --result "$fixture_dir/test.mp4" --source "$fixture_dir/test.mp4" --source-folder Tests --json
if [[ ${PGALLERY_CHECK_REAL_POSTERS:-0} != 1 ]]; then
  echo 'SKIP: native posters disabled; use PGALLERY_CHECK_REAL_POSTERS=1 outside the sandbox'
elif find "$fixture_dir/library/.thumbs" -name '*.jpg' | read -r poster; then
  echo 'PASS: video poster exists'
else
  echo 'UNVERIFIED: Quick Look produced no poster; check outside the sandbox'
fi
cd src-tauri
PGALLERY_TEST_VIDEO="$fixture_dir/test.mp4" PROMPT_GALLERY_CONFIG_DIR="$fixture_dir/config" cargo test generated_video_temp_library_smoke -- --nocapture
