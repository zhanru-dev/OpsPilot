# OpsPilot Media Library 融合独立验收报告

日期：2026-11-02。结论：**FAIL，不批准通过本轮验收。**

任务依据：[独立验收任务](opspilot-media-library-integration-acceptance-task.md)。本轮是独立审查与故障验证，没有修复应用源码、迁移、依赖或既有测试，也没有开发其他模块。

## A. 执行摘要

新 multipart 主流程有充分的真实集成证据：上传与 SHA-256、缺失片续传、可见失败后重试、取消与完成的确定性竞争、当前权限、跨 workspace 隔离、真实 FFmpeg 处理及浏览器播放均通过。迁移、生产构建、容器运行，以及 Chat、Topics、Polls、准入和直播相关回归通过。

**但保留的 legacy single-PUT 入口存在 P1 完整性缺陷：**完成处理进入 READY 后，同一上传 URL 仍可覆盖原始文件；源文件已变成不同字节，资产仍是 READY，预览仍是旧内容，现有 reconciliation 不发现这类替换。这是本轮实际复现的问题，不是把签名 URL 的正常有效期误判为权限撤销失败。

另确认 **P2 恢复扫描公平性问题**：100 个较早的健康排队／延迟任务可以使第 101 个丢失的 Redis 任务得不到扫描。两个更苛刻的竞争边界仍缺少独立运行证据，另作为 P2 覆盖缺口记录，不计为通过。

没有发现 P0；这不代表已证明所有生产攻击面安全。审查范围是本地、单节点、当前实现及本报告列出的场景。

| 证据类别 | 本轮结果 |
| --- | --- |
| 单元测试 | 16 suites，106 passed |
| Chat／Topics／上传队列状态测试 | 19 passed |
| 真实后端集成 | 83 非直播 passed；另外执行 8 直播 passed；合计 91 个不同用例 |
| 真实浏览器 | 不同运行合计 46 个不同用例通过；不是一次全量 46/46，首次失败与复测见 C |
| 隔离 UI 测试 | 12 passed；使用既有 mocked API，不代替真实集成证据 |
| 类型／lint／Nest+Next 构建 | 环境修正后的执行均通过 |
| 新构建的 API／worker／Web 镜像 | 构建、实际 multipart、Linux FFmpeg、API 重启后预览通过 |
| 独立补充探针 | 字节边界、权限、配额、竞争、清理等通过；另复现 P1-01、P2-01 |

机器可读总览：[summary.json](opspilot-media-library-evidence/summary.json)。历史开发报告的通过数字没有计入上述结果。

## B. 基线、环境与需求矩阵

### 基线与隔离

- 仓库：`/Users/ruzhan/computer_science/projects/OpsPilot`。
- 分支：`feat/streamops-chat-integration`。
- 审查 commit：`144a9aea08eacb2a64a2f95c9429b7c9facb20c7`。
- 开始时唯一未跟踪文件：本轮独立验收任务文档。应用工作区无修改。审查结束时 HEAD 不变。
- 从该 commit 用 `git archive` 建立审计副本：`.runtime/media-library-acceptance/20261102/checkout/`。没有切换或覆盖日常开发 checkout。
- 副本与原仓库的 `apps/api/src`、`apps/web/src`、`packages`、`prisma` 共 **273 个文件字节比较一致**。应用源码、依赖清单和断言未为通过测试而修改。
- 测试副本只适配固定地址、测试启动配置和独立镜像 tag；新增探针只在审计副本中运行。详见 [环境适配记录](opspilot-media-library-evidence/environment-adaptations.json)。

| 项目 | 实际环境 |
| --- | --- |
| 宿主 | macOS 26.6.2，Darwin x86_64；Node 22.20.0，npm 10.9.3 |
| 浏览器 | 本机 Chrome 156.0.8078.74，由 Playwright 驱动 |
| PostgreSQL | 17.11；共享容器只用于创建独占数据库 `opspilot_media_audit_20261102_test`，端口 5546 |
| 数据库初始化 | 对新空库执行追加迁移，seed 一次；未重置普通开发库或以前的测试库 |
| 迁移兼容性 | 另一个 UUID 命名的临时库，迁移探针仅删除其自行创建的库 |
| Redis | 本轮独占容器 `opspilot-media-audit-20261102-redis`，7.4.10，6404/0 |
| 存储 | 本轮独占 MinIO 容器，`RELEASE.2025-09-07T16-13-09Z`，9006；bucket `opspilot-media-audit-20261102` |
| Web／API | 独立 3105／4205；API 单元化集成及补充探针使用各自临时监听端口 |
| 直播回归 | 独立 MediaMTX 1.21.3，1939／8896／9996；未替换原来的直播实例 |
| 容器冒烟 | 本轮 tag，Web 3012、API 4112；独立 DB／Redis／bucket，镜像内真实 Linux FFmpeg |
| 邮件 | 复用本地 Mailpit，只查询本轮唯一测试收件人；未清空邮箱或发送外部邮件 |

