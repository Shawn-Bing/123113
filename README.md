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

Node 24：`node --test tests/review-regression.test.cjs`。24 项断言直接读取交付
`index.html`，不依赖母仓源码或额外 Node 包。覆盖真实应用提交/恢复事件、
跨章待确认与确定错误、最近错拼/CSV/TXT/队列、五条稳定旧原始行与未知累计、
草稿双顺序重复恢复/刷新/导出再导入、来源 ID 碰撞、证据详情和混合掌握状态。

## 自动 Chrome 验收

`.github/workflows/node-regression.yml` 在 main push、PR 和手动触发时，
先跑 24 项 Node 回归，再安装固定 Playwright 1.62.1 和 Google Chrome，
运行 `node tests/review-scope-browser.cjs index.html`。7 组浏览器检查均为硬性通过条件。
使用独立 context 和 preview 数据，不访问用户已有记录。CI 保留 JSON 结果和证据截图。

本地已安装 Chrome 时，可在仓库外安装 Playwright，并令 `PLAYWRIGHT_PATH`
指向该模块目录，再执行同一浏览器命令；require('playwright') 正常可用时无需该变量。
`tests/fixtures/` 的两段原 WAV 与发布清单逐字节校验并实际播放。
这不是全部 5,570 段音频或其他浏览器的逐项验收。
既有 `tests/data-integrity-browser.cjs` 和 `tests/learning-browser.cjs` 仍可手动运行。

## 证据与恢复规则

- 证据详情分别列出确定错误、待核实来源、未验证旧累计；同一词存在两类证据时，
  仅有效来源参与计数与复习。章节筛选、页面、导出和练习队列使用同一来源范围。
- 具有稳定身份的内置旧原始行逐条计数；累计声明如 n=5 不会生成五次错误。
  缺输入、身份内容冲突和无法排除重复的证据保留待核实。
- 草稿只有原始 ID 或显式 importSourceId 能表明来源。不会从 -import-N 后缀推断身份。
  无来源元数据的旧冲突副本保留为独立记录；第一次导入原始冲突备份可能新增一份
  带明确来源的副本，后续重复恢复不会继续增加。不删除已有草稿来消除旧重复。
- 标记掌握不清除原证据；恢复较旧备份不覆盖较新掌握操作，新确定错误会取消掌握。
  CSV/TXT 用于查看，恢复只支持 JSON，完整备份保留原始答案与证据。
