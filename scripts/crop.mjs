/**
 * Crops and enlarges a region of a PNG so small details are inspectable.
 *
 * Uses Chrome's own decoder via the DevTools protocol rather than adding an
 * image library: the same binary that took the screenshot can crop it, so
 * there is no dependency to install and no mismatch between what the browser
 * rendered and what we inspect.
 *
 *   node scripts/crop.mjs <src.png> <dst.png> <l> <t> <r> <b> [scale]
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [src, dst, l, t, r, b, scaleArg] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: node scripts/crop.mjs <src.png> <dst.png> <l> <t> <r> <b> [scale]');
  process.exit(1);
}
const left = Number(l);
const top = Number(t);
const right = Number(r);
const bottom = Number(b);
const scale = Number(scaleArg ?? 3);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9224;

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `file:///${src.replace(/\\/g, '/')}`,
  ],
  { stdio: 'ignore' },
);
process.on('exit', () => chrome.kill());

async function pageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (res.ok) {
        const t = (await res.json()).find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
        if (t) return t.webSocketDebuggerUrl;
      }
    } catch {
      /* not up */
    }
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

const b64 = readFileSync(src).toString('base64');
const natural = await send('Runtime.evaluate', {
  expression: `(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${b64}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    window.__c = c; window.__img = img;
    return JSON.stringify({ w: img.width, h: img.height });
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log('source:', natural?.result?.value);

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: left, y: top, width: right - left, height: bottom - top, scale },
  captureBeyondViewport: true,
});
writeFileSync(dst, Buffer.from(shot.data, 'base64'));
console.log(`wrote ${dst}`);
ws.close();
chrome.kill();