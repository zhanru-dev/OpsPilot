# Media Library 验收问题修复

验证执行：2026-11-02；环境交接与提交：2026-11-03。

范围：独立验收 `144a9ae` 的 P1-01、P2-01、P2-02。原 FAIL 报告与证据已保存为 `ffea85e`，不改写历史结果。实现从该基线在 `fix/media-library-acceptance` 隔离 worktree 开始，最终将合入原 StreamOps 分支。Mudu 保持不变。

本轮修复及所列回归结论：**通过**。原审计结论与历史数据风险仍单独保留。机器可读汇总见 [summary.json](opspilot-media-remediation-evidence/summary.json)。

## 实现前计划与契约

1. **legacy single-PUT 原文件冻结。** 保留 HTTP 接口及重复完成 409 的兼容契约。新 intent 只签发临时对象的写入权限；完成时在 asset 锁及当前身份检查下，用源 ETag 条件复制到从未向客户端签发写权限的确定性 snapshot key。新增 nullable `MediaUpload.snapshotSourceEtag`，在外部复制前单独持久化源 ETag；不确定响应后的每次重试也只能复制同一版本。验证 snapshot 的长度、类型和 SHA-256，再将其设为 canonical original 并创建唯一初始 processing intent。外部复制成功而 DB 失败时，重试复用既有 snapshot，不从已变更的 staging 重新复制。历史未完成 intent（原先写入 original key）也转入新 snapshot，保留旧数据和协议。已损坏的历史内容不能凭空恢复；旧部署已签发 URL 的剩余期限必须在运行说明中明确。
2. **公平恢复扫描。** 每次最多处理 100 条，使用不可变 ID 的 keyset cursor 推进，扫描到末尾后回到开头；健康 job、单项失败都不阻断后部任务。恢复调度不增加新的 Prisma 表或字段。游标是每个恢复服务实例的内存调度状态，重启会重新扫描，周期边界写入限制说明。
3. **迟到写入清理。** 保留删除墓碑并周期性复查已清理资产的精确 prefix；在有效期前启动、清理后才落盘的旧 PUT 只能重建临时对象，不能改变 canonical original 或发布已删除资产，后续 sweep 再清理。空的墓碑复查不重复产生 cleanup audit 事件。
4. **活 worker 重叠。** 两个独立子进程执行同一个真实持久 job；旧进程分别停在进度、外部写入前和最终提交前，让新 generation 完成后再恢复旧进程。验证 PG、Redis progress、variants 和完成事件都不被旧进程覆盖，旧尝试输出能清理。若测试暴露漏洞，只修复该 fencing 边界。

## 验证计划

使用新的独占修复数据库／Redis／bucket，不重置审计或日常数据。新增 PG/MinIO/BullMQ/FFmpeg 集成测试，保留现有断言；覆盖旧 URL 重放、冻结后 DB 失败、拒绝不匹配 ETag、跨 TTL 慢请求、超过一批的恢复、活 worker 三个屏障。再跑媒体、Chat/Topics/认证/准入/Polls/直播相关套件、真实浏览器、类型、lint、生产构建和容器验证。下文结果来自本轮实际执行，不沿用原验收数字。

## 修复与验证结果（本轮记录）

| 验收项 | 修复 | 新增真实证据 |
| --- | --- | --- |
| P1-01 legacy 原文件可覆盖 | staging 仅给客户端 PUT；server-only snapshot；durable source ETag；长度/MIME/SHA-256 验证；唯一 uploadId processing job | 覆盖源、并发 complete、非 owner 拒绝；旧 ownerless intent；真实 copy 后 DB rollback 再重试；HEAD/copy 间替换拒绝；不确定 copy 错误不重新选择源版本 |
| P2-01 恢复扫描饥饿 | 不可变 ID keyset 每批 100；健康项和单项错误都推进；末尾回绕 | 102 个真实 PG job / Redis delayed job，首项持续故障，末项缺失仍恢复；健康项 updatedAt 不变；回绕恢复另一个丢失 job |
| P2-02 迟到存储请求 | DELETED 墓碑持续参与公平清理；空 sweep 不重复审计 | 真实 single-PUT 在 TTL 前被接受，在删除清理完成后才返回 200 并重新产生 staging 对象；下一轮清理移除，无资产复活。真实 multipart 请求持续发送少量字节跨 60 秒 TTL，取消和清理后返回 404 NoSuchUpload，无残留 session/object/job |
| P2-02 活旧 worker | Redis progress 移到 asset lock + generation 校验内；沿用外部对象与最终提交的版本隔离 | 两个独立 Node 进程使用真实 BullMQ Job、PG、S3、FFmpeg；旧进程分别暂停在 progress/write/commit，第二进程完成后恢复旧进程，检查 PG/Redis/variants/完成事件不回退；旧临时文件清理、孤立旧输出 sweep |

