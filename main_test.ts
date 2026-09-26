import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { parseArgs } from "./args.ts";
import { handler, run } from "./main.ts";
import { listTasks, openStore, STATUSES } from "./store.ts";

const req = (path: string, method = "GET", body?: unknown): Request =>
  new Request(new URL(path, "http://localhost"), {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

const withKv = async (fn: (kv: Deno.Kv) => Promise<void>) => {
  const kv = await openStore(":memory:");
  try {
    await fn(kv);
  } finally {
    kv.close();
  }
};

Deno.test("parseArgs reads flags and treats -- and --serve as serve", () => {
  assertEquals(parseArgs(["serve"]).command, "serve");
  assertEquals(parseArgs(["--", "serve"]).command, "serve");
  assertEquals(parseArgs(["--serve", "--port", "9000"]).port, 9000);
  const a = parseArgs(["--dir", "d", "add", "fix", "it", "--assignee", "ana", "--status", "todo"]);
  assertEquals([a.dir, a.command, a.rest, a.assignee, a.status], [
    "d",
    "add",
    ["fix", "it"],
    "ana",
    "todo",
  ]);
});

Deno.test("help mentions every verb and compile", async () => {
  const text = await run(["--help"]);
  for (const verb of ["init", "add", "show", "list", "move", "assign", "serve", "compile"]) {
    assertStringIncludes(text, verb);
  }
});

Deno.test("cli init add show list move assign (in-memory KV)", async () => {
  await withKv(async (kv) => {
    const cli = (...argv: string[]) => run(["--dir", ":memory:", ...argv], { kv });
    assertStringIncludes(await cli("init"), ":memory:");
    assertStringIncludes(await cli("add", "swap", "the", "drive", "--body", "bay 3"), "#1 swap");
    assertStringIncludes(await cli("add", "label cables", "--assignee", "ana"), "#2");
    const shown = await cli("show", "1");
    assertStringIncludes(shown, "swap the drive");
    assertStringIncludes(shown, "status:   backlog");
    assertStringIncludes(shown, "bay 3");
    assertStringIncludes(await cli("move", "1", "doing"), "#1 -> doing");
    assertStringIncludes(await cli("assign", "1", "holden"), "#1 -> holden");
    assertStringIncludes(await cli("assign", "2", "-"), "#2 -> unassigned");
    assertStringIncludes(await cli("list", "--status", "doing"), "swap the drive");
    assertEquals(
      await cli("list", "--status", "backlog"),
      "#2  backlog  -             label cables\n",
    );
    assertStringIncludes(await cli("list", "--assignee", "holden"), "#1");
    assertEquals(await cli("list", "--assignee", "ana"), "No tasks.\n");
    assertEquals((await cli("list")).trim().split("\n").length, 2);
    for (const status of STATUSES) {
      const listed = await cli("list", "--status", status);
      const want = (await listTasks(kv)).filter((t) => t.status === status).length;
      assertEquals(listed === "No tasks.\n" ? 0 : listed.trim().split("\n").length, want);
    }
    await assertRejects(() => cli("show", "9"), Error, "No task #9");
    await assertRejects(() => cli("move", "1", "later"), Error, "Bad status");
    await assertRejects(() => cli("nope"), Error, "Unknown command");
  });
});

Deno.test("cli refuses a folder without init and init creates task.sqlite3", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-task-cli-" });
  try {
    await assertRejects(() => run(["--dir", dir, "list"]), Error, "Run: task");
    assertStringIncludes(await run(["--dir", dir, "init"]), `${dir}/task.sqlite3`);
    assertEquals((await Deno.stat(`${dir}/task.sqlite3`)).isFile, true);
    assertStringIncludes(await run(["--dir", dir, "add", "persist me"]), "#1");
    assertStringIncludes(await run(["--dir", dir, "list"]), "persist me");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cli serve answers on the port", async () => {
  await withKv(async (kv) => {
    await run(["--dir", ":memory:", "add", "served"], { kv });
    const port = 18000 + Math.floor(Math.random() * 1000);
    const ac = new AbortController();
    // serve returns once listening; use handler directly with a signal so the test can stop it.
    const server = Deno.serve({ port, signal: ac.signal, onListen: () => {} }, handler(kv, "x"));
    assertStringIncludes(await run(["--dir", ":memory:", "serve", "--help"], { kv }), "serve");
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks`);
    assertEquals((await res.json()).tasks[0].title, "served");
    ac.abort();
    await server.finished;
    await assertRejects(
      () => run(["--dir", ":memory:", "serve", "--port", "0"], { kv }),
      Error,
      "--port",
    );
  });
});

const taskSh = async (args: string[]): Promise<string> => {
  const proc = new Deno.Command("sh", {
    args: [`${Deno.cwd()}/task.sh`, ...args],
    cwd: Deno.cwd(),
    stdout: "piped",
    stderr: "piped",
  });
  const out = await proc.output();
  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);
  if (!out.success) throw new Error(stderr || stdout);
  return stdout;
};

Deno.test("task.sh init add move assign show list is the carry-in example", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-task-sh-" });
  try {
    assertStringIncludes(await taskSh(["--dir", dir, "init"]), dir);
    assertStringIncludes(await taskSh(["--dir", dir, "add", "swap the drive"]), "#1");
    assertStringIncludes(await taskSh(["--dir", dir, "move", "1", "doing"]), "doing");
    assertStringIncludes(await taskSh(["--dir", dir, "assign", "1", "holden"]), "holden");
    assertStringIncludes(await taskSh(["--dir", dir, "show", "1"]), "assignee: holden");
    assertStringIncludes(await taskSh(["--dir", dir, "list", "--status", "doing"]), "#1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("http board and api read write", async () => {
  await withKv(async (kv) => {
    const handle = handler(kv, "./tasks");
    const created = await handle(
      req("/api/tasks", "POST", { title: "rack <moved>", assignee: "ana" }),
    );
    assertEquals(created.status, 200);
    const { id } = await created.json();
    assertEquals(
      (await handle(req(`/api/tasks/${id}/move`, "POST", { status: "done" }))).status,
      200,
    );
    const moved = await handle(req(`/api/tasks/${id}/assign`, "POST", { assignee: "bo" }));
    assertEquals((await moved.json()).assignee, "bo");
    const bad = await handle(req(`/api/tasks/${id}/move`, "POST", { status: "x" }));
    assertEquals(bad.status, 400);
    const listed = await (await handle(req("/api/tasks?status=done&assignee=bo"))).json();
    assertEquals(listed.tasks.length, 1);
    const form = new FormData();
    form.set("title", "from form");
    const posted = await handle(
      new Request("http://localhost/tasks", { method: "POST", body: form }),
    );
    assertEquals(posted.status, 303);
    const html = await (await handle(req("/"))).text();
    assertStringIncludes(html, "decomm task");
    assertStringIncludes(html, 'viewBox="0 0 32 32"');
    assertStringIncludes(html, "rack &#60;moved&#62;");
    assertStringIncludes(html, "from form");
    assertEquals(html.includes("<script"), false);
    assertEquals(/(src|href)="https?:/.test(html), false);
  });
});