原始日志、authenticated traces 和故障脚本保留在权限受限的 `.runtime/media-library-acceptance/20261102/`，不放入报告证据目录。持久化证据只含脱敏结果、命令和摘要。

### 实现盘点与状态契约

- 数据库沿用 MediaAsset／MediaUpload／MediaProcessingJob／EventMediaAsset，增加 multipart manifest、owner／operation 唯一性、part receipts、sourceSha256、durable cleanup、executionVersion。迁移是追加式，未另建用户或媒体体系。
- 主上传链：File → 顺序分片哈希 → init → 原生 MinIO multipart → ListParts 确认 → FINALIZING → 原始字节验证 → UPLOADED + 唯一初始 job → BullMQ／FFmpeg → READY。
- 浏览器 queue、上传状态、资产状态和处理 job 状态分开管理；100% 传输不等于媒体可播放。每页 3 个文件 worker，每 worker 顺序传片；不是跨所有 tab 的全局 3 并发。
- 当前 staff session 和 WorkspaceMembership 是授权依据。观众不会因为 event admission 获得 workspace library 权限；同工作区不同 event 合法复用媒体。
- 不把源 Mudu 的历史行为作为新增验收义务。设计依据为[批准的融合任务](../integration/media-library-integration-task.md)和[实现前契约](../integration/media-library-integration-plan.md)，开发完成声明仅作待核实材料。

### 需求矩阵

`PASS` 只涵盖表内明确描述的实际证据；同一要求的未覆盖分支单独列出，不能用整体通过掩盖。

