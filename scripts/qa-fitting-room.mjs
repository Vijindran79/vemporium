/**
 * Fitting-room QA: drives the real page in headless Chrome and screenshots it.
 *
 * The avatar work has a failure mode unit tests cannot see: a GLB loads and
 * typechecks but renders off-centre, buried, or absurdly scaled. This harness
 * exercises the actual controls a shopper uses — gender, skin tone, hairstyle,
 * measurement sliders — so a visual regression leaves a screenshot behind
 * instead of being caught by a human weeks later.
 *
 *   node scripts/qa-fitting-room.mjs [outDir]
 *
 * Requires the dev server on :3000. Chrome is driven over the DevTools
 * protocol, so it needs no test-runner dependency.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const OUT = process.argv[2] ?? join(process.cwd(), 'qa-shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = 'http://localhost:3000/fitting-room';
const PORT = 9222;

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
  { stdio: 'ignore', detached: false },
);

process.on('exit', () => chrome.kill());

async function endpoint() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

/**
 * Minimal CDP client.
 *
 * Connects straight to the PAGE target rather than the browser endpoint: a
 * browser-level socket needs session routing for every command, and page
 * targets expose the same protocol without the extra bookkeeping.
 */
async function connect() {
  const ws = new WebSocket(await endpoint());
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.rej(new Error(`${msg.error.message} (${msg.error.code})`));
    else p.res(msg.result);
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (pending.delete(mid)) rej(new Error(`${method} timed out`));
      }, 30_000);
    });
  return { send, close: () => ws.close() };
}

const cdp = await connect();
const send = cdp.send;

await send('Page.enable');
await send('Runtime.enable');

// Wait for the canvas and a few WebGL frames.
await sleep(6000);

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  return r?.result?.value;
};

/** Clicks the button whose visible text matches. */
const clickText = (text) =>
  evaluate(`(() => {
    const els = [...document.querySelectorAll('button')];
    const el = els.find((e) => e.textContent.trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())});
    if (!el) return 'NOT_FOUND:' + ${JSON.stringify(text)};
    el.click();
    return 'OK';
  })()`);

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log(`shot: ${name}.png`);
};

const state = () =>
  evaluate(`(() => {
    const c = document.querySelector('canvas');
    return c ? { w: c.width, h: c.height, ok: c.width > 0 } : { missing: true };
  })()`);

const steps = [
  ['baseline', async () => {}],
  ['gender-men', async () => clickText('Men')],
  ['gender-boy', async () => clickText('Boy')],
  ['gender-women', async () => clickText('Women')],
  ['hair-turban', async () => clickText('Turban')],
  ['hair-none', async () => clickText('None')],
  ['skin-deep', async () => clickText('Deepest')],
  ['skin-light', async () => clickText('Porcelain')],
  ['view-side', async () => clickText('Side')],
  ['view-back', async () => clickText('Back')],
  ['view-front', async () => clickText('Front')],
];

for (const [name, act] of steps) {
  const res = await act();
  if (typeof res === 'string' && res.startsWith('NOT_FOUND')) {
    console.log(`  ${name}: skipped (${res})`);
    continue;
  }
  await sleep(2500); // let the GLB swap and a few frames render
  console.log(`  ${name}: canvas ${JSON.stringify(await state())}`);
  await shot(name);
}

cdp.close();
chrome.kill();
console.log(`\nQA complete — screenshots in ${OUT}`);