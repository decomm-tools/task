/**
 * Deno KV store for decomm task.
 *
 * Keys:
 *
 * - `["meta", "nextId"]` — next id to hand out (starts at 1)
 * - `["task", id]` — {@linkcode Task}
 * - `["idx", "status", status, id]` — secondary index, value is the id
 * - `["idx", "assignee", name, id]` — secondary index, value is the id (only when assigned)
 *
 * Every write is one `kv.atomic()` with versionstamp checks, so id allocation and index moves
 * either land together or retry.
 *
 * @module
 */

/** The four columns, in board order. */
export const STATUSES = ["backlog", "todo", "doing", "done"] as const;

/** One of {@linkcode STATUSES}. */
export type Status = typeof STATUSES[number];

/** A task record as stored at `["task", id]`. */
export type Task = {
  id: number;
  title: string;
  body: string;
  status: Status;
  assignee: string;
  created: string;
  updated: string;
};

/** File name of the KV database inside the data folder. */
export const DB_FILE = "task.sqlite3";

const NEXT_ID: Deno.KvKey = ["meta", "nextId"];
const RETRIES = 100;

// Lost a versionstamp race: wait a little (jittered) before re-reading.
const backoff = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(50, 2 ** attempt)));

/** True for backlog, todo, doing, done. */
export const isStatus = (value: string): value is Status =>
  (STATUSES as readonly string[]).includes(value);

/** Path of the KV file for a data folder. */
export const dbPath = (dir: string): string => `${dir}/${DB_FILE}`;

/**
 * Open the store for a data folder. Always a file in `dir`; never a bare `Deno.openKv()`
 * (that binds to the script cache) and never a remote connector. Pass `":memory:"` for tests.
 */
export const openStore = (dir: string): Promise<Deno.Kv> =>
  Deno.openKv(dir === ":memory:" ? ":memory:" : dbPath(dir));

const cleanName = (name: string): string => name.trim();

const statusKey = (status: Status, id: number): Deno.KvKey => ["idx", "status", status, id];
const assigneeKey = (name: string, id: number): Deno.KvKey => ["idx", "assignee", name, id];

/** Write `["meta","nextId"] = 1` if the counter is missing. Safe to repeat. */
export const initStore = async (kv: Deno.Kv): Promise<void> => {
  await kv.atomic().check({ key: NEXT_ID, versionstamp: null }).set(NEXT_ID, 1).commit();
};

/** Create a task. Allocates the id and writes the record plus both indexes in one commit. */
export const addTask = async (
  kv: Deno.Kv,
  input: { title: string; body?: string; status?: Status; assignee?: string; now?: string },
): Promise<Task> => {
  const title = input.title.trim();
  if (!title) throw new Error("title required");
  const status = input.status ?? "backlog";
  if (!isStatus(status)) throw new Error(`Bad status: ${status}`);
  const assignee = cleanName(input.assignee ?? "");
  for (let i = 0; i < RETRIES; i++) {
    const counter = await kv.get<number>(NEXT_ID);
    const id = counter.value ?? 1;
    const now = input.now ?? new Date().toISOString();
    const task: Task = {
      id,
      title,
      body: input.body ?? "",
      status,
      assignee,
      created: now,
      updated: now,
    };
    const op = kv.atomic()
      .check(counter)
      .check({ key: ["task", id], versionstamp: null })
      .set(NEXT_ID, id + 1)
      .set(["task", id], task)
      .set(statusKey(status, id), id);
    if (assignee) op.set(assigneeKey(assignee, id), id);
    const res = await op.commit();
    if (res.ok) return task;
    await backoff(i);
  }
  throw new Error("Could not allocate an id (too much contention)");
};

/** Read one task, or `null`. */
export const getTask = async (kv: Deno.Kv, id: number): Promise<Task | null> =>
  (await kv.get<Task>(["task", id])).value;

const update = async (
  kv: Deno.Kv,
  id: number,
  change: (task: Task) => Task,
): Promise<Task> => {
  for (let i = 0; i < RETRIES; i++) {
    const entry = await kv.get<Task>(["task", id]);
    if (!entry.value) throw new Error(`No task #${id}`);
    const before = entry.value;
    const after = change(before);
    const op = kv.atomic().check(entry).set(["task", id], after);
    if (before.status !== after.status) {
      op.delete(statusKey(before.status, id)).set(statusKey(after.status, id), id);
    }
    if (before.assignee !== after.assignee) {
      if (before.assignee) op.delete(assigneeKey(before.assignee, id));
      if (after.assignee) op.set(assigneeKey(after.assignee, id), id);
    }
    const res = await op.commit();
    if (res.ok) return after;
    await backoff(i);
  }
  throw new Error(`Could not update #${id} (too much contention)`);
};

/** Move a task to another column. Old status index entry goes, new one lands, same commit. */
export const moveTask = async (
  kv: Deno.Kv,
  id: number,
  status: string,
  now?: string,
): Promise<Task> => {
  if (!isStatus(status)) throw new Error(`Bad status: ${status} (use ${STATUSES.join(", ")})`);
  return await update(kv, id, (task) => ({
    ...task,
    status,
    updated: now ?? new Date().toISOString(),
  }));
};

/** Assign a task to `name`, or unassign with an empty name. Moves the assignee index entry. */
export const assignTask = (kv: Deno.Kv, id: number, name: string, now?: string): Promise<Task> =>
  update(kv, id, (task) => ({
    ...task,
    assignee: cleanName(name),
    updated: now ?? new Date().toISOString(),
  }));

const byIds = async (kv: Deno.Kv, prefix: Deno.KvKey): Promise<Task[]> => {
  const ids: number[] = [];
  for await (const entry of kv.list<number>({ prefix })) {
    ids.push(entry.key[entry.key.length - 1] as number);
  }
  const tasks: Task[] = [];
  // getMany takes at most 10 keys per call.
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = await kv.getMany<Task[]>(ids.slice(i, i + 10).map((id) => ["task", id]));
    for (const entry of chunk) if (entry.value) tasks.push(entry.value);
  }
  return tasks;
};

/**
 * List tasks by id. Filter by status and/or assignee through the secondary indexes.
 */
export const listTasks = async (
  kv: Deno.Kv,
  filter: { status?: string; assignee?: string } = {},
): Promise<Task[]> => {
  let tasks: Task[];
  if (filter.status !== undefined) {
    if (!isStatus(filter.status)) throw new Error(`Bad status: ${filter.status}`);
    tasks = await byIds(kv, ["idx", "status", filter.status]);
    if (filter.assignee !== undefined) {
      const name = cleanName(filter.assignee);
      tasks = tasks.filter((task) => task.assignee === name);
    }
  } else if (filter.assignee !== undefined) {
    tasks = await byIds(kv, ["idx", "assignee", cleanName(filter.assignee)]);
  } else {
    tasks = [];
    for await (const entry of kv.list<Task>({ prefix: ["task"] })) tasks.push(entry.value);
  }
  return tasks.sort((a, b) => a.id - b.id);
};