| ID | 预期 | 本轮实际行为／运行证据 | 代码定位 | 状态 |
| --- | --- | --- | --- | --- |
| BASE-01 | 基线、隔离与可复现命令明确 | 独立资源、273 文件比较、命令与失败记录齐全 | Git `144a9ae`；C 节 | PASS |
| DATA-01 | 追加迁移及旧协议兼容 | 43 张原表、9 行代表夹具的原列计数／摘要不变；legacy 行 manifest 保持 NULL；旧上传仍能真实处理 | `prisma/migrations/20261031020000_media_multipart/migration.sql`；migration probe | PASS（兼容可用不等于 P1 安全通过） |
| UP-01 | 真实字节与元数据持久化 | 视频、音频、multipart 和 Linux 容器真实处理；哈希匹配 | `multipart.service.ts:254`；API／浏览器／容器证据 | PASS |
| UP-02 | 分片、大小及完整性检查 | 小文件、恰好 5/10/100 MiB、20 片、余片；空／超限／错误 checksum／缺片拒绝 | `multipart.service.ts:43,203,368,409`；[边界探针](opspilot-media-library-evidence/boundary-probes.json) | PASS（multipart） |
| UP-02-L | legacy 已完成源不可被替换 | READY 后同一 PUT 链接重写成功，原文件 SHA 改变而状态和旧预览不变 | `media.service.ts:93,179`；P1-01 | FAIL |
| UP-03 | 实际媒体探测及明确失败 | 真 301 秒 H.264 和 MOV/MJPEG 被 FFprobe 路径拒绝，3 次尝试后 FAILED、无 variants；损坏媒体／恢复由 API suite 覆盖 | `media-processing.processor.ts:163,350`；[非法媒体](opspilot-media-library-evidence/invalid-media-probes.json) | PASS |
| QUEUE-01 | 并发有界、槽位释放、进度准确 | 实际保持 3 个传输，第四个等待；取消释放槽位；错误进度回到已确认字节；状态测试覆盖迟到回调 | `upload-queue.ts:231`；multipart browser、19 state tests | PASS |
| QUEUE-02 | 后端配额独立于浏览器 | owner 12 并发 API 检查通过；6 个经真实登录验证的 actor 并发 65 次 service init 得到 64 成功、1 冲突，取消后可复用槽位 | `multipart.service.ts:65`；[安全探针](opspilot-media-library-evidence/security-probes.json) | PASS；配额探针刻意不把 HTTP 429 当配额拒绝 |
| RES-01 | 只补传缺失片 | reload/reselect 错字节拒绝；正确内容恢复；另真实中断第二片后显示错误，重试尝试序列 `[1,2,2,3]`，第一片只传一次 | `upload-queue.ts:252`；[重试](opspilot-media-library-evidence/chunk-retry.json) | PASS |
| RES-02 | 内容身份、旧会话及初始化恢复 | 原 API 的 S3 初始化失败用例、超过 50 条终态后的恢复；补充证明 S3 已创建但 DB 未记录时同一 session 恢复且仅保留 1 个 multipart | `multipart.service.ts:155,171,216`；independent probes | PASS |
| CAN-01 | 取消停止工作并持久清理 | 在途／排队取消通过；真实 60 秒 grant 后第 65.054 秒删除故障，第 95.515 秒定时重试清理成功，无处理 job | `multipart.service.ts:301`；[定时清理](opspilot-media-library-evidence/scheduled-cleanup.json) | PASS（已完成分片后取消及常规在途取消） |
| CAN-01-X | 请求跨过 grant TTL 和清理完成后才落盘 | 未用慢速流证明“请求在到期前开始、清理后才完成”的存储极端时序 | `media-cleanup.processor.ts:65`；P2-02 | NOT VERIFIED |
| CAN-02 | 取消／完成确定语义 | 两个胜者均用实际 PG 锁与屏障验证：cancel 赢无 job；complete 赢后 cancel 返回 UPLOADED，唯一 job | `multipart.service.ts:254,301,452`；[独立探针](opspilot-media-library-evidence/independent-probes.json) | PASS |
| IDEM-01 | 丢回执／重试不重复注册 | 并发 complete、数据库失败恢复、浏览器丢完成回执、进程重启均保留唯一资产／初始 job | API multipart/restart，browser multipart | PASS |
| AUTH-01 | 当前身份／角色／owner | 新旧 token 的降级、session 撤销／到期均拒绝；管理员仅能取消别人的上传；锁等待后撤权也拒绝新 URL | `media-authority.ts:13`、`media-access.guard.ts:8`；security／boundaries suites | PASS |
| AUTH-02 | 租户隔离与合法 event 复用 | foreign upload／asset／preview／delete／关联拒绝；同 workspace 两个 event 关联允许；真实观众凭据访问 5 类库操作均 401 | security／boundaries suites | PASS |
| AUTH-03 | 私有存储、grant 范围及撤权窗口 | 无签名读取 403；新授权即时受当前权限限制；60 秒 part 实际到期；300 秒 preview、600 秒 legacy PUT 窗口明确 | `storage.service.ts:51,209`；API multipart/boundaries | PASS（签发与 TTL）；P1-01 单独阻断已完成原文件的完整性 |
| STATE-01 | 身份切换拒绝旧数据 | 两个真实登录与独立 workspace，释放含 A 私有数据的迟到响应，B 页面仍只显示 B；B 搜索 A 名称结果为空 | `media/page.tsx:30`、query scope；[身份切换](opspilot-media-library-evidence/identity-switch.json) | PASS（列表迟到、撤权、queue disposal）；未单独穷举全部 preview 网络时序 |
| CONS-01 | DB／存储／队列失败恢复 | 存储完成后 DB 失败、丢响应、丢 enqueue、输出写入后 DB 失败通过；队列恢复扫描发现 P2-01 | `media-queue-recovery.service.ts:50`；D/E 节 | FAIL（恢复扫描公平性）；其他已列边界 PASS |
| CONS-02 | 真重启与旧任务隔离 | API、worker 真 SIGKILL 后恢复；一个 job、两个 variants、一个完成事件；容器 API restart 后预览可用 | `media-restart.e2e-spec.ts:170`；container probe | PASS（崩溃／重启）；仍存活的旧 worker 恢复并与新 generation 竞争为 NOT VERIFIED，见 P2-02 |
| CONS-03 | 引用、删除、重试清理和缺失对象 | attach/delete 两个确定性胜者都 409 拒绝败者；删除失败／回执失败可重试；缺失原文件检测；101 个清理项中前 100 失败不饿死末项 | `media-cleanup.processor.ts`；[一致性探针](opspilot-media-library-evidence/consistency-probes.json) | PASS（已列分支）；原文件内容替换遗漏见 P1-01 |
| PROC-01 | 真实视频／音频处理 | BullMQ、FFmpeg、私有 MP4／MP3 与缩略图通过；非 mock play | `media-processing.processor.ts`；API/browser/container | PASS |
| UI-01 | 真实页面完整流程与错误 | multipart、续传、失败重试、取消、丢回执、撤权、视频／音频解码均通过 | 真实媒体 browser tests + 新探针 | PASS |
| UI-02 | 资源释放 | video 关闭后 pause/remove src；10 次 preview 周期强制 GC 后 retained video=0，DOM／listeners 后段稳定 | `media-preview.tsx:16`；[性能记录](opspilot-media-library-evidence/local-performance.json) | PASS（短期局部工作负载） |
| REG-01 | Chat／Topics 不回归 | 实时交互、重连、分页、未读、审核、429 重试及隔离通过 | Chat/Topics API/browser/recovery suites | PASS |
| REG-02 | Polls／SSE／Live Ops／身份与准入 | 两端 Polls、运营流程、只读权限、注册／邮件邀请和撤销通过 | app/attendee/restricted API + browser suites | PASS |
| REG-03 | 直播／Watch Room 和既有媒体 | 8 API + 4 真 RTMP→HLS/browser、single-PUT/audio/outbox/webhook 回归通过 | broadcast/media-processing suites | PASS（旧源文件完整性缺陷另列） |
| BUILD-01 | 类型、lint、构建与容器 | 最终应用基线类型/lint/Nest/Next/images/runtime 全部通过 | C 节及 commands.json | PASS |
| PERF-01 | 实测并说明限制 | 近 100 MiB 20 片及 10 次 preview；无生产容量宣称 | F 节 | PASS（观测任务），worker/native 内存完整剖析未执行 |
| SEC-01 | 输入／路径／资源／依赖审查 | 服务端生成 key、DTO 拒绝 owner/role 注入、实际媒体探测、字节/会话限制；选定日志未发现真实凭据；prod audit=0 | validation/storage/command-runner；security probes | PASS（已审查边界）；未做渗透测试或恶意文件扫描认证 |

