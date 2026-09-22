// Bundles src/main.js (three.js included) into one self-contained dist/index.html.
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { ROOT } from './static-server.mjs';

const START = '<!-- BUILD:SCRIPT_START -->';
const END = '<!-- BUILD:SCRIPT_END -->';

const result = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2022',
  write: false,
  legalComments: 'none',
  alias: {
    three: path.join(ROOT, 'node_modules/three/build/three.module.js'),
  },
  plugins: [
    {
      name: 'three-addons',
      setup(build) {
        build.onResolve({ filter: /^three\/addons\// }, (a) => ({
          path: path.join(ROOT, 'node_modules/three/examples/jsm', a.path.slice('three/addons/'.length)),
        }));
      },
    },
  ],
  logLevel: 'warning',
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const a = html.indexOf(START);
const b = html.indexOf(END);
if (a < 0 || b < 0) throw new Error('build markers missing in index.html');

const license =
  '<!-- three.js — MIT License, Copyright © 2010-2026 three.js authors — https://github.com/mrdoob/three.js -->';
const out = `${html.slice(0, a)}${license}\n<script type="module">${js}</script>${html.slice(b + END.length)}`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/index.html'), out);
console.log(`dist/index.html ${(out.length / 1024).toFixed(0)} KB`);

// Artifact variant: the same page without the document wrapper (the host supplies
// <!doctype>, <html>, <head> and <body>), so <title>, <style> and the body contents only.
const pick = (re) => (out.match(re) || [''])[0];
const body = out.slice(out.indexOf('<body>') + '<body>'.length, out.lastIndexOf('</body>'));
const artifact = `${pick(/<title>[\s\S]*?<\/title>/i)}\n${pick(/<style>[\s\S]*?<\/style>/i)}\n${body.trim()}\n`;
fs.writeFileSync(path.join(ROOT, 'dist/artifact.html'), artifact);
console.log(`dist/artifact.html ${(artifact.length / 1024).toFixed(0)} KB`);
