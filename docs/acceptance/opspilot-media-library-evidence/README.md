# Media Library 独立验收证据

审查基线：`144a9aea08eacb2a64a2f95c9429b7c9facb20c7`，2026-11-02。

- `summary.json`：不同运行的实际测试数量、源码比较和依赖审计结果。
- `commands.json`：本轮运行器的真实命令、UTC 时间、退出码和耗时。退出 0 的采证脚本仍可能记录产品 FAIL；以各 scenario 的 status 为准。
- `independent-probes.json`：两个确定性取消结果、丢初始化回执、队列扫描积压、legacy 原文件覆盖。
- `security-probes.json`：真实登录的权限矩阵、观众拒绝、撤权和并发 workspace 配额。
- `boundary-probes.json`、`invalid-media-probes.json`：真实尺寸／SHA-256，以及真实超时长和不支持编码的处理结果。
- `scheduled-cleanup.json`、`consistency-probes.json`：实际定时清理重试、关联／删除竞争和清理批次公平性。
- `identity-switch.json`、`chunk-retry.json`：真实浏览器的新补充探针。
- `local-performance.json`、`container-smoke.json`：局部测量和镜像运行证据，不能推导生产容量／部署安全。
- `environment-adaptations.json`：审计副本的端口、启动配置和 tag 适配，不是应用修复。
- `environment-handoff.json`：独占服务停止、资源保留及原开发服务健康检查。
- `probe-manifest.json`：仅保留在私有 runtime 目录内的补充探针路径与源码 SHA-256。

原始日志和 Playwright authenticated traces 位于 `.runtime/media-library-acceptance/20261102/`；包含临时登录会话的原始 traces 不提交。该目录 mode 0700，随机密钥文件 mode 0600。本目录没有 JWT、cookie、签名 URL 或连接密码。

原有套件的断言未修改；第一次审计环境问题和新增探针自身错误均记录在报告中。不要把复测合计写成一次无失败的全量执行。