## C. 实际执行记录

完整命令、开始 UTC 时间、退出码和耗时见 [commands.json](opspilot-media-library-evidence/commands.json)。以下 `R` 是本轮独立运行器，而不是仓库中会覆盖环境的 `with-media-test-env`：

```sh
cd /Users/ruzhan/computer_science/projects/OpsPilot
# R <日志标签> <命令及参数> 的实际展开：
node .runtime/media-library-acceptance/20261102/run.mjs <日志标签> <命令及参数>
```

运行器将 cwd 指向审计 checkout，加载本轮随机本地密钥，再指定本轮 DB、Redis、bucket、API/Web 地址。它不加载日常开发凭据；所有命令的最终子进程环境一致。复现前先验证资源归属，不能把这些示例直接接到普通开发库。

| 实际底层命令（由 R 执行） | 结果 |
| --- | --- |
| `npm run db:deploy`；`npm run db:seed` | 新库迁移通过，seed 一次 |
| `npm run test --workspace=@opspilot/api -- --runInBand` | 16 suites / 106 passed |
| `node --import tsx --test tests/chat-state.test.ts tests/topics-state.test.ts tests/topics-drafts.test.ts tests/media-queue.test.ts` | 19 passed |
| `npm run lint`；`npm run typecheck`；`npm run build` | PASS；Nest + Next 生产构建 |
| `npm run test:e2e --workspace=@opspilot/api -- --runInBand` | 9 suites / 83 passed，8 broadcast skipped（此运行关闭 broadcast） |
| `npm run test:e2e --workspace=@opspilot/api -- --runInBand broadcast.e2e-spec` | 独立启用 broadcast 环境：8 passed；与前者合计 91，不把 skipped 算通过 |
| `node scripts/check-media-migration.mjs` | 43 原表／9 夹具，原列内容摘要一致，legacy 协议保持 |
| `npx playwright test` | 首轮 25 passed / 3 failed，含新增真实音频测试；原因见下文 |
| `npx playwright test e2e/media-multipart.spec.ts` | 修正审计端口拦截后，3 passed |
| `npx playwright test --config=playwright.chat-recovery.config.ts` | 员工／观众 12 passed |
| `npx playwright test --config=playwright.broadcast.config.ts` | 4 passed，实际 RTMP/HLS、双观众、断流／API restart、撤权 |
| `npx playwright test --config=playwright.ui.config.ts` | 12 passed，既有隔离 UI mocks；单独计数 |
| `npx playwright test e2e/audit-media-isolation.spec.ts` | 首次补充探针自身路由断言错误；限定拦截旧响应后 1 passed；保留原失败记录 |
| `npx playwright test e2e/audit-media-retry.spec.ts` | 新增真 chunk 中断／可见错误／缺失片重试：1 passed |
| `node audit-media.cjs` | 3 个验证场景 PASS，另 2 个场景复现 P1-01/P2-01；脚本退出 0 仅表示采证完成，不表示产品通过 |
| `node audit-security.cjs` | 直接角色矩阵、撤权／失效／经理取消、64 并发配额均 PASS |
| `node audit-boundaries.cjs` | 4 类拒绝和 4 个真实尺寸／哈希场景 PASS |
| `node audit-invalid-media.cjs` | 真 301 秒视频与不支持 codec：2 PASS |
| `node audit-cleanup.cjs` | 真 grant TTL、定时清理故障与后续重试 PASS（95.515 秒） |
| `node audit-consistency.cjs` | attach/delete 两个竞争结果、101 项清理公平性：3 PASS |
| `docker build --target api -f apps/api/Dockerfile -t opspilot-media-audit-api:20261102 .` | PASS |
| `docker build --target worker -f apps/api/Dockerfile -t opspilot-media-audit-worker:20261102 .` | PASS |
| `docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:4112/api/v1 -t opspilot-media-audit-web:20261102 .` | PASS |
| `node scripts/check-media-containers.mjs` | 副本仅替换独立 image tags；真实上传、Linux FFmpeg、哈希及 API restart 后预览 PASS |
| `npm audit --omit=dev --registry=https://registry.npmjs.org --json` | 生产依赖 0 advisories，退出 0 |
| `npm audit --registry=https://registry.npmjs.org --json` | 40：4 low、36 moderate、0 high/critical，含 dev toolchain，退出 1；未自动修复 |

