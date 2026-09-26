#!/bin/sh
set -e
DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
BIN="$DIR/bin/task"
MAIN="$DIR/main.ts"
if [ -x "$BIN" ]; then
  exec "$BIN" "$@"
fi
if command -v deno >/dev/null 2>&1 && [ -f "$MAIN" ]; then
  exec deno run --unstable-kv --allow-read --allow-write --allow-net --allow-env=TASK_DIR "$MAIN" "$@"
fi
echo "No compiled binary at $BIN and Deno is not on PATH." >&2
echo "On a connected machine: deno task compile" >&2
exit 1
