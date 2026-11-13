import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const jsonPath = path.join(root, "docs", "project", "board.json");
const htmlPath = path.join(root, "docs", "project", "board.html");

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL = { high: "Alta", medium: "Media", low: "Baja" };
const AREA_CLASS = {
  Landing: "area-landing",
  Worker: "area-worker",
  VPS: "area-vps",
  Plataforma: "area-platform",
  Cloudflare: "area-cloud",
  Docs: "area-docs",
  Ops: "area-ops",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function card(task) {
  const priority = PRIORITY_LABEL[task.priority] ?? task.priority ?? "";
  const areaClass = AREA_CLASS[task.area] ?? "area-other";
  const meta = [
    task.updated ? `Actualizado: ${esc(task.updated)}` : "",
    task.owner ? `Responsable: ${esc(task.owner)}` : "",
  ].filter(Boolean).join(" · ");
  const evidence = task.evidence
    ? `<p class="card-evidence"><strong>Evidencia:</strong> ${esc(task.evidence)}</p>`
    : "";
  const notes = task.notes
    ? `<p class="card-notes">${esc(task.notes)}</p>`
    : "";
  return `        <article class="card" data-priority="${esc(task.priority)}" data-area="${esc(task.area)}" data-text="${esc(
    `${task.title} ${task.area} ${task.notes ?? ""} ${task.evidence ?? ""}`.toLowerCase(),
  )}">
          <div class="card-top">
            <span class="badge ${areaClass}">${esc(task.area)}</span>
            <span class="priority priority-${esc(task.priority)}">${esc(priority)}</span>
          </div>
          <h3 class="card-title">${esc(task.title)}</h3>
          ${evidence}
          ${notes}
          ${meta ? `<p class="card-meta">${meta}</p>` : ""}
          <code class="card-id">${esc(task.id)}</code>
        </article>`;
}

function column(columnConfig, tasks) {
  const items = tasks
    .filter((task) => task.status === columnConfig.id)
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
  const cards = items.map(card).join("\n");
  return `      <section class="column" data-column="${esc(columnConfig.id)}">
        <header class="column-head">
          <h2>${esc(columnConfig.title)}</h2>
          <span class="count">${items.length}</span>
        </header>
        <div class="column-body">
${cards || '          <p class="empty">Sin tareas.</p>'}
        </div>
      </section>`;
}

function render(board) {
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const columns = Array.isArray(board.columns) ? board.columns : [];
  const open = tasks.filter((task) => task.status !== "done").length;
  const areas = [...new Set(tasks.map((task) => task.area).filter(Boolean))].sort();
  const areaOptions = areas
    .map((area) => `          <option value="${esc(area)}">${esc(area)}</option>`)
    .join("\n");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MeowLab · Tablero de trabajo</title>
<style>
  :root {
    --bg: #f4f6f8;
    --surface: #ffffff;
    --surface-2: #eef1f5;
    --text: #1c2430;
    --muted: #5c6a7a;
    --border: #dbe1e8;
    --accent: #0f9d76;
    --high: #d64545;
    --medium: #d98a1f;
    --low: #6b7a8c;
    --shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 8px 24px rgba(16, 24, 40, 0.05);
  }
  [data-theme="dark"] {
    --bg: #10151b;
    --surface: #171e26;
    --surface-2: #1f2833;
    --text: #e8edf2;
    --muted: #97a5b4;
    --border: #2a3542;
    --accent: #35c79b;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  header.page {
    position: sticky;
    top: 0;
    z-index: 10;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
    padding: 18px 24px 14px;
  }
  .page-inner { max-width: 1400px; margin: 0 auto; }
  .page-title {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
  }
  .page-title h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .page-title .dot { color: var(--accent); }
  .page-title .meta { color: var(--muted); font-size: 12px; }
  .controls {
    display: flex;
    gap: 10px;
    margin-top: 12px;
    flex-wrap: wrap;
    align-items: center;
  }
  .controls input,
  .controls select {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 7px 10px;
    font: inherit;
    min-width: 190px;
  }
  .controls button {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 7px 12px;
    font: inherit;
    cursor: pointer;
  }
  .controls button:hover { border-color: var(--accent); color: var(--accent); }
  .summary { color: var(--muted); font-size: 12px; margin-left: auto; }
  main { max-width: 1400px; margin: 0 auto; padding: 20px 24px 40px; }
  .board {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  @media (max-width: 980px) { .board { grid-template-columns: 1fr; } }
  .column {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    min-height: 200px;
  }
  .column-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .column-head h2 {
    margin: 0;
    font-size: 12px;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .count {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
    padding: 1px 9px;
    color: var(--muted);
  }
  .column-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--low);
    border-radius: 10px;
    padding: 12px 13px;
    box-shadow: var(--shadow);
  }
  .card[data-priority="high"] { border-left-color: var(--high); }
  .card[data-priority="medium"] { border-left-color: var(--medium); }
  .card[data-priority="low"] { border-left-color: var(--low); }
  .card-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--muted);
  }
  .area-landing { color: #b0562d; }
  .area-worker { color: #1f7a4d; }
  .area-vps { color: #4a5fc1; }
  .area-platform { color: #8a4fc1; }
  .area-cloud { color: #b07d1f; }
  .area-docs { color: #4c6b82; }
  .area-ops { color: #a14a5e; }
  .priority { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .priority-high { color: var(--high); }
  .priority-medium { color: var(--medium); }
  .card-title { margin: 8px 0 0; font-size: 14px; line-height: 1.35; }
  .card-evidence, .card-notes, .card-meta { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
  .card-evidence strong { color: var(--text); font-weight: 600; }
  .card-id {
    display: inline-block;
    margin-top: 10px;
    font-size: 11px;
    color: var(--muted);
    background: var(--surface-2);
    border-radius: 6px;
    padding: 1px 6px;
  }
  .empty { color: var(--muted); font-size: 12px; padding: 4px 2px; }
  footer.page {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 24px 30px;
    color: var(--muted);
    font-size: 12px;
  }
  footer.page code { background: var(--surface-2); border-radius: 6px; padding: 1px 5px; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<header class="page">
  <div class="page-inner">
    <div class="page-title">
      <h1><span class="dot">●</span> MeowLab · Tablero de trabajo</h1>
      <span class="meta">Actualizado: ${esc(board.updatedAt ?? "sin fecha")}</span>
    </div>
    <div class="controls">
      <input id="search" type="search" placeholder="Buscar tarea..." aria-label="Buscar tarea" />
      <select id="area" aria-label="Filtrar por área">
        <option value="">Todas las áreas</option>
${areaOptions}
      </select>
      <select id="priority" aria-label="Filtrar por prioridad">
        <option value="">Todas las prioridades</option>
        <option value="high">Alta</option>
        <option value="medium">Media</option>
        <option value="low">Baja</option>
      </select>
      <button id="theme" type="button">Tema</button>
      <span class="summary">Abiertas: ${open} · Total: ${tasks.length}</span>
    </div>
  </div>
</header>
<main>
  <div class="board">
${columns.map((columnConfig) => column(columnConfig, tasks)).join("\n")}
  </div>
</main>
<footer class="page">
  Fuente de verdad: <code>docs/project/board.json</code>. No edites este HTML a mano:
  regenera con <code>node tools/board/build-board.mjs</code> y verifica con <code>--check</code>.
</footer>
<script>
  const search = document.getElementById("search");
  const area = document.getElementById("area");
  const priority = document.getElementById("priority");
  const cards = [...document.querySelectorAll(".card")];
  const columns = [...document.querySelectorAll(".column")];

  function applyFilters() {
    const query = search.value.trim().toLowerCase();
    const selectedArea = area.value;
    const selectedPriority = priority.value;
    let visible = 0;
    for (const card of cards) {
      const matches =
        (!query || card.dataset.text.includes(query)) &&
        (!selectedArea || card.dataset.area === selectedArea) &&
        (!selectedPriority || card.dataset.priority === selectedPriority);
      card.classList.toggle("hidden", !matches);
      if (matches) visible += 1;
    }
    for (const col of columns) {
      const any = [...col.querySelectorAll(".card")].some((card) => !card.classList.contains("hidden"));
      col.classList.toggle("hidden", !any && (query || selectedArea || selectedPriority));
    }
    return visible;
  }

  search.addEventListener("input", applyFilters);
  area.addEventListener("change", applyFilters);
  priority.addEventListener("change", applyFilters);

  const themeButton = document.getElementById("theme");
  themeButton.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
  });
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.dataset.theme = "dark";
  }
</script>
</body>
</html>
`;
}

const check = process.argv.includes("--check");
const board = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const html = render(board);

if (check) {
  const current = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf8") : "";
  if (current !== html) {
    console.error("board.html está desactualizado. Ejecuta: node tools/board/build-board.mjs");
    process.exit(1);
  }
  console.log("board.html está al día.");
} else {
  fs.writeFileSync(htmlPath, html);
  console.log(`board.html generado (${board.tasks.length} tareas).`);
}