初次失败与复测保留：

1. 首次审计副本仅链接根 node_modules，遗漏 workspace 局部安装；unit 有 1 suite 无法加载、98 已执行用例通过，typecheck/lint 也因缺失模块失败。随后将本机已有依赖做文件系统 clone，未改 lockfile 或包版本；106 tests、lint/typecheck 通过。
2. 首次 Next 构建因依赖 symlink 指到审计根之外，被 Turbopack 拒绝；使用本地依赖副本后原配置构建通过。不是应用编译修复。
3. 配置的 npm mirror 不支持 audit endpoint，首次 audit 404；显式使用官方 registry 后获得上表结果。
4. 首轮媒体浏览器 3 个失败都是 `isPart` 谓词还检查原 MinIO 9002；隔离存储为 9006，故没有执行预期的延迟拦截。保留首次 25/3 结果；只改审计副本端口，3 个原断言全部复跑通过。
5. 新身份切换探针已证明旧数据未出现，但路由处理器还拦截了 B 的后续搜索，并错误要求其响应含 A 的记录；这是探针错误。改为只拦截第一个 A 响应，保留原始响应确含 A、B 不显示 A、B 搜索无结果的断言后通过。

没有删除或弱化既有失败断言，没有把未执行项写成 passed。上述不同运行不能表述为“一次全套无失败”。

## D. 缺陷

### P1-01：legacy 上传 URL 可重写已完成原文件，READY 与衍生文件失去一致性

**状态：已稳定复现，未修复。** 属于仍暴露的兼容入口；未断言它是本轮新写的 multipart 算法引入。

复现：

1. 以真实当前 writer 登录，用 `POST /media-assets/uploads` 创建 single-PUT intent。
2. 上传真实 H.264 MP4，调用旧 complete，等待真实 worker／FFmpeg 将资产处理为 READY。
3. 保存原文件和 preview 哈希。使用仍有效的同一 PUT URL，写入相同长度、完全不同的字节。
4. 获取原文件并运行实际 cleanup reconciliation；再次查询 DB 和 preview。

期望：已发布资产的权威原文件应被冻结，或替换必须走新的受控版本／验证流程；不能静默修改已经处理过的源文件。

实际：PUT 返回 200；146,837 字节原文件被替换；DB 仍 READY，`sourceSha256=null`，preview 未变化。reconciliation 只检查 key 存在，不能识别同 key 内容替换。

