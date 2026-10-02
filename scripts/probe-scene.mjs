/**
 * One-off probe: dumps the fitting-room scene graph so a mis-placed GLB can be
 * found without guessing. Prints every node with its world-space position.
 *
 *   node scripts/probe-scene.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9223;
const URL_ = 'http://localhost:3000/fitting-room';

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    URL_,
  ],
  { stdio: 'ignore' },
);
process.on('exit', () => chrome.kill());

async function pageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) {
        const t = (await r.json()).find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
        if (t) return t.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error('no devtools');
}

const ws = new WebSocket(await pageWs());
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const p = pending.get(m.id);
  if (p) {
    pending.delete(m.id);
    p(m);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');
// Surface the page's console: the hair attachment logs where it landed, which
// is the only way to tell "mis-placed" from "never mounted".
const logs = [];
await send('Log.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '?').join(' '));
  }
  if (m.method === 'Log.entryAdded') {
    logs.push(`[${m.params.entry.level}] ${m.params.entry.text}`);
  }
});
await sleep(7000);

// Walk the whole React fiber tree (up AND down from the canvas fiber) and
// collect every object that looks like a three.js Scene. Guessing a global or
// a single DOM key is how this kind of probe silently finds nothing.
const out = await send('Runtime.evaluate', {
  expression: `(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 'NO_CANVAS';
    const fk = Object.keys(canvas).find((k) => k.startsWith('__reactFiber'));
    if (!fk) return 'NO_FIBER';
    const scenes = [];
    const seenObj = new Set();
    const seenFib = new Set();
    const looksScene = (o) => o && typeof o === 'object' && o.isScene === true;
    const scan = (o, depth) => {
      if (!o || depth > 4 || seenObj.has(o)) return;
      seenObj.add(o);
      if (looksScene(o)) { scenes.push(o); return; }
      if (Array.isArray(o)) { o.slice(0, 40).forEach((x) => scan(x, depth + 1)); return; }
      let keys = [];
      try { keys = Object.keys(o); } catch { return; }
      for (const k of keys.slice(0, 40)) { try { scan(o[k], depth + 1); } catch {} }
    };
    const walk = (f, depth) => {
      if (!f || depth > 60 || seenFib.has(f)) return;
      seenFib.add(f);
      for (const key of ['stateNode', 'memoizedProps', 'memoizedState', 'pendingProps', '_debugOwner', 'return']) {
        try { scan(f[key], 0); } catch {}
      }
      walk(f.child, depth + 1);
      walk(f.sibling, depth + 1);
    };
    walk(canvas[fk], 0);
    if (!scenes.length) return 'NO_SCENE (fibers walked: ' + seenFib.size + ')';
    const lines = ['SCENES=' + scenes.length];
    scenes[0].traverse((o) => {
      if (!o.isMesh && !o.isBone) return;
      const p = { x: 0, y: 0, z: 0 };
      o.getWorldPosition(p);
      lines.push(
        o.type + ' [' + (o.name || '?') + '] vis=' + o.visible +
          ' wp=(' + p.x.toFixed(3) + ',' + p.y.toFixed(3) + ',' + p.z.toFixed(3) + ')' +
          ' scale=' + o.scale.toArray().map((n) => n.toFixed(2)).join('x'),
      );
    });
    return lines.join('\\n');
  })()`,
  returnByValue: true,
});

const v = out.result?.result?.value ?? JSON.stringify(out);
console.log('=== CONSOLE ===');
console.log(logs.length ? logs.join('\n') : '(none captured)');
console.log('=== SCENE ===');
console.log(typeof v === 'string' ? v : v);
ws.close();
chrome.kill();