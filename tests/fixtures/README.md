# Chrome 原音夹具

包含 demonstration 两个章节、effect、weekly return 两个章节，以及
appearance、survey、postal survey、survey methods、telephone survey 共十段已发布 WAV，
用于真实 Chrome 解码、同音复习、纸上默写队列和章节来源断言。
文件逐字节来自既有发布音频；`audio-provenance.json`
记录身份、SHA-256 和时长，浏览器测试还会与页面实际发布清单重新核对哈希。
没有合成声音或 Audio 替身，也不以这些夹具测试代表全语料试听。

三个浏览器脚本共用带 Range 支持的本地 HTTP 服务，服务启动时校验所有夹具 SHA-256。
用 `tools/prepare_release_tests.cjs` 打包发布测试时，同时保留 helper 与整个
`tests/fixtures/`，无需依赖被 Git 忽略的本机音频目录。
