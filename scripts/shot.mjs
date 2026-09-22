// Headless screenshot + console capture. Runs its own static server, safe to run concurrently.
//
//   node scripts/shot.mjs --url "index.html?only=sky&warm=4" --out shots/sky.png
//        [--w 1280 --h 800] [--wait 2500] [--click 640,500] [--key Space]
//        [--shots 2 --interval 1500] [--fps]
//        [--actions "wait:800;click:640,500;wait:1200;shot;hold:640,300,1500;key:Space;wait:2000;shot"]
//
// Prints JSON { errors, warnings, logs, files, fps? }. Exit code 1 when any error was captured.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer, ROOT } from './static-server.mjs';

function parseArgs(argv) {
  const out = { click: [], key: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    const val = next === undefined || next.startsWith('--') ? true : (i++, next);
    if (k === 'click' || k === 'key') out[k].push(val);
    else out[k] = val;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const W = Number(args.w || 1280);
const H = Number(args.h || 800);
const WAIT = Number(args.wait ?? 2500);
const SHOTS = Number(args.shots || 1);
const INTERVAL = Number(args.interval || 1500);
const out = path.resolve(ROOT, args.out || 'shots/shot.png');
fs.mkdirSync(path.dirname(out), { recursive: true });

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const result = { errors: [], warnings: [], logs: [], files: [] };
const { server, port } = await startServer(0);
let browser;

function fileFor(i) {
  if (i === 0 && SHOTS === 1 && !args.actions) return out;
  const ext = path.extname(out);
  return out.slice(0, -ext.length) + `-${i + 1}` + ext;
}

try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
      `--window-size=${W},${H}`,
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    // Resource failures are reported with their URL by the response/requestfailed handlers below.
    if (text.startsWith('Failed to load resource')) return;
    if (text.includes('GPU stall due to ReadPixels')) return;
    if (type === 'error') result.errors.push(text);
    else if (type === 'warn' || type === 'warning') result.warnings.push(text);
    else result.logs.push(text);
  });
  page.on('pageerror', (err) => result.errors.push(`pageerror: ${err.message}\n${err.stack || ''}`));
  page.on('requestfailed', (req) => {
    if (!req.url().includes('favicon')) result.errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('favicon')) result.errors.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '#scene{transition:none!important}';
      document.head.appendChild(s);
    });
  });

  let rel = String(args.url || 'index.html');
  if (rel.startsWith('/')) rel = rel.slice(1);
  const url = `http://127.0.0.1:${port}/${rel}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  try {
    await page.waitForFunction('window.__festivalReady === true', { timeout: 60000 });
  } catch {
    result.errors.push('timeout: window.__festivalReady never became true (boot failed or first frames never rendered)');
  }

  const parsePt = (s) => s.split(',').map(Number);
  let shotIndex = 0;
  const shot = async () => {
    const f = fileFor(shotIndex++);
    await page.screenshot({ path: f });
    result.files.push(path.relative(ROOT, f));
  };

  if (args.actions) {
    await new Promise((r) => setTimeout(r, Math.min(WAIT, 800)));
    for (const raw of String(args.actions).split(';').map((s) => s.trim()).filter(Boolean)) {
      const [op, rest = ''] = raw.split(/:(.*)/s);
      if (op === 'wait') await new Promise((r) => setTimeout(r, Number(rest)));
      else if (op === 'click') {
        const [x, y] = parsePt(rest);
        await page.mouse.click(x, y);
      } else if (op === 'hold') {
        const [x, y, ms] = parsePt(rest);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await new Promise((r) => setTimeout(r, ms || 1000));
        await page.mouse.up();
      } else if (op === 'drag') {
        const [x1, y1, x2, y2] = parsePt(rest);
        await page.mouse.move(x1, y1);
        await page.mouse.down();
        for (let s = 1; s <= 20; s++) await page.mouse.move(x1 + ((x2 - x1) * s) / 20, y1 + ((y2 - y1) * s) / 20);
        await page.mouse.up();
      } else if (op === 'move') {
        const [x, y] = parsePt(rest);
        await page.mouse.move(x, y);
      } else if (op === 'key') await page.keyboard.press(rest);
      else if (op === 'eval') result.logs.push(`eval: ${JSON.stringify(await page.evaluate(rest))}`);
      else if (op === 'shot') await shot();
      else result.warnings.push(`unknown action "${op}"`);
    }
  } else {
    await new Promise((r) => setTimeout(r, WAIT));
    for (const c of args.click) {
      const [x, y] = parsePt(String(c));
      await page.mouse.click(x, y);
      await new Promise((r) => setTimeout(r, 400));
    }
    for (const k of args.key) {
      await page.keyboard.press(String(k));
      await new Promise((r) => setTimeout(r, 400));
    }
    for (let i = 0; i < SHOTS; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, INTERVAL));
      await shot();
    }
  }

  if (args.fps) {
    result.fps = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let n = 0;
          const t0 = performance.now();
          const tick = () => {
            n++;
            if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
            else resolve(Math.round((n / (performance.now() - t0)) * 10000) / 10);
          };
          requestAnimationFrame(tick);
        }),
    );
    result.note = 'fps is measured in headless SwiftShader (software GL) — only meaningful relatively';
  }
} catch (err) {
  result.errors.push(`shot.mjs failure: ${err.stack || err}`);
} finally {
  await browser?.close().catch(() => {});
  server.close();
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.errors.length ? 1 : 0);
