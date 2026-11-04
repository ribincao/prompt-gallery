#!/bin/bash
# Back up a Prompt Gallery library to an S3-compatible bucket (Cloudflare R2).
#
# The bucket mirrors the library: new or changed files are uploaded (aws s3 sync compares
# size and modified time). Files deleted locally are never erased from the bucket; they are
# moved to deleted/<YYYY-MM-DD>/<same path>, so a restore brings back only the current
# library and deleted items stay recoverable. Thumbnails are skipped; the app rebuilds them.
#
#   scripts/backup-r2.sh                  back up now
#   scripts/backup-r2.sh --dryrun         show what would be uploaded or moved to deleted/
#   scripts/backup-r2.sh --force          allow moving more than 100 files to deleted/
#   scripts/backup-r2.sh --restore <empty-folder>   download the current library (not deleted/)
#
# Settings come from ~/.config/prompt-gallery/r2-backup.env (override with PG_BACKUP_ENV):
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, optional R2_PREFIX.
# The library is PROMPT_GALLERY_LIBRARY, else the app's configured library.
set -euo pipefail

env_file=${PG_BACKUP_ENV:-$HOME/.config/prompt-gallery/r2-backup.env}
[ -r "$env_file" ] || { echo "backup: missing $env_file" >&2; exit 1; }
set -a; . "$env_file"; set +a
for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  [ -n "${!v:-}" ] || { echo "backup: $v is empty in $env_file" >&2; exit 1; }
done

aws=$(command -v aws || true)
[ -n "$aws" ] || for p in /usr/local/bin/aws /opt/homebrew/bin/aws; do [ -x "$p" ] && aws=$p; done
[ -n "$aws" ] || { echo "backup: aws CLI not found (brew install awscli)" >&2; exit 1; }

export AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY AWS_DEFAULT_REGION=auto
endpoint="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
remote="s3://$R2_BUCKET/${R2_PREFIX:+$R2_PREFIX/}"

if [ "${1:-}" = "--restore" ]; then
  dest=${2:?usage: backup-r2.sh --restore <empty-folder>}
  mkdir -p "$dest"
  [ -z "$(ls -A "$dest")" ] || { echo "backup: $dest is not empty" >&2; exit 1; }
  exec "$aws" s3 sync "$remote" "$dest" --endpoint-url "$endpoint" --exclude "deleted/*" --only-show-errors
fi

lib=${PROMPT_GALLERY_LIBRARY:-}
if [ -z "$lib" ]; then
  config="$HOME/Library/Application Support/com.ribin.prompt-gallery/config.json"
  lib=$(plutil -extract libraryPath raw -o - "$config" 2>/dev/null || true)
fi
[ -n "$lib" ] && [ -f "$lib/library.json" ] || { echo "backup: no library found (open the app once)" >&2; exit 1; }

dryrun=0; force=0
for arg in "$@"; do
  case "$arg" in
    --dryrun) dryrun=1 ;;
    --force) force=1 ;;
    *) echo "backup: unknown option $arg" >&2; exit 1 ;;
  esac
done
excludes=(--exclude ".thumbs/*" --exclude "*.DS_Store" --exclude ".prompt-gallery.lock" --exclude "*.tmp*" --exclude "deleted/*")
s3() { "$aws" s3 "$@" --endpoint-url "$endpoint"; }

echo "backup: $(date '+%F %T') $lib -> $remote"

# 1. Files in the bucket that no longer exist locally: move them to deleted/<date>/.
deletes=()
while IFS= read -r line; do
  case "$line" in "(dryrun) delete: $remote"*) deletes+=("${line#"(dryrun) delete: $remote"}") ;; esac
done < <(s3 sync "$lib/" "$remote" "${excludes[@]}" --delete --dryrun --no-progress)
if [ ${#deletes[@]} -gt 100 ] && [ $force = 0 ]; then
  echo "backup: ${#deletes[@]} files would move to deleted/; refusing without --force (wrong library?)" >&2
  exit 1
fi
day=$(date +%F)
for key in ${deletes[@]+"${deletes[@]}"}; do
  if [ $dryrun = 1 ]; then
    echo "(dryrun) move to deleted/$day/: $key"
  else
    s3 mv "$remote$key" "${remote}deleted/$day/$key" --only-show-errors
  fi
done
[ ${#deletes[@]} -gt 0 ] && echo "backup: ${#deletes[@]} deleted file(s) -> ${remote}deleted/$day/"

# 2. Upload new and changed files.
s3 sync "$lib/" "$remote" "${excludes[@]}" --no-progress $([ $dryrun = 1 ] && echo --dryrun)
echo "backup: done $(date '+%F %T')"
