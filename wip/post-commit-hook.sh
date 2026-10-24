#!/bin/bash
# Backs up the work branch, plus test scripts and design files from the scratchpad, to
# origin/backup/paper2audio-wip. The commit on top says [skip ci], so no build starts.
# The work branch itself is not touched.
cd "$(git rev-parse --show-toplevel)" || exit 0
S=/tmp/claude-0/-home-user-bytewatch-stremio-addon/8cf5236a-09f9-5839-b72c-a3cfc65ab8b3/scratchpad
IDX=$(mktemp); export GIT_INDEX_FILE=$IDX
git read-tree HEAD
cp .git/hooks/post-commit /tmp/.wip-post-commit
add() { [ -f "$1" ] && git update-index --add --cacheinfo 100644,$(git hash-object -w "$1"),"$2"; }
add /tmp/.wip-post-commit "wip/post-commit-hook.sh"
for f in "$S"/*.py "$S"/*.md; do add "$f" "wip/scratch/$(basename "$f")"; done
for f in "$S"/themes/project/*; do add "$f" "wip/themes/$(basename "$f")"; done
add "$S/vtest.log" "wip/scratch/vtest.log"
TREE=$(git write-tree); rm -f "$IDX"; unset GIT_INDEX_FILE
C=$(git commit-tree "$TREE" -p HEAD -m "[skip ci] Backup of $(git rev-parse --abbrev-ref HEAD) at $(git rev-parse --short HEAD)")
for i in 1 2 3; do git push -q -f origin "$C:refs/heads/backup/paper2audio-wip" 2>/dev/null && exit 0; sleep $((i*2)); done
echo "backup push failed" >&2
