import { assertEquals, assertRejects } from "@std/assert";
import {
  addTask,
  assignTask,
  getTask,
  initStore,
  listTasks,
  moveTask,
  openStore,
  STATUSES,
} from "./store.ts";

const withKv = async (fn: (kv: Deno.Kv) => Promise<void>) => {
  const kv = await openStore(":memory:");
  try {
    await fn(kv);
  } finally {
    kv.close();
  }
};

const keys = async (kv: Deno.Kv, prefix: Deno.KvKey): Promise<Deno.KvKey[]> => {
  const out: Deno.KvKey[] = [];
  for await (const entry of kv.list({ prefix })) out.push(entry.key);
  return out;
};

/** Every task has exactly one status entry and at most one assignee entry, and nothing else. */
const assertIndexesMatch = async (kv: Deno.Kv) => {
  const tasks = await listTasks(kv);
  const want = tasks.flatMap((t) => [
    ["idx", "status", t.status, t.id],
    ...(t.assignee ? [["idx", "assignee", t.assignee, t.id]] : []),
  ]).map((k) => JSON.stringify(k)).sort();
  const have = (await keys(kv, ["idx"])).map((k) => JSON.stringify(k)).sort();
  assertEquals(have, want);
  for (const status of STATUSES) {
    assertEquals(
      await listTasks(kv, { status }),
      tasks.filter((t) => t.status === status),
    );
  }
  for (const name of new Set(tasks.map((t) => t.assignee).filter(Boolean))) {
    assertEquals(
      await listTasks(kv, { assignee: name }),
      tasks.filter((t) => t.assignee === name),
    );
  }
};

Deno.test("init sets nextId once", async () => {
  await withKv(async (kv) => {
    await initStore(kv);
    assertEquals((await kv.get(["meta", "nextId"])).value, 1);
    await addTask(kv, { title: "a" });
    await initStore(kv);
    assertEquals((await kv.get(["meta", "nextId"])).value, 2);
  });
});

Deno.test("add allocates ids and writes the record plus indexes", async () => {
  await withKv(async (kv) => {
    const a = await addTask(kv, { title: "a", now: "2026-01-01T00:00:00.000Z" });
    const b = await addTask(kv, { title: "b", status: "todo", assignee: "holden" });
    assertEquals([a.id, b.id], [1, 2]);
    assertEquals(await getTask(kv, 1), {
      id: 1,
      title: "a",
      body: "",
      status: "backlog",
      assignee: "",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    });
    assertEquals((await kv.get(["meta", "nextId"])).value, 3);
    await assertIndexesMatch(kv);
  });
});

Deno.test("concurrent adds get distinct ids", async () => {
  await withKv(async (kv) => {
    const tasks = await Promise.all(
      Array.from({ length: 25 }, (_, i) => addTask(kv, { title: `t${i}` })),
    );
    assertEquals(new Set(tasks.map((t) => t.id)).size, 25);
    assertEquals((await listTasks(kv)).length, 25);
    await assertIndexesMatch(kv);
  });
});

Deno.test("move drops the old status entry and writes the new one", async () => {
  await withKv(async (kv) => {
    const t = await addTask(kv, { title: "a" });
    await moveTask(kv, t.id, "doing");
    assertEquals((await kv.get(["idx", "status", "backlog", t.id])).versionstamp, null);
    assertEquals((await kv.get(["idx", "status", "doing", t.id])).value, t.id);
    assertEquals((await getTask(kv, t.id))?.status, "doing");
    await moveTask(kv, t.id, "doing");
    await assertIndexesMatch(kv);
    await assertRejects(() => moveTask(kv, t.id, "nope"), Error, "Bad status");
    await assertRejects(() => moveTask(kv, 99, "done"), Error, "No task #99");
  });
});

Deno.test("assign moves the assignee entry and unassign removes it", async () => {
  await withKv(async (kv) => {
    const t = await addTask(kv, { title: "a", assignee: "ana" });
    await assignTask(kv, t.id, "bo");
    assertEquals((await kv.get(["idx", "assignee", "ana", t.id])).versionstamp, null);
    assertEquals((await kv.get(["idx", "assignee", "bo", t.id])).value, t.id);
    await assertIndexesMatch(kv);
    await assignTask(kv, t.id, "");
    assertEquals(await keys(kv, ["idx", "assignee"]), []);
    await assertIndexesMatch(kv);
  });
});

Deno.test("racing moves leave exactly one status entry", async () => {
  await withKv(async (kv) => {
    const t = await addTask(kv, { title: "a" });
    await Promise.all([
      moveTask(kv, t.id, "todo"),
      moveTask(kv, t.id, "doing"),
      moveTask(kv, t.id, "done"),
      assignTask(kv, t.id, "ana"),
      assignTask(kv, t.id, "bo"),
    ]);
    assertEquals((await keys(kv, ["idx", "status"])).length, 1);
    assertEquals((await keys(kv, ["idx", "assignee"])).length, 1);
    await assertIndexesMatch(kv);
  });
});

Deno.test("list filters by status and assignee together", async () => {
  await withKv(async (kv) => {
    for (let i = 0; i < 14; i++) {
      await addTask(kv, {
        title: `t${i}`,
        status: STATUSES[i % 4],
        assignee: i % 2 ? "ana" : "bo",
      });
    }
    const both = await listTasks(kv, { status: "doing", assignee: "bo" });
    assertEquals(both.map((t) => t.id), [3, 7, 11]);
    assertEquals((await listTasks(kv, { assignee: "ana" })).length, 7);
    await assertIndexesMatch(kv);
  });
});
