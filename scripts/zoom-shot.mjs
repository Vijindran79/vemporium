/**
 * Close-up inspector for the fitting room.
 *
 * Loads the real page, optionally clicks a control, then captures a ZOOMED
 * crop of a region over the live DevTools session. This is the only reliable
 * way to judge small 3D details: a full-page screenshot at 1x renders a head
 * about 40px tall, and "is there a turban on it" is not a question a 40px
 * image can answer.
 *
 *   node scripts/zoom-shot.mjs <out.png> <label> [clickLabel] [x,y,w,h,scale]
 *
 * Defaults to a head-and-shoulders crop centred in the canvas.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [out, label = 'shot', clickLabel = null, boxArg = null] = process.argv.slice(2);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9225;
const URL_ = 'http://localhost:3000/fitting-room';

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

await send('Page.enable');
await send('Runtime.enable');
await sleep(7000);

const evaluate = async (expr) =>
  (
    await send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    })
  )?.result?.value;

if (clickLabel) {
  const res = await evaluate(`(() => {
    const el = [...document.querySelectorAll('button')]
      .find((e) => e.textContent.trim().toLowerCase() === ${JSON.stringify(clickLabel.toLowerCase())});
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'OK';
  })()`);
  console.log(`click ${clickLabel}: ${res}`);
  await sleep(3500);
}

let box;
if (boxArg) {
  const [x, y, w, h, s] = boxArg.split(',').map(Number);
  box = { x, y, width: w, height: h, scale: s || 3 };
} else {
  // Default: the canvas area, upper third — where the heads are.
  const rect = await evaluate(`(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
  })()`);
  const r = JSON.parse(rect);
  box = {
    x: Math.round(r.x + r.w * 0.18),
    y: Math.round(r.y + r.h * 0.02),
    width: Math.round(r.w * 0.62),
    height: Math.round(r.h * 0.34),
    scale: 3,
  };
}
console.log('clip:', JSON.stringify(box));

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: box,
  captureBeyondViewport: true,
});
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`wrote ${out} (${label})`);
ws.close();
chrome.kill();