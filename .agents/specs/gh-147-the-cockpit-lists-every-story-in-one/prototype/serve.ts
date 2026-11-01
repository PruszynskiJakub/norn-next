/**
 * PROTOTYPE (throwaway): the cockpit variants in the browser — xterm.js on the page, the variant code on
 * the server, keys and frames over a websocket. `bun serve.ts` then open http://localhost:4747
 * (`?variant=B&data=live` picks the start). Actions never run anything.
 */
import { readFileSync } from "node:fs";
import { type CockpitModel, type Effect, parseKeys, type Variant } from "./shared.ts";
import { current } from "./variants/0-current.ts";

const variants: Variant[] = [current];
for (const f of ["e", "d", "a", "b", "c"]) {
  try { variants.push((await import(`./variants/${f}.ts`)).variant); } catch (e) { if (!String(e).includes("Cannot find")) throw e; }
}
const load = (data: string): CockpitModel => JSON.parse(readFileSync(new URL(data === "live" ? "./model.json" : "./big.json", import.meta.url), "utf8"));

interface Session { model: CockpitModel; data: string; vi: number; states: Map<string, unknown>; toast: string | null; cols: number; rows: number }

function describe(e: Effect): string {
  if (e.kind !== "run") return "";
  const ef = e.action.effect;
  if (ef.kind === "verb") return `would run: norn ${ef.argv.map((a) => (a === "{input}" ? JSON.stringify(e.input ?? "") : a)).join(" ")}`;
  if (ef.kind === "link") return `would open ${ef.url}`;
  return `would go to the ${ef.place} of ${ef.story}`;
}
const look = (s: Session) => ({ width: s.cols, height: s.rows, color: true, now: Date.parse(s.model.at), clock: "15:13", toast: s.toast });
const stateOf = (s: Session, v: Variant) => { if (!s.states.has(v.key)) s.states.set(v.key, v.init(s.model)); return s.states.get(v.key); };
function frame(s: Session): string {
  const v = variants[s.vi] as Variant;
  const out = v.frame(s.model, stateOf(s, v), look(s));
  return `\x1b[H\x1b[2J${out.split("\n").slice(0, s.rows).join("\r\n")}`;
}
const meta = (s: Session) => JSON.stringify({ meta: { variants: variants.map((v) => ({ key: v.key, name: v.name })), current: variants[s.vi]!.key, data: s.data } });

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cockpit prototype</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<style>
  :root { --bg:#1e2127; --pill:#f2f2f2; --ink:#111; }
  html,body { margin:0; height:100%; background:var(--bg); }
  #term { position:absolute; inset:12px 12px 64px 12px; }
  #bar { position:fixed; left:50%; bottom:12px; transform:translateX(-50%); display:flex; gap:6px; align-items:center;
    background:var(--pill); color:var(--ink); font:600 13px/1 ui-sans-serif,system-ui,sans-serif; padding:6px 8px; border-radius:999px; box-shadow:0 4px 16px #0006; }
  #bar button { font:inherit; border:0; background:transparent; padding:6px 10px; border-radius:999px; cursor:pointer; color:inherit; }
  #bar button.on { background:#111; color:#fff; }
  #bar .sep { width:1px; height:18px; background:#0003; margin:0 4px; }
  #bar .hint { font-weight:400; opacity:.6; padding:0 6px; }
</style></head><body>
<div id="term"></div>
<div id="bar"><span id="vs"></span><span class="sep"></span><span id="ds"></span><span class="hint">tab cycles · click the terminal to type</span></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script>
  const q = new URLSearchParams(location.search);
  const term = new Terminal({ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 13, cursorBlink: false, theme: { background: '#1e2127' }, scrollback: 0 });
  const fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open(document.getElementById('term')); fit.fit(); term.focus();
  const ws = new WebSocket('ws://' + location.host + '/ws');
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  const size = () => send({ size: [term.cols, term.rows] });
  ws.onopen = () => { send({ start: { variant: q.get('variant') || '0', data: q.get('data') || 'big' } }); size(); };
  ws.onmessage = (e) => {
    if (e.data[0] === '{') { const { meta } = JSON.parse(e.data); render(meta); return; }
    term.write(e.data);
  };
  term.onData((d) => send({ keys: d }));
  addEventListener('resize', () => { fit.fit(); size(); });
  function btn(label, on, click) { const b = document.createElement('button'); b.textContent = label; if (on) b.className = 'on'; b.onclick = () => { click(); term.focus(); }; return b; }
  function render(m) {
    const vs = document.getElementById('vs'); vs.replaceChildren(...m.variants.map((v) => btn(v.key + ' ' + v.name, v.key === m.current, () => send({ variant: v.key }))));
    const ds = document.getElementById('ds'); ds.replaceChildren(...['big', 'live'].map((d) => btn(d === 'big' ? '68 stories' : 'live', d === m.data, () => send({ data: d }))));
    const u = new URL(location); u.searchParams.set('variant', m.current); u.searchParams.set('data', m.data); history.replaceState(null, '', u);
  }
</script></body></html>`;

const server = Bun.serve<Session, {}>({
  port: Number(process.env.PORT ?? 4747),
  fetch(req, srv) {
    if (new URL(req.url).pathname === "/ws") return srv.upgrade(req, { data: { model: load("big"), data: "big", vi: 0, states: new Map(), toast: null, cols: 120, rows: 40 } }) ? undefined : new Response("upgrade failed", { status: 400 });
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
  websocket: {
    message(ws, raw) {
      const s = ws.data;
      const m = JSON.parse(String(raw));
      const pick = (key: string) => { const i = variants.findIndex((v) => v.key.toLowerCase() === key.toLowerCase()); if (i >= 0) { s.vi = i; s.toast = `variant ${variants[i]!.key} · ${variants[i]!.name}`; } };
      const setData = (d: string) => { s.data = d === "live" ? "live" : "big"; s.model = load(s.data); s.states.clear(); };
      if (m.start) { setData(m.start.data); pick(m.start.variant); s.toast = null; }
      if (m.size) { s.cols = Math.max(40, m.size[0]); s.rows = Math.max(12, m.size[1]); }
      if (m.variant) pick(m.variant);
      if (m.data) setData(m.data);
      if (m.keys) {
        for (const key of (m.keys as string).split(/(\t)/).flatMap((c: string) => (c === "\t" ? [{ kind: "char", char: "\t" } as const] : parseKeys(c)))) {
          if (key.kind === "char" && key.char === "\t") { pick(variants[(s.vi + 1) % variants.length]!.key); continue; }
          const v = variants[s.vi] as Variant;
          const { state, effect } = v.handle(stateOf(s, v), key, s.model, look(s));
          s.states.set(v.key, state);
          s.toast = effect?.kind === "quit" ? "q would quit the cockpit" : effect ? describe(effect) : null;
        }
      }
      ws.send(meta(s));
      ws.send(frame(s));
    },
  },
});
console.log(`cockpit prototype: http://localhost:${server.port}`);