| 值 | 实测 |
| --- | --- |
| 原源 SHA-256 | `272d394bacb30c063fcd653dddcbd115a3d8a048a88112b415c796d30adc4907` |
| 替换后源 SHA-256 | `17c1b3c1e64c9e863b35c8ca09a65496aaf0893d0cefbfd4e6cd9fd28134d8cd` |
| URL 期限 | 600 秒 |
| replay HTTP | 200 |
| cleanup 后状态 | READY |
| 衍生预览 | 与替换前相同 |

证据：[independent-probes.json](opspilot-media-library-evidence/independent-probes.json)，`legacy-original-replay-after-ready`；原始脚本 `.runtime/media-library-acceptance/20261102/checkout/audit-media.cjs`。

根因与文件：

- `apps/api/src/media/media.service.ts:93`：旧 intent 给最终 original key 签发可重复 PUT URL。
- `apps/api/src/infrastructure/storage/storage.service.ts:51`：签名未提供完成后的不可变对象边界。
- `apps/api/src/media/media.service.ts:179`：旧完成流程检查长度／MIME，后续处理继续引用同一可写 key。
- `apps/api/src/media/media-cleanup.processor.ts:135`：终态 reconciliation 检查对象存在性，不校验源内容变化。

影响：原始上传可在成功后丢失或被替换；后续下载／再处理与已生成预览不一致。这不需要外部存储管理员，也不要求猜测 object key，只需合法旧上传持有者重复使用已签发 URL。没有复现跨 workspace 越权。

建议：兼容旧 API 时把客户端 PUT 指向 staging key；完成时验证并冻结到独立的不可变 original，或明确固定对象 versionId 并在后续读取中使用。同步保存源摘要并设计拷贝／DB 失败恢复。仅缩短 TTL、隐藏旧 UI、补一次 HEAD 或在文档声明 bearer window 都不能解决已完成源的可变性。

修复验收应加入：READY 后重用 URL、原 URL 在撤权后仍有效时的写入、删除后的晚到写入、原文件／variant 一致性及旧数据兼容。不要简单删除 legacy API 来规避兼容要求。

### P2-01：恢复扫描只看最早 100 项，健康积压可阻挡后续丢失任务

**状态：已复现，未修复。**

复现：在真实 PG／Redis 中创建 100 个较早的 QUEUED 记录及对应健康 delayed BullMQ job，另创建第 101 个 QUEUED 记录但不入 Redis。运行恢复服务的启动扫描及真实 30 秒 timer；31 秒后第 101 个仍无 Redis job，DB 仍 QUEUED。

根因：`apps/api/src/media/media-queue-recovery.service.ts:50` 按 `updatedAt,id` 取前 100；健康 waiting/delayed/active 项直接 continue，既不推进扫描 cursor，也不更新独立检查时刻。因此后续缺失记录的恢复依赖前面记录先产生业务进展。

证据：[independent-probes.json](opspilot-media-library-evidence/independent-probes.json)，`recovery-backlog-fairness`。

边界：探针把前 100 个 delayed job 延迟设为一小时以固定观察窗口；这不是生产默认退避参数，也没有实测一小时。已证明两轮扫描不访问末项，**没有证明普通短队列必然永久卡死**。默认健康任务完成后可能解除阻塞。因此按积压下恢复延迟／缺乏公平性定为 P2，而非无条件 P1。

建议：使用有界分页游标或独立 `lastReconciledAt` 推进公平扫描；不要仅增大 `take`，也不要用业务 `updatedAt` 承担巡检调度。用大于一批的真实队列验证后部缺失 job 能在约定周期内被恢复。

### P2-02：两个关键极端竞争分支仍缺少运行证据

**状态：覆盖缺口，不是已证实的生产缺陷。**

- 在 grant 到期前开始的慢请求，直到清理完成之后才落盘；本轮实际测了 URL 过期、常规取消和定时删除失败重试，没有实现这个跨期流式时序。不能据此声称永无晚到孤儿。
- 真 SIGKILL／stalled 重执行通过，但没有让一个仍存活的旧 worker 在新 generation 接管后继续返回，并覆盖进度、外部写入和最终 DB 提交三个阶段。代码有 fencing，并不自动等于所有活进程重叠时序已验证。

