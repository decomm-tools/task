/**
 * A local Jira-style board on Deno KV, for a machine that may never come back online.
 *
 * The data folder (`--dir`) holds `task.sqlite3`. Copy the folder and the board comes with it.
 * The CLI is the source of truth; `serve` is a small LAN board over the same store.
 *
 * Deno KV is still unstable: run with `--unstable-kv` (the carry-in `deno.json` sets
 * `"unstable": ["kv"]`, and `task.sh` / `bin/task` already include it).
 *
 * @example Run the CLI
 * ```ts
 * import { run } from "jsr:@decomm/task";
 *
 * await run(["--dir", "./tasks", "init"]);
 * await run(["--dir", "./tasks", "add", "swap the drive", "--assignee", "holden"]);
 * await run(["--dir", "./tasks", "move", "1", "doing"]);
 * console.log(await run(["--dir", "./tasks", "list", "--status", "doing"]));
 * ```
 *
 * @example Serve the board
 * ```ts
 * import { handler, openStore } from "jsr:@decomm/task";
 *
 * const kv = await openStore("./tasks"); // ./tasks/task.sqlite3
 * Deno.serve({ port: 8788 }, handler(kv, "./tasks"));
 * ```
 *
 * @module
 */
import { parseArgs } from "./args.ts";
import {
  addTask,
  assignTask,
  dbPath,
  getTask,
  initStore,
  isStatus,
  listTasks,
  moveTask,
  openStore,
  STATUSES,
  type Task,
} from "./store.ts";
import { page } from "./ui.ts";

export { openStore, STATUSES } from "./store.ts";
export type { Status, Task } from "./store.ts";

const HELP = `decomm task

A local board on Deno KV. --dir is the data folder; task.sqlite3 lives there.

Commands:
  init                          Create the data folder and task.sqlite3
  add <title> [--body text] [--status s] [--assignee name]
  show <id>                     Print one task
  list [--status s] [--assignee name]
  move <id> <status>            ${STATUSES.join(" | ")}
  assign <id> [name]            No name (or -) unassigns
  serve [--port 8788]           Small LAN board

Examples:
  ./task.sh --dir ./tasks init
  ./task.sh --dir ./tasks add "swap the drive" --assignee holden
  ./task.sh --dir ./tasks move 1 doing
  ./task.sh --dir ./tasks list --status doing
  ./task.sh --dir ./tasks serve --port 8788

Env: TASK_DIR

Compile on a connected machine (no Deno needed on the far side):
  deno task compile
`;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const back = (): Response => new Response(null, { status: 303, headers: { location: "/" } });

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

const readBody = async (req: Request): Promise<Record<string, string>> => {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return await req.json() as Record<string, string>;
  const form = await req.formData();
  const out: Record<string, string> = {};
  for (const [key, value] of form) if (typeof value === "string") out[key] = value;
  return out;
};

/**
 * HTTP handler for the board and a JSON API over an open store.
 *
 * - `GET /` — the board (HTML forms post back and redirect to `/`)
 * - `GET /api/tasks?status=&assignee=` — tasks as JSON
 * - `GET /api/tasks/:id` — one task
 * - `POST /tasks` or `/api/tasks` — `{ title, body?, status?, assignee? }`
 * - `POST /tasks/:id/move` or `/api/tasks/:id/move` — `{ status }`
 * - `POST /tasks/:id/assign` or `/api/tasks/:id/assign` — `{ assignee }`
 *
 * @param kv An open store (see `openStore` in `store.ts`).
 * @param dir Shown in the header.
 * @returns A `Deno.serve` callback.
 */
export const handler = (kv: Deno.Kv, dir = "") => async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const api = url.pathname.startsWith("/api/");
  const path = api ? url.pathname.slice(4) : url.pathname;
  const fail = (error: unknown, status = 400) =>
    api ? json({ error: message(error) }, status) : new Response(message(error), { status });
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      if (!api && (path === "/" || path === "/index.html")) {
        const html = page(await listTasks(kv), dir);
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (api && path === "/tasks") {
        const status = url.searchParams.get("status") ?? undefined;
        const assignee = url.searchParams.get("assignee") ?? undefined;
        return json({ tasks: await listTasks(kv, { status, assignee }) });
      }
      const one = /^\/tasks\/(\d+)$/.exec(path);
      if (api && one) {
        const task = await getTask(kv, Number(one[1]));
        return task ? json(task) : json({ error: "not found" }, 404);
      }
      return new Response("Not Found", { status: 404 });
    }
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const body = await readBody(req);
    let task: Task | undefined;
    if (path === "/tasks") {
      const status = body.status || "backlog";
      if (!isStatus(status)) throw new Error(`Bad status: ${status}`);
      task = await addTask(kv, {
        title: body.title ?? "",
        body: body.body,
        status,
        assignee: body.assignee,
      });
    }
    const act = /^\/tasks\/(\d+)\/(move|assign)$/.exec(path);
    if (act) {
      const id = Number(act[1]);
      task = act[2] === "move"
        ? await moveTask(kv, id, body.status ?? "")
        : await assignTask(kv, id, body.assignee ?? "");
    }
    if (!task) return new Response("Not Found", { status: 404 });
    return api ? json(task) : back();
  } catch (error) {
    return fail(error);
  }
};

