"""截图自检：打开本地页面，按给定视角截图，输出控制台日志。
用法: python3 tools/shot.py '[{"name":"side","pos":[0,5,90],"target":[0,5,0]}]' [query]
"""
import json, sys, os
from playwright.sync_api import sync_playwright

views = json.loads(sys.argv[1])
query = sys.argv[2] if len(sys.argv) > 2 else 'q=std'
url = os.environ.get('SHOT_URL') or f'http://127.0.0.1:8787/index.html?shot=1&{query}'
out = os.path.join(os.path.dirname(__file__), '..', '.shots')
os.makedirs(out, exist_ok=True)
W = int(os.environ.get('SHOT_W', 1400)); H = int(os.environ.get('SHOT_H', 860))
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': W, 'height': H})
    # 知识库尚未生成时用空模块顶替，避免整个界面因静态 import 失败而无法加载（只影响自检，不写文件）
    kb = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'parts.js')
    if not os.path.exists(kb):
        stub = 'export const PARTS = {}; export const CATEGORIES = {}; export const MATERIALS = {}; export const MATERIAL_SHARE = []; export const SECTION_INFO = {}; export const FACTS = [];'
        page.route('**/src/data/parts.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=stub))
        print('NOTE: parts.js missing, using stub')
    logs = []
    page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
    page.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
    page.goto(url)
    try:
        page.wait_for_function('window.__app && document.body.classList.contains("ready")', timeout=180000)
    except Exception as e:
        print('WAIT FAIL', e)
    page.wait_for_timeout(1200)
    for v in views:
        if 'pos' in v:
            page.evaluate(f'window.__app.view({json.dumps(v["pos"])}, {json.dumps(v["target"])})')
        if 'eval' in v:
            r = page.evaluate(v['eval'])
            if r is not None: print('EVAL', v['name'], json.dumps(r, ensure_ascii=False)[:2000])
        page.wait_for_timeout(v.get('wait', 900))
        page.screenshot(path=os.path.join(out, v['name'] + '.png'))
        print('saved', v['name'])
    print('\n'.join(logs[-40:]))
    b.close()