最后一项检查确认并修复了额外的同范围 P2：旧 worker 先写 Redis progress 再检查版本，能够回退队列进度。它不能越过已有 PG generation 校验覆盖 READY，但会使 Redis 与数据库暂时不一致。

## 迁移与运行契约

新增 `20261102000000_media_snapshot_version`，只追加 nullable `MediaUpload.snapshotSourceEtag`，无新实体或状态、无既有数据重写。迁移探针在独立 UUID 数据库验证 **44 张原表、9 行代表夹具**的原字段计数和摘要不变；legacy manifest/owner 保持 NULL。新上传设置 verified owner；旧 ownerless intent 仍按当前 workspace writer 权限完成。

更新部署需要先执行 `npm run db:deploy` 和 `npm run db:generate`，然后重新构建／启动 API 和 worker。重复 legacy complete 仍为 409；multipart 的幂等完成契约保持不变。存储账户需对私有 bucket 内 source/snapshot 具备 GetObject 和 PutObject（CopyObject）权限，不向浏览器暴露这些存储凭据。源校验最多 100 MiB，流式读取，不将整文件放入内存。

## 方案选择

保留 legacy 接口并冻结 canonical 原文件，避免直接关闭旧接口造成兼容性回退。缩短签名 TTL 不能阻止已被接受的慢请求或到期前重放；S3 versioning／Object Lock 是可选方案，但需要额外存储策略和运维契约，本次选择独立服务端 snapshot + 固定源 ETag。外部复制与 PG 提交仍分两步，明确恢复而不宣称跨系统原子事务。

恢复队列使用现有 service 的内存 keyset cursor，无新增队列表；持久化 scan cursor 能改善频繁重启下的公平性，但需要定义多 worker 的 cursor 所有权。本次保留简单调度并记录边界。墓碑反复扫描以收集迟到对象，成本是长期保留记录和存储列表请求。worker 沿用现有 generation fencing，只把漏掉的 Redis 写入纳入同一检查，不重建 BullMQ 架构。

## 仍然明确的限制

- 没有修改或恢复历史已 READY 且可能已经被覆盖的对象。此前部署签出的 legacy PUT URL 仍有原本的剩余有效期（默认 600 秒），且到期前已经开始的请求可能稍后才结束；部署交接应停止旧上传入口、排空在途传输并让旧 grant 到期，再核对疑似受影响源，必要时由原始本地文件重新上传。新完成流程的冻结 key 从未向客户端签出写权限；历史未完成 intent 也走新冻结流程。
- PostgreSQL 和 S3 不是分布式事务。源版本选择持久化后复制、复用既有 snapshot、重试和墓碑 sweep 组成恢复策略。外部存储管理员修改私有对象不在浏览器签名重放防护范围内。
- 清理是最终一致：迟到 staging 对象可能在下一轮 sweep 前短暂占据空间，不能发布。墓碑保留并复查，处理量仍受每批 100 / 调度周期 / 存储延迟限制；没有新增自动删除墓碑策略。
- 恢复游标存于每个 worker 实例内，重启从头扫描；连续运行会轮询全部任务。大量任务下完整周期约 ceil(N/100) × 30 秒再加实际操作耗时；反复重启可能延后后部任务，不宣称严格时间 SLA。
- 活 worker 测试用 IPC 屏障重入同一真实 job，证明版本隔离；实际 BullMQ SIGKILL/stalled 恢复仍由既有 restart suite 验证。测试不等于多区域 S3 或生产压力认证。

## 本轮执行日志

隔离目录 `.runtime/media-remediation-20261102/`，独占 DB `opspilot_media_fix_20261102_test`、Redis 6405、MinIO 9008 和私有 bucket，浏览器 Web/API 3115/4215，MediaMTX 1940/8897/9995。日常服务和旧验收数据不重置。原始日志权限受限；报告只保留脱敏命令和结果。

本次本机环境：macOS 26.6.2、Node 22.20.0、npm 10.9.3、PostgreSQL 17.11、独立 Redis 7.4.12、MinIO RELEASE.2025-09-07T16-13-09Z、MediaMTX 1.21.3、Chrome 156.0.8078.74。修复 code checkpoint 为 `f40dbf6`；容器测试 checkpoint 为 `80bda4d`。验证副本中 274 个应用源码／contracts／Prisma 文件与修复 checkout 字节一致；只适配测试 URL、端口查找和镜像 tag，不改变业务代码或断言。

