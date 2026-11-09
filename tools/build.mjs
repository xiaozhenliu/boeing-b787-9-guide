// 打包为单个离线 HTML（双击即可打开，无需服务器/网络）：
//   node tools/build.mjs [输出路径]      默认 dist/boeing-787-9.html
// three / three-mesh-bvh 取自 vendor/（与开发时 importmap 指向同一份文件）。
// esbuild：优先用项目可解析的 esbuild；否则用环境变量 ESBUILD 指向 esbuild/lib/main.js；
// 再否则在 npx 缓存中查找（npx esbuild 用过一次即会缓存）。
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || join(ROOT, 'dist', 'boeing-787-9.html'));

async function loadEsbuild() {
  try { return await import('esbuild'); } catch {}
  if (process.env.ESBUILD) return import(pathToFileURL(process.env.ESBUILD).href);
  for (const base of [join(homedir(), '.cache/npm/_npx'), join(homedir(), '.npm/_npx')]) {
    if (!existsSync(base)) continue;
    for (const h of await readdir(base)) {
      const p = join(base, h, 'node_modules/esbuild/lib/main.js');
      if (existsSync(p)) return import(pathToFileURL(p).href);
    }
  }
  throw new Error('找不到 esbuild：请先运行一次 `npx esbuild --version`，或设置 ESBUILD=/path/to/esbuild/lib/main.js');
}

const vendor = {
  name: 'vendor',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: join(ROOT, 'vendor/three/three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: join(ROOT, 'vendor/three', a.path.slice('three/'.length)) }));
    b.onResolve({ filter: /^three-mesh-bvh$/ }, () => ({ path: join(ROOT, 'vendor/three-mesh-bvh/index.module.js') }));
  },
};

// 知识库尚未生成时（仅用于测试打包流程）：STUB_KB=1 以空知识库代替
const stubKB = {
  name: 'stub-kb',
  setup(b) {
    b.onResolve({ filter: /\/data\/parts\.js$/ }, (a) => {
      const real = join(a.resolveDir, a.path);
      return existsSync(real) ? { path: real } : { path: 'parts-stub', namespace: 'stub' };
    });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export const PARTS = {}; export const CATEGORIES = {}; export const MATERIALS = {}; export const MATERIAL_SHARE = []; export const SECTION_INFO = {}; export const FACTS = [];',
      loader: 'js',
    }));
  },
};
if (!existsSync(join(ROOT, 'src/data/parts.js')) && !process.env.STUB_KB) throw new Error('缺少 src/data/parts.js（知识库）。仅测试打包流程可设 STUB_KB=1');

const esbuild = await loadEsbuild();
const t0 = performance.now();
const res = await esbuild.build({
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  write: false,
  plugins: process.env.STUB_KB ? [vendor, stubKB] : [vendor],
  logLevel: 'warning',
  metafile: true,
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = (await esbuild.transform(await readFile(join(ROOT, 'src/ui/style.css'), 'utf8'), { loader: 'css', minify: true })).code;

let html = await readFile(join(ROOT, 'index.html'), 'utf8');
html = html
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`)
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace(/<script type="module" src="[^"]*"><\/script>/, () => `<script type="module">${js}</script>`);
if (/src="\.\/src\/|importmap/.test(html)) throw new Error('HTML 替换不完整');
const credit = '<!-- 波音 787-9 结构科普交互模型：全部几何与纹理由代码程序化生成。three.js（MIT）· three-mesh-bvh（MIT）。 -->\n';
html = html.replace('<!doctype html>\n', `<!doctype html>\n${credit}`);

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const inputs = Object.entries(res.metafile.inputs);
const own = inputs.filter(([p]) => p.includes('/src/') || p.startsWith('src/')).reduce((a, [, v]) => a + v.bytes, 0);
console.log(`→ ${OUT}`);
console.log(`  HTML ${kb((await stat(OUT)).size)}（JS ${kb(js.length)} · CSS ${kb(css.length)}）· 自有源码 ${kb(own)} · ${inputs.length} 个模块 · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