const line = (task: Task): string =>
  `#${task.id}  ${task.status.padEnd(7)}  ${(task.assignee || "-").padEnd(12)}  ${task.title}`;

const detail = (task: Task): string =>
  [
    `#${task.id} ${task.title}`,
    `status:   ${task.status}`,
    `assignee: ${task.assignee || "-"}`,
    `created:  ${task.created}`,
    `updated:  ${task.updated}`,
    ...(task.body ? ["", task.body] : []),
  ].join("\n") + "\n";

const parseId = (value: string | undefined, command: string): number => {
  const id = Number(value);
  if (!value || !Number.isInteger(id) || id <= 0) throw new Error(`${command} needs a task id`);
  return id;
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
};

/** Options for {@linkcode run}. */
export type RunOptions = {
  /** Use this store instead of opening `--dir/task.sqlite3` (tests pass `":memory:"` KV). */
  kv?: Deno.Kv;
};

/**
 * Run one CLI command and return the text that would be printed.
 *
 * Commands: `init`, `add`, `show`, `list`, `move`, `assign`, `serve`.
 * `serve` starts {@linkcode handler} and returns after the server is listening; the store stays
 * open for the life of the server.
 *
 * @param argv Arguments after the binary name, including `--dir` and `--port`.
 * @returns Help text, or a trailing-newline status string for the command.
 */
export const run = async (argv: string[], options: RunOptions = {}): Promise<string> => {
  const args = parseArgs(argv);
  if (args.help || args.command === "" || args.command === "help") return HELP;
  const dir = args.dir;
  const known = ["init", "add", "show", "list", "move", "assign", "serve"];
  if (!known.includes(args.command)) throw new Error(`Unknown command: ${args.command}`);
  if (args.command === "serve" && (!Number.isInteger(args.port) || args.port <= 0)) {
    throw new Error("--port must be a positive integer");
  }

  let kv = options.kv;
  if (!kv) {
    if (args.command === "init") await Deno.mkdir(dir, { recursive: true });
    else if (!(await exists(dbPath(dir)))) {
      throw new Error(`No board at ${dbPath(dir)}. Run: task --dir ${dir} init`);
    }
    kv = await openStore(dir);
  }
  const owned = !options.kv;
  let keepOpen = false;
  try {
    switch (args.command) {
      case "init": {
        await initStore(kv);
        return `Task board ${options.kv ? dir : dbPath(dir)}\n`;
      }
      case "add": {
        const title = args.rest.join(" ");
        if (!title) throw new Error("add needs a title");
        const status = args.status ?? "backlog";
        if (!isStatus(status)) throw new Error(`Bad status: ${status}`);
        const task = await addTask(kv, { title, body: args.body, status, assignee: args.assignee });
        return `#${task.id} ${task.title}\n`;
      }
      case "show": {
        const id = parseId(args.rest[0], "show");
        const task = await getTask(kv, id);
        if (!task) throw new Error(`No task #${id}`);
        return detail(task);
      }
      case "list": {
        const tasks = await listTasks(kv, { status: args.status, assignee: args.assignee });
        return (tasks.length ? tasks.map(line).join("\n") : "No tasks.") + "\n";
      }
      case "move": {
        const id = parseId(args.rest[0], "move");
        const status = args.rest[1] ?? args.status;
        if (!status) throw new Error(`move needs a status (${STATUSES.join(", ")})`);
        const task = await moveTask(kv, id, status);
        return `#${task.id} -> ${task.status}\n`;
      }
      case "assign": {
        const id = parseId(args.rest[0], "assign");
        const raw = args.rest.slice(1).join(" ") || args.assignee || "";
        const task = await assignTask(kv, id, raw === "-" ? "" : raw);
        return `#${task.id} -> ${task.assignee || "unassigned"}\n`;
      }
      default: {
        Deno.serve({ port: args.port, onListen: () => {} }, handler(kv, dir));
        keepOpen = true;
        return `task board on http://0.0.0.0:${args.port}  dir=${dir}\n`;
      }
    }
  } finally {
    if (owned && !keepOpen) kv.close();
  }
};

if (import.meta.main) {
  try {
    const out = await run(Deno.args);
    if (out) console.log(out.endsWith("\n") ? out.slice(0, -1) : out);
  } catch (error) {
    console.error(message(error));
    Deno.exit(1);
  }
}