以下命令均通过 `.runtime/media-remediation-20261102/run.mjs <label> <command...>` 设置独占环境和记录日志；包含 `verify` 的 label 在 `verify/` 副本运行，其余在 `checkout/`。`api-*` 使用既有 API 测试的 Origin 3000；浏览器使用 3115/4215。不要叠加会覆盖 DATABASE_URL 的其他环境 wrapper。

| 实际命令（省略上述 wrapper 前缀） | 本轮结果 |
| --- | --- |
| `npm run db:deploy`；`npm run db:generate` | 通过；仅独占修复数据库 |
| `node scripts/check-media-migration.mjs` | 通过，44 表／9 夹具；只创建和删除该探针自己的 UUID 库 |
| `npm test -- --runInBand` | 16 suites／106 passed |
| `node --import tsx --test tests/chat-state.test.ts tests/topics-state.test.ts tests/topics-drafts.test.ts tests/media-queue.test.ts` | 19 passed |
| `npm run test:e2e --workspace=@opspilot/api -- --runInBand --testPathIgnorePatterns broadcast.e2e-spec` | 10 suites；92 passed／1 failed（旧重写源契约，详见下文） |
| `npm run test:e2e --workspace=@opspilot/api -- --runInBand media-processing.e2e-spec media-remediation.e2e-spec '--testNamePattern=Real media processing\|freezes legacy'` | 修正契约后 7 passed；9 个其他 remediation 被此过滤命令跳过，前一全量运行已通过 |
| `npm run test:e2e --workspace=@opspilot/api -- --runInBand broadcast.e2e-spec` | 独立 MediaMTX／真实 RTMP，8 passed |
| `npx playwright test --trace=off --output=.runtime/media-fix-browser` | 27 passed，451.273 秒；真实 API／PG／WS／S3／FFmpeg |
| `npx playwright test --config=playwright.chat-recovery.config.ts --trace=off --output=.runtime/media-fix-chat-recovery` | 12 passed，84.5 秒；员工与观众各 6 个真实恢复／撤权场景 |
| `npm run typecheck`；`npm run lint` | API／Web 通过；新增测试修改后再次检查 |
| `npm run build` | Nest／Next 生产构建通过 |
| `docker build --target api -f apps/api/Dockerfile -t opspilot-media-fix-api:20261102 .` | 首次网络失败，相同命令重试通过 |
| `docker build --target worker -f apps/api/Dockerfile -t opspilot-media-fix-worker:20261102 .` | 通过 |
| `docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost:4112/api/v1 -f apps/web/Dockerfile -t opspilot-media-fix-web:20261102 .` | 通过 |
| `node scripts/check-media-containers.mjs` | 三镜像实际启动，真实 multipart／Linux FFmpeg／API restart／private preview／legacy 冻结源重放通过 |

后端去重合计 **102 个不同用例通过**（94 非直播 + 8 直播），这是全量运行与修正后的定向重测合并结果，**不是一次 102/102**。没有删除失败测试或放松原文件不可变断言。

分模块回归：Chat 的消息／历史／审核／分页锚点／未读／独立身份与重连；Topics 的私有队列／审核／回复／七 pin 限额／并发／版本冲突／限流恢复；Polls 和 Live Operations 的双端实时、SSE、只读权限；认证、邮件准入和撤销、workspace/event 隔离；音视频处理、存储和重启。直播 REST／WS／权限／真实 RTMP-HLS 后端 8 项已通过。浏览器及补充 UI 的结果在最终表单独计数。

### 性能观测

真实浏览器上传 104,856,576 字节、20 个分片：上传 4.877 秒，至 READY 6.775 秒；分片传输窗口约 38.83 MiB/s；API RSS 峰值约 311.32 MiB；JS heap 峰值约 13.86 MiB。10 次预览开关后 retained video 为 0，源哈希一致。仅限本机单文件、填充 MP4：API RSS 不包含 worker／FFmpeg／MinIO，JS heap 不包含全部 Blob／解码器内存，不是生产规模承诺。完整数字见 [performance.json](opspilot-media-remediation-evidence/performance.json)。

### 最终浏览器与回归结果

- 主流程 **27 passed**（451.273 秒）：媒体／续传／取消／SHA-256／真实解码／Chat／Topics／Polls／认证准入／运营。
- Chat 故障恢复 **12 passed**（84.499 秒）：员工与观众的数据库超时、gateway replay、一次性票据和撤权。
- 直播浏览器 **4 passed**（131.231 秒）：真实 RTMP 发布、两名已准入观众、HLS 播放／续期、transport/API restart、撤权、交互和 session 版本恢复。
- 隔离 UI **12 passed**（16.369 秒）：`npx playwright test --config=playwright.ui.config.ts --trace=off --output=.runtime/media-fix-ui`。它使用现有 mocked API，仅作 UI 补充，不计入真实端到端证据。