相关：`storage.service.ts`、`media-cleanup.processor.ts`、`media-processing.processor.ts:196,485`、`scripts/media-restart-child.cjs`。建议另用独立传输代理及可恢复的 worker 屏障补证，避免在生产入口增加故障接口。任务将这些边界视作核心，不以 P2 的覆盖分类允许其自动通过。

## E. 数据库、存储与架构评估

| ID | 失败边界 | 证据／结论 |
| --- | --- | --- |
| F-01 | DB 预留后 S3 init 失败／S3 成功但回执未提交 | 现有 API 及独立实际 S3 调用后抛错均通过；刷新恢复同一 asset/session，存储仅 1 个 multipart |
| F-02 | PUT 成功／回执丢失 | server ListParts 为权威；保留已确认片，重试不重传全部 |
| F-03 | 对象完成后 DB 注册失败 | FINALIZING 持久化；重试验证 original 后注册唯一初始 job |
| F-04 | 完成 HTTP 响应丢失 | 浏览器 status readback 收敛，唯一 asset/job |
| F-05 | DB processing intent 已提交、Redis enqueue 失败 | 单项恢复通过；大批扫描公平性有 P2-01 |
| F-06 | Redis 与 DB 的任务状态不一致 | 缺失、终态 stranded reconcile、重启/stalled 及 delayed 积压有运行证据；waiting-children/prioritized 等全部状态组合未独立穷举，相关分支 NOT VERIFIED |
| F-07 | 输出写入后最终 DB 失败 | 真 transcode／存储写入，重试无重复有效 variants／完成事件 |
| F-08 | API 被真正终止 | 原始字节与 FINALIZING 保留，API retry 恢复；不是自动全盘 FINALIZING 补偿认证 |
| F-09 | worker 被真正终止／旧 worker 延迟返回 | SIGKILL、BullMQ stalled recovery 和更高 generation 发布通过；仍存活旧 worker 延迟返回未验证，P2-02 |
| F-10 | 删除墓碑提交后对象删除失败 | cleanupPending 留存，真实 timer 注入失败后自动重试通过 |
| F-11 | 对象删除成功、清理回执 DB 失败 | 已有 boundaries suite 回滚清理事务后再次删除，幂等收敛 |
| F-12 | READY 的必需对象缺失 | boundaries suite 检测缺失原文件并移出 READY；preview HEAD 错误路径受保护；未逐个移除每类 variant 后走完浏览器重新处理；不等同于检测内容替换 |
| F-13 | expiry／cleanup／attach/delete 并发 | 过期扫描锁后保留续期会话的 API 测试通过；attach/delete 两个胜者经锁等待验证，败者 409；跨 TTL 慢请求见 P2-02 |
| F-14 | cleanup >100 项且前批失败 | 101 个真实小对象夹具；末项第二轮获得机会，解除故障后全部收敛 |

优点：采用原生 multipart，原始字节、DB intent 和 worker 阶段职责明确；唯一约束和资源锁实际生效；当前身份授权与前端投影隔离相互补充；复用了 OpsPilot 的队列、事件、audit/outbox，没有增加平行的用户或存储体系。

需要关注：旧 single-PUT 与新 multipart 的完整性保证不一致；部分事务持锁跨外部存储调用，在受支持最大文件与故障下会增加锁／连接占用；新默认尺寸内的实测没有出现失败，但不能推断高并发生产容量。恢复扫描与清理扫描采用不同公平性策略，后一种已通过大于批次的验证，前一种未通过。

处理使用至少一次执行及幂等逻辑结果，不应表述为跨 PG／S3／Redis 的严格 exactly-once。最终报告没有把“代码有事务”当作跨系统原子性证明。

## F. 性能与资源观测

[原始数值摘要](opspilot-media-library-evidence/local-performance.json)：真实浏览器上传 104,856,576 bytes（比 100 MiB 少 1 KiB），20 片；内容是 4 秒 640×360 H.264 加 MP4 free atom 填充。另一个字节探针独立验证了恰好 104,857,600 bytes 的上限。

| 指标 | 本轮观测 |
| --- | --- |
| 浏览器上传阶段 | 4.928 秒 |
| 从启动到 READY | 6.839 秒 |
| part 传输窗口 | 2.558 秒，约 39.09 MiB/s |
| DB 记录处理耗时 | 1.391 秒 |
| API RSS 采样范围 | 300,359,680–340,811,776 bytes，27 samples |
| 浏览器 JS heap 采样范围 | 8,837,880–18,755,744 bytes，27 samples |
| animation frame gap | p95 16.7 ms，max 16.8 ms |
| 进度 DOM mutation | 20 次，约 4.06 次/秒；不是 React render 次数 |
| 10 次预览关闭后 | retained video=0；后段 Nodes=2965、listeners=440，无每轮持续增加 |
| 强制 GC 后 JS heap | 稳态后约 8.38→8.73 MiB，短期仍有小幅增长；未宣称零泄漏 |

