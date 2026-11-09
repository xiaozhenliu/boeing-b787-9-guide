# 波音 787-9 结构科普交互模型

可交互的波音 787-9 结构科普 3D 模型：复合材料机身分段、翼盒与隔框、GEnx 发动机剖视、“多电”系统与起落架收放。模型全部由代码程序化生成（three.js），没有外部模型文件。

**在线体验：** https://xiaozhenliu.github.io/boeing-b787-9-guide/

## 本地运行

纯静态页面，无需构建。用任意静态服务器打开即可：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 打包为单个离线 HTML

```bash
node tools/build.mjs   # 输出 dist/boeing-787-9.html，双击即可打开
```
