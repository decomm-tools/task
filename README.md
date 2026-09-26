# decomm task

A local Jira-style board for a machine that may never see the internet again. Deno KV is the
database, and it is a file in the folder you carry. No cloud, no accounts, nothing phones home. Use
the CLI on the box, or run a small board on the LAN.

## Where the data lives

`--dir` is the data folder. The store is one file inside it:

```ts
Deno.openKv(`${dir}/task.sqlite3`);
```

Never a bare `Deno.openKv()` (that binds to the script cache, not the folder you copy) and never the
Deno Deploy remote connector. The binary is not the database. Copy the folder and the board comes
with it.

## Schema

| Key                             | Value                                                     |
| ------------------------------- | --------------------------------------------------------- |
| `["meta", "nextId"]`            | Next id to hand out                                       |
| `["task", id]`                  | `{ id, title, body, status, assignee, created, updated }` |
| `["idx", "status", status, id]` | `id`                                                      |
| `["idx", "assignee", name, id]` | `id` (only for assigned tasks)                            |

Statuses: `backlog`, `todo`, `doing`, `done`. Every write is one `kv.atomic()` with versionstamp
checks: allocating an id and writing the task and its indexes land together, and a move or assign
deletes the old index entry and writes the new one in the same commit. A lost race re-reads and
retries.

## Commands

| Command                                                    | What                                  |
| ---------------------------------------------------------- | ------------------------------------- |
| `init`                                                     | Create `--dir` and `task.sqlite3`     |
| `add <title> [--body text] [--status s] [--assignee name]` | New task (default status `backlog`)   |
| `show <id>`                                                | Print one task                        |
| `list [--status s] [--assignee name]`                      | Tasks by id, filtered by the indexes  |
| `move <id> <status>`                                       | Change column                         |
| `assign <id> [name]`                                       | Set assignee. No name (or `-`) clears |
| `serve [--port 8788]`                                      | Small LAN board                       |

`--dir` defaults to `./tasks`, or `TASK_DIR`. Every command except `init` refuses a folder with no
`task.sqlite3`, so a typo in `--dir` does not quietly start a new board.

## Carry-in

Init on a connected machine. Copy the folder. Run dark.

### Init

```sh
deno run -A jsr:@decomm/task/init ./task
cd task
deno task compile
```

Or from this repo: `deno task compile`. That leaves `bin/task`.

### Copy

Carry the whole `task/` folder onto the isolated box — USB, sneakernet,
[ferry](https://github.com/decomm-tools/ferry). Include `bin/`, and `tasks/` if you already have a
board.

### Run dark

No network. The box never needs to come back online.

```sh
./task.sh --dir ./tasks init
./task.sh --dir ./tasks add "swap the drive" --assignee holden
./task.sh --dir ./tasks move 1 doing
./task.sh --dir ./tasks list --status doing
./task.sh --dir ./tasks show 1
./task.sh --dir ./tasks serve --port 8788
```

`task.sh` uses the compiled binary if present, otherwise `deno run --unstable-kv`. The isolated box
does not need Deno if you compiled first.

## Board

```sh
deno task dev
```

That is `serve` with `--watch`. Extra flags after `--`:

```sh
deno task dev -- --port 9000 --dir ./tasks
```

Four columns, a new-task form, move and assign buttons on each card. Plain HTML forms, inline CSS,
no scripts, no CDN. It listens on every interface so other machines on the LAN can reach it. JSON
lives under `/api/tasks`.

## Deno KV is unstable

KV still needs `--unstable-kv`. `deno.json` sets `"unstable": ["kv"]`, and `task.sh`, the tasks, and
`bin/task` pass the flag. If you import `jsr:@decomm/task` from your own code, run it with
`--unstable-kv`.
