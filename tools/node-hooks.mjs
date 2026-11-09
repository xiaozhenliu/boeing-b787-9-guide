// 让 node 能直接 import 浏览器端模块（把裸模块名 three 映射到 vendor）
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const map = {
  three: path.join(root, 'vendor/three/three.module.js'),
  'three-mesh-bvh': path.join(root, 'vendor/three-mesh-bvh/index.module.js'),
};
registerHooks({
  resolve(spec, ctx, next) {
    if (map[spec]) return { url: pathToFileURL(map[spec]).href, shortCircuit: true, format: 'module' };
    if (spec.startsWith('three/addons/')) return { url: pathToFileURL(path.join(root, 'vendor/three/addons', spec.slice(13))).href, shortCircuit: true, format: 'module' };
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.startsWith('file:') && url.endsWith('.js')) { const r = next(url, { ...ctx, format: 'module' }); return { ...r, format: 'module' }; }
    return next(url, ctx);
  },
});
