/**
 * A/B head comparison for the hair system.
 *
 * Captures the same head crop with the built-in hair showing (style "None")
 * and with a hairpiece attached, then reports whether the pixels actually
 * changed. "The avatar looks bald" is ambiguous — it can mean the hairpiece is
 * missing, buried inside the skull, or hidden behind the head. Only a
 * before/after pixel diff distinguishes those, and a diff also turns
 * "I think the turban renders" into a number.
 *
 *   node scripts/compare-hair.mjs [outDir]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const OUT = process.argv[2] ?? join(process.cwd(), 'qa-shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9226;
const URL_ = 'http://localhost:3000/fitting-room';

mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--window-size=1400,950',
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
    p(m.result);
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
await sleep(7000);

const evaluate = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))
    ?.result?.value;

const click = async (label) => {
  const r = await evaluate(`(() => {
    const el = [...document.querySelectorAll('button')]
      .find((e) => e.textContent.trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())});
    if (!el) return 'NOT_FOUND';
    el.click(); return 'OK';
  })()`);
  await sleep(3500);
  return r;
};

// Head-and-shoulders crop, centred on the two avatars.
const rect = JSON.parse(
  await evaluate(`(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
  })()`),
);
const CLIP = {
  x: Math.round(rect.x + rect.w * 0.2),
  y: Math.round(rect.y + rect.h * 0.04),
  width: Math.round(rect.w * 0.6),
  height: Math.round(rect.h * 0.3),
  scale: 3,
};

const capture = async (name) => {
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: CLIP,
    captureBeyondViewport: true,
  });
  const png = Buffer.from(shot.data, 'base64');
  writeFileSync(join(OUT, `${name}.png`), png);
  return png;
};

/** Mean absolute pixel difference between two PNG buffers, via the browser. */
const diff = async (a, b) => {
  const res = await send('Runtime.evaluate', {
    expression: `(async () => {
      const load = async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const A = await load(${JSON.stringify(a.toString('base64'))});
      const B = await load(${JSON.stringify(b.toString('base64'))});
      if (A.length !== B.length) return -1;
      let sum = 0, changed = 0;
      for (let i = 0; i < A.length; i += 4) {
        const d = Math.abs(A[i] - B[i]) + Math.abs(A[i+1] - B[i+1]) + Math.abs(A[i+2] - B[i+2]);
        sum += d;
        if (d > 24) changed++;
      }
      return JSON.stringify({
        meanDelta: +(sum / (A.length / 4) / 3).toFixed(2),
        changedPct: +((changed / (A.length / 4)) * 100).toFixed(2),
      });
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return res?.result?.value;
};

const shots = {};
console.log('click None:', await click('None'));
shots.none = await capture('hair-none');
for (const style of ['Bun', 'Turban', 'Long', 'Braid', 'Short']) {
  console.log(`click ${style}:`, await click(style));
  shots[style.toLowerCase()] = await capture(`hair-${style.toLowerCase()}`);
  const d = await diff(shots.none, shots[style.toLowerCase()]);
  console.log(`  vs none -> ${d}`);
}

ws.close();
chrome.kill();
console.log(`\nshots in ${OUT}`);