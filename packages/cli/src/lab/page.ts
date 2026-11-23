/**
 * The lab dashboard's one page: self-contained, it polls `GET /api/state` every second and sends each
 * button to `POST /api/act/<name>`. The graph is drawn by Mermaid when the browser can load it; without
 * it the steps show as a row with the live one lit, so the page works offline too.
 */

/** How often the page reads the lab's state. */
export const POLL_MS = 1000;

const MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";

export const LAB_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>norn lab</title>
<style>
:root { --bg:#f8fafc; --panel:#ffffff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --live:#16a34a; --warn:#b45309; --bad:#dc2626; --code:#f1f5f9; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1120; --panel:#111827; --ink:#e2e8f0; --muted:#94a3b8; --line:#1f2937; --live:#4ade80; --warn:#fbbf24; --bad:#f87171; --code:#1e293b; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 system-ui, -apple-system, sans-serif; }
header { padding:16px; border-bottom:1px solid var(--line); }
header h1 { margin:0 0 4px; font-size:18px; }
header .where { color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
main { display:grid; gap:12px; padding:12px 16px 32px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); }
section { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px; min-width:0; }
section.wide { grid-column: 1 / -1; }
h2 { margin:0 0 8px; font-size:14px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
code, pre { font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--code); border-radius:4px; }
code { padding:1px 4px; overflow-wrap:anywhere; }
pre { padding:8px; margin:0; max-height:320px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; }
ol, ul { margin:0; padding-left:20px; }
li { margin:2px 0; }
.muted { color:var(--muted); }
.bad { color:var(--bad); }
.need { border-left:3px solid var(--warn); padding-left:8px; margin:6px 0; }
.steps { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.step { border:1px solid var(--line); border-radius:999px; padding:2px 10px; font-size:12px; }
.step.live { border-color:var(--live); background:var(--live); color:#052e16; font-weight:600; }
#graph svg { max-width:100%; height:auto; }
.action { border-top:1px solid var(--line); padding:8px 0; }
.action:first-child { border-top:0; }
.action input { width:100%; margin:6px 0; padding:6px; border:1px solid var(--line); border-radius:4px; background:var(--bg); color:var(--ink); }
button { cursor:pointer; padding:6px 12px; border-radius:6px; border:1px solid var(--line); background:var(--ink); color:var(--bg); font-weight:600; }
button:disabled { opacity:.5; cursor:wait; }
.ran { margin-top:6px; }
.beat { font-size:15px; }
details { margin:4px 0; }
summary { cursor:pointer; }
</style>
</head>
<body>
<header>
  <h1>norn lab <span id="beat-title" class="muted"></span></h1>
  <div id="beat" class="beat"></div>
  <div id="where" class="where"></div>
</header>
<main>
  <section class="wide"><h2>Workflow</h2><div id="graph"></div><div id="steps" class="steps"></div></section>
  <section><h2>Needs you</h2><div id="needs"></div></section>
  <section><h2>Act as the person</h2><div id="actions"></div></section>
  <section><h2>Decisions, in plain words</h2><ol id="decisions"></ol></section>
  <section><h2>Receipts, in the order written</h2><p class="muted">Each receipt is written before the effect it records; the unit's state is committed last.</p><ol id="receipts"></ol></section>
  <section><h2>Story documents</h2><div id="docs"></div></section>
  <section><h2>Agent session</h2><div id="session"></div></section>
</main>
<script type="module">
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let mermaid = null;
import("${MERMAID}").then((m) => { mermaid = m.default; mermaid.initialize({ startOnLoad: false, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" }); drawn = ""; }).catch(() => {});
let drawn = "";
const ran = {};
const typed = {};
let built = false;

async function draw(graph) {
  $("steps").innerHTML = graph.steps.map((s) => '<span class="step' + (s === graph.live ? " live" : "") + '">' + esc(s) + "</span>").join("");
  if (!mermaid || drawn === graph.mermaid) return;
  drawn = graph.mermaid;
  try { const { svg } = await mermaid.render("g" + Date.now(), graph.mermaid); $("graph").innerHTML = svg; } catch { $("graph").textContent = ""; }
}

function actions(list) {
  if (!built) {
    $("actions").innerHTML = list.map((a) =>
      '<div class="action" id="a-' + a.name + '"><div><b>' + esc(a.label) + '</b></div>' +
      (a.input ? '<input placeholder="your ' + a.input + '" data-for="' + a.name + '">' : "") +
      '<div>runs <code class="cmd"></code></div><button data-act="' + a.name + '">' + esc(a.label) + '</button><div class="ran"></div></div>').join("");
    for (const i of document.querySelectorAll("input[data-for]")) i.addEventListener("input", () => { typed[i.dataset.for] = i.value; });
    for (const b of document.querySelectorAll("button[data-act]")) b.addEventListener("click", () => press(b.dataset.act, b));
    built = true;
  }
  for (const a of list) {
    const box = $("a-" + a.name);
    const t = typed[a.name];
    box.querySelector(".cmd").textContent = a.input && t ? a.command.replace("'<" + a.input + ">'", "'" + t.trim().replaceAll("'", "'\\\\''") + "'") : a.command;
    const r = ran[a.name];
    box.querySelector(".ran").innerHTML = r ? (r.error ? '<span class="bad">' + esc(r.error) + "</span>" : 'ran <code>' + esc(r.command) + "</code> → exit " + r.exit + (r.output ? "<pre>" + esc(r.output) + "</pre>" : "")) : "";
  }
}

async function press(name, button) {
  button.disabled = true;
  try {
    const res = await fetch("/api/act/" + name, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: typed[name] ?? "" }) });
    ran[name] = await res.json();
  } catch (e) { ran[name] = { error: String(e) }; }
  button.disabled = false;
  tick();
}

function render(s) {
  const l = s.lab;
  $("beat-title").textContent = "· beat " + l.beat.n + " of " + l.beat.of + ": " + l.beat.title;
  $("beat").innerHTML = esc(l.beat.caption) + '<div class="muted">Look: ' + esc(l.beat.look) + "</div>" + (l.next ? "<div>Next: <code>" + esc(l.next) + "</code></div>" : "<div>The story ended <code>" + esc(l.ended) + "</code>.</div>");
  $("where").textContent = "repo " + l.repo + " · norn home " + l.home + " · story " + (l.story ?? "-");
  draw(s.graph);
  $("needs").innerHTML = s.needs_you.length ? s.needs_you.map((n) => '<div class="need"><b>' + esc(n.unit) + "</b> waits for your " + esc(n.for) + ": " + esc(n.text) + (n.next ? "<div><code>" + esc(n.next) + "</code></div>" : "") + "</div>").join("") : '<span class="muted">Nothing waits for you.</span>';
  actions(s.actions);
  $("decisions").innerHTML = s.decisions.map((d) => "<li" + (d.ok ? "" : ' class="bad"') + "><code>" + esc(d.rule) + "</code> → " + esc(d.kind) + ": " + esc(d.caption) + ' <span class="muted">' + esc(d.unit) + "</span></li>").join("") || '<span class="muted">No decision yet.</span>';
  $("receipts").innerHTML = s.receipts.entries.map((r) => "<li><code>" + esc(r.kind) + "</code> " + esc(r.what) + (r.before ? ' <span class="muted">— before ' + esc(r.before) + "</span>" : "") + "</li>").join("") || '<span class="muted">No receipt yet.</span>';
  $("docs").innerHTML = s.docs.map((d) => "<details><summary><code>" + esc(d.path) + "</code></summary><pre>" + esc(d.text) + "</pre></details>").join("") || '<span class="muted">No document yet.</span>';
  $("session").innerHTML = s.session ? "<div>run <code>" + esc(s.session.run) + "</code> on <code>" + esc(s.session.executor) + "</code></div><pre>" + esc(s.session.log || "(nothing written yet)") + "</pre>" : '<span class="muted">No agent has run yet.</span>';
}

async function tick() {
  try {
    const res = await fetch("/api/state");
    const s = await res.json();
    if (res.ok) render(s); else $("beat").innerHTML = '<span class="bad">' + esc(s.error) + "</span>";
  } catch (e) { $("beat").innerHTML = '<span class="bad">the lab does not answer: ' + esc(String(e)) + "</span>"; }
}
tick();
setInterval(tick, ${POLL_MS});
</script>
</body>
</html>
`;