这些是单机本地观测，不是隔离的生产吞吐基准。媒体素材短且主要靠填充达到尺寸，不能据此认证长视频、复杂编码或多机转码能力。3 文件并发另以真实延迟传输验证，不把单文件性能测量当三并发吞吐。

JS heap 不含全部 Blob／原生解码内存；API RSS 不含 worker、FFmpeg 和 MinIO。没有完成独立 worker/native 内存剖析、数小时 soak 或多节点压力测试。采样条件与这些限制保留，未给出推测的优化比例。

## G. 原有功能回归

| 模块 | 本轮证据 | 结论 |
| --- | --- | --- |
| Chat | PostgreSQL/WebSocket API；员工+邮件准入观众、历史分页／未读／scroll、断线补偿；另 12 个数据库超时、gateway、ticket、撤权浏览器用例 | PASS |
| Topics | 真实审批／回复／pin 并发／设置／私有可见性；页面重连、丢回执、分页、event 切换、草稿冲突；4 个真 429 等待窗口 | PASS |
| Polls／SSE／Live Operations | 两独立角色浏览器投票／结果、运营工作流、只读入口；另 UI 隔离套件单列 | PASS |
| 认证／workspace／event | 登录、会话失效、事件访问；注册邮件核验、邀请与撤销、观众不获员工权限 | PASS |
| 直播／Watch Room | 8 API + 4 浏览器；真实发布器、两个观众、HLS 解码、断流／API 重启、撤权、Chat/Topics/Polls 仍可用 | PASS |
| 既有媒体／集成事件 | 视频／音频转码、legacy API 可用、event 关联、audit/outbox/webhook 逻辑幂等 | 功能回归 PASS；legacy 源完整性 P1-01 仍失败 |

没有把原验收报告里的历史 FAIL 或后续修复报告的 PASS 直接当成本轮结果。上述结论来自本轮相应 suites/probes。

## H. 限制、资源交接与最终决定

仍然适用的产品边界：100 MiB／300 秒，24 小时续传会话，刷新后重选本地文件；每页 3 worker，owner 12／workspace 64；签名 URL 有限期 bearer 语义；已处理／正在引用的资产删除遵守 409 规则；没有新建观众上传、附件、录制、回放发布或视频插播。

其他未认证范围：超过服务限制的 ListParts 大分页没有用 1000+ 真实分片制造；未独立穷举所有浏览器预览迟到响应；没有云 S3、多节点 failover、任意 codec、安全恶意文件扫描或 production TLS 部署认证。SIGKILL 后 OS 临时文件不依赖 finally 清理，未证明自动回收全部进程残留；本轮不扫描删除他人的临时目录。媒体资产主列表仍无分页，这是既有明确的规模限制，不把短列表测试表述成大规模验收。

资源交接：测试 fixture 通常由所属 suite/probe 清理；首次失败保留的审计资产及日志仍可用于诊断。独占 audit DB、bucket/container 数据和新镜像保留，不 reset/drop，不删除现有用户上传。审计服务收尾状态见 [环境交接](opspilot-media-library-evidence/environment-handoff.json)。原日常 3000／4100 服务、原 Redis／MinIO／MediaMTX 未被停止或替换。Mailpit 中本轮唯一收件人的测试消息未批量删除。

优先整改与复验顺序：

1. 修复 **P1-01**，建立 legacy 完成后不可变的 source 边界，补重写／删除后晚到请求／再处理一致性测试。
2. 修复 **P2-01** 的公平扫描，并用超过一个批次的真实 DB/Redis 数据复验。
3. 为 **P2-02** 两个活请求／活 worker 的重叠边界补确定性证据，报告实际不变量及清理期限。
4. 复跑涉及的媒体 API、真实浏览器、容器与相关回归；根据影响扩展，保留本报告的历史结论。

**最终决定：FAIL。** 新 multipart 主流程和回归通过，不能抵消已复现 P1；核心未验证边界也不能自动放行。验收工作到报告交付为止，本轮没有执行上述修复。