真实浏览器合计 **43 个不同用例通过**，另有上述 12 个 UI 用例。直播命令为 `npx playwright test --config=playwright.broadcast.config.ts --output=.runtime/media-fix-broadcast`。所有 wrapper 参数、开始时间、退出码、日志摘要在 [commands.json](opspilot-media-remediation-evidence/commands.json)，失败和复测均保留；原始私有日志不提交。

### 开发环境交接

已 fast-forward 合入原 `feat/streamops-chat-integration`。停止原开发 supervisor 后，仅对原开发库执行上述 nullable 字段追加迁移；再次核对 **44 张表／176 行**原字段计数与摘要完全一致，没有 seed/reset，没有删除或改写用户上传。[迁移后对比](opspilot-media-remediation-evidence/development-migration.json)。随后生成主 checkout 的 Prisma client 并构建 API。Web 3000／API 4100／worker 已恢复：readiness、login、identity、media list（3 个既有资产）、resumable list、event list 均 200，logout 204。[健康检查](opspilot-media-remediation-evidence/development-health.json)。只停止本轮独占的 Redis／MinIO／MediaMTX 测试容器，保留其测试 DB、bucket 和私有日志；原开发基础设施继续运行。没有生产部署。

### 复现命令

从 OpsPilot 根目录使用既有独占测试环境（默认端口需空闲）：

```sh
npm run media:test:setup
node scripts/with-media-test-env.mjs npm run db:generate
npm run test:media:api
node scripts/with-media-test-env.mjs npm run build
npm run test:media:browser
```

`test:media:api` 已包含新增 remediation suite。需要保持日常 3000/4100 服务运行时，使用本轮保存的 `.runtime/media-remediation-20261102/run.mjs` 与独立 verify 副本及端口配置；不要让默认固定端口测试复用日常服务。测试环境初始化只在新库 seed，已有测试库不 reset。常规本地运行命令仍是 `node scripts/with-broadcast-env.mjs --development npm run dev`。

## 结论与提交

本轮 P1-01、P2-01 已修复，P2-02 的慢请求／仍存活旧 worker 分支已补齐真实本地运行证据；同范围发现的 Redis 进度 fencing 遗漏已修复。上述回归未留下已知 P0/P1 阻断。原独立 FAIL 报告不改写；这份报告是修复和回归记录，不把历史未恢复文件或未测生产场景宣称为通过。

- `ffea85e`：保存原独立验收报告／证据。
- `f40dbf6`：冻结源、持久化源版本、恢复扫描、清理、progress fencing 及 11 个新增回归用例。
- `80bda4d`：容器内 legacy 冻结源重放验证。
- 最终修复报告和脱敏证据在后续 docs checkpoint；最终分支为 `feat/streamops-chat-integration`。未推送远程，未开始下一个模块。


### 已解决的验证环境问题

1. 首次 `prisma generate` 未经过隔离环境 wrapper，缺少 DATABASE_URL；因此随后 build / 新 suite 使用了旧 generated client。通过隔离 wrapper 生成 client 后重建；相关失败保留，不计为通过。
2. 慢 multipart 初版完全停止发送请求体，MinIO 返回 503 RequestTimeout，未达到要测试的持续传输时序。调整测试为每秒发送一个实际源字节（没有放宽 200/404 断言），跨 TTL 后释放剩余字节，得到真实 404 NoSuchUpload 并完成所有状态／清理断言。
3. 新测试读取 ConfigService 时初版使用隐式 any，lint 拒绝；补充 number 泛型，不禁用规则。


4. 第一轮完整非直播后端运行是 92 passed / 1 failed。失败的旧处理测试通过旧 PUT URL 改写损坏原文件后期待 READY，正好依赖了本次禁止的缺陷。改为有效冻结源 + 三次注入读取失败，保留 terminal failure、3 attempts、reconciliation、唯一失败事件、retry job 和真实 READY/FFmpeg 断言；另外新增损坏源在重放与 retry 后仍 FAILED、必须新建 upload 才成功的测试。定向复测 6 个 processing + 1 个 READY 重放用例全部通过；其余 9 个 remediation 仅在这个定向命令中被 filter 排除，已经在完整运行通过。
5. API 镜像第一次 `npm ci` 遇到 ECONNRESET；相同 Dockerfile / lockfile 重试成功，未调整依赖或跳过安装。MinIO 初次选择不可拉取的 latest 后改用本机既有、与审计一致的明确版本。
6. 一次对旧审计容器的过宽环境检查将仅用于该已停止本地环境的 callback 凭据输出到工具记录；随后轮换了旧审计配置中的 callback 凭据。它未进入源码、报告或新修复环境，原开发凭据保持不变。
