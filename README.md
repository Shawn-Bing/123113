# IELTS Dictation

一个轻量的英语听写练习网页，包含 30 组练习和 5,570 段切片音频。

## 使用

下载整个仓库并保持目录结构，使用浏览器打开 `index.html`；也可通过静态网页服务器访问。

支持普通与沉浸听写、练习设置、报告筛选、错词复习和高频错词统计。练习进度保存在当前浏览器中，可在设置里导出备份。

## 文件

- `index.html`：样式、程序和词表均已内联的单网页。
- `clips_reviewed/`：网页使用的 WAV 切片音频。
- `README.md`：使用说明。

切片音频按原始字节保存。仓库不包含完整音轨、原始文档、整套开发源码或旧版构建产物。

## 回归验证

安装 Node.js 后，在仓库根目录运行 `node --test tests/review-regression.test.cjs`。测试直接提取并执行 `index.html` 中的交付模块，使用 Node 标准库与 VM，覆盖原八项审查及实际提交/恢复/故障编辑/跨章来源等 15 项核心案例；不依赖母仓源码、音频播放或额外包。`.github/workflows/node-regression.yml` 在 push main、PR 或手动触发时运行同一 Node 命令（contents:read，无部署）。本地命令已通过，新增 workflow 的云端执行结果请查看 Actions，勿将本地结果当作 CI 运行记录。

### 真实 Chrome 验收

在仓库外准备临时 QA 目录（Node 24、已安装 Google Chrome）：

```powershell
mkdir dictation-qa
cd dictation-qa
npm init -y
npm install --save-dev playwright
$env:PLAYWRIGHT_PATH=(Resolve-Path ./node_modules/playwright).Path
cd <本仓库路径>
node tests/data-integrity-browser.cjs
node tests/learning-browser.cjs
```

也可使用已有 Playwright（设置 PLAYWRIGHT_PATH），或让 require('playwright') 正常解析。无需安装生产依赖；两脚本默认读取相邻 index.html，也可传入其他 HTML 路径。使用独立浏览器 context 和 preview=1，不读取用户实际记录。前者验证实际提交、多轮/刷新、掌握失效、正确章节音频、双顺序/重复 JSON 恢复、配额失败后编辑与显式另存、首次掌握备份恢复；后者验证既有纸上、CSV/TXT、练习提交/重练和恢复。浏览器尚未配置为云端 CI。

旧数据缺输入会影响覆盖率但不虚构错误。旧累计声明不当成已核实次数；新 evidence 容器随 JSON 保留。CSV 是查看导出，恢复仍仅 JSON。输入式连字符专项本轮暂缓，纸上连字符专项可用。
