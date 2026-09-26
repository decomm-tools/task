import { STATUSES, type Task } from "./store.ts";

const MARK =
  `<svg class="mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="3.5" y="8.5" width="11" height="15" rx="3" stroke="currentColor" stroke-width="1.75"/>
  <rect x="6.75" y="12.5" width="1.75" height="5" rx="0.5" fill="currentColor"/>
  <rect x="9.75" y="12.5" width="1.75" height="5" rx="0.5" fill="currentColor"/>
  <rect x="20" y="10.5" width="8.5" height="11" rx="2.25" fill="currentColor"/>
  <rect x="17.5" y="13" width="3.25" height="1.75" rx="0.5" fill="currentColor"/>
  <rect x="17.5" y="17.25" width="3.25" height="1.75" rx="0.5" fill="currentColor"/>
</svg>`;

/** Escape text for HTML. */
export const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const card = (task: Task): string => {
  const moves = STATUSES.filter((s) => s !== task.status).map((s) =>
    `<button name="status" value="${s}">${s}</button>`
  ).join("");
  return `<article class="card">
  <div class="meta"><span>#${task.id}</span><span>${esc(task.assignee || "unassigned")}</span></div>
  <h3>${esc(task.title)}</h3>
  ${task.body ? `<p>${esc(task.body)}</p>` : ""}
  <form method="post" action="/tasks/${task.id}/move" class="row">${moves}</form>
  <form method="post" action="/tasks/${task.id}/assign" class="row">
    <input name="assignee" placeholder="assignee" value="${esc(task.assignee)}" />
    <button>assign</button>
  </form>
</article>`;
};

/** Server-rendered board: four columns, a new-task form, no scripts, no CDN. */
export const page = (tasks: Task[], dir: string): string => {
  const columns = STATUSES.map((status) => {
    const cards = tasks.filter((t) => t.status === status);
    return `<section class="col">
  <h2>${status} <span class="count">${cards.length}</span></h2>
  ${cards.map(card).join("\n") || `<p class="empty">nothing</p>`}
</section>`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>decomm task</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; background: #09090b; color: #fafafa; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.85rem 1.25rem; border-bottom: 1px solid #27272a; }
    .brand { display: flex; align-items: center; gap: 0.6rem; font-weight: 600; }
    .mark { width: 28px; height: 28px; color: #fafafa; }
    .dir { color: #a1a1aa; font: 13px ui-monospace, monospace; }
    .new { display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 1rem 1.25rem; border-bottom: 1px solid #27272a; }
    .shell { display: grid; grid-template-columns: repeat(4, minmax(220px, 1fr)); gap: 1rem; padding: 1.25rem; overflow-x: auto; }
    .col { background: #111113; border: 1px solid #27272a; border-radius: 10px; padding: 0.75rem; min-height: 8rem; }
    h2 { margin: 0 0 0.75rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: #a1a1aa; }
    .count { color: #71717a; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 0.6rem 0.7rem; margin-bottom: 0.6rem; }
    .card h3 { margin: 0.2rem 0; font-size: 0.95rem; }
    .card p { margin: 0.2rem 0 0.4rem; color: #d4d4d8; white-space: pre-wrap; }
    .meta { display: flex; justify-content: space-between; color: #71717a; font: 12px ui-monospace, monospace; }
    .row { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.35rem; }
    .empty { color: #52525b; }
    input, textarea, select, button { font: inherit; color: inherit; background: #09090b; border: 1px solid #3f3f46; border-radius: 6px; padding: 0.3rem 0.5rem; }
    .card input { flex: 1; min-width: 0; font-size: 13px; }
    button { cursor: pointer; background: #27272a; font-size: 12px; }
    button:hover { background: #3f3f46; }
  </style>
</head>
<body>
  <header class="top">
    <div class="brand">${MARK}<span>decomm task</span></div>
    <span class="dir">${esc(dir)}</span>
  </header>
  <form class="new" method="post" action="/tasks">
    <input name="title" placeholder="New task" required />
    <input name="body" placeholder="Details" />
    <input name="assignee" placeholder="Assignee" />
    <select name="status">${STATUSES.map((s) => `<option>${s}</option>`).join("")}</select>
    <button>add</button>
  </form>
  <main class="shell">
${columns}
  </main>
</body>
</html>
`;
};
