# OpsPilot StreamOps Media Library — 独立工程验收任务

文档日期：2026-11-02。状态：**已执行，结论见[独立验收报告](opspilot-media-library-integration-acceptance.md)。本文定义任务，不代表各项已通过。**

授权记录：本文最初仅获授权编写；用户随后明确要求“验收”，已据此执行独立检查。执行范围仍限审查、测试与报告，不修复应用代码。以下保留验收范围与通过门槛，实际结果以报告为准。

## 1. 角色、目标与范围

作为独立 Principal Full-stack Engineer、QA Lead 和应用安全审查者，对本次 OpsPilot Media Library 融合开展基于证据的验收。

重点确认：真实上传、缺失分片续传、取消与完成竞争、当前权限和租户隔离、PostgreSQL／MinIO／BullMQ 一致性，以及原有业务功能回归。判断依据是批准的需求与本轮独立复现，不是开发者的完成声明或历史测试数量。

这是验收，不是开发：

- 不修改应用源码、Prisma schema、迁移、依赖、既有测试或已提交运行配置；不静默修复，不删除、跳过或削弱失败断言。
- 后续执行时，允许在 Git 忽略的独立审计目录编写补充探针、临时测试配置和测试进程故障注入器，调用实际实现。不得向生产入口添加故障接口；持久化交付仅限报告和脱敏证据。
- OpsPilot 是唯一目标应用。Mudu 参考仓库保持只读；不复制历史生产包、品牌、私有研究或未确认来源材料。
- 不增加观众上传、Chat／Topics 附件、直播录制、回放发布、视频插播或新认证系统。直播与其他模块只做必要回归，不扩展为新的全系统独立验收。
- 若发现缺陷，只记录复现、影响和建议。交付报告后停止，等待另行授权修复。

## 2. 基线与验收依据

本文编写时读取的基线如下，执行验收时必须重新确认：

| 项目 | 记录 |
| --- | --- |
| 仓库 | `/Users/ruzhan/computer_science/projects/OpsPilot` |
| 分支 | `feat/streamops-chat-integration` |
| 文档编写前 HEAD | `144a9aea08eacb2a64a2f95c9429b7c9facb20c7` |
| 文档编写前工作区 | 干净 |
| 计划／契约 | `3be8621` |
| 后端／迁移／处理恢复 | `ba91276` |
| 上传队列／界面／预览资源清理 | `bda68de` |
| 刷新后恢复未完成的 S3 初始化 | `8632e12` |
| 融合报告／交接 | `144a9ae` |
| Mudu 来源参考 | `mudu-engineering-showcase`，报告记录的参考版本 `7bd9a2f`，只读 |

依据优先级：

1. [已批准的融合任务及修订](../integration/media-library-integration-task.md)：产品范围与兼容性要求。
2. [实现前计划与契约](../integration/media-library-integration-plan.md)：授权、状态和恢复策略。
3. [融合报告](../integration/media-library-migration-report.md)和实际实现：需要独立核实的声明、设计与限制。
4. [统一集成基础](../integration/mudu-integration-foundation.md)、[媒体运行手册](../runbooks/v1.1-media-and-webhooks.md)。
5. 既往 [Chat 验收](opspilot-chat-integration-acceptance.md)及[恢复修复](opspilot-chat-reconnection-remediation.md)、[Topics 验收](opspilot-topics-integration-acceptance.md)及[修复](opspilot-topics-remediation.md)、[直播验收](opspilot-live-streaming-watch-room-acceptance.md)及[修复](opspilot-live-streaming-remediation.md)。

历史 Mudu 行为不自动成为 OpsPilot 验收要求；历史 FAIL 不自动等于当前 FAIL，开发报告中的 PASS 也不能直接继承。本轮独立核实之前，所有待验收项均为 `NOT VERIFIED`。

记录完整 commit、分支、工作区差异、Node/npm、数据库、存储、Redis、FFmpeg、浏览器和容器版本。明确测试实际加载的是哪个源码／构建产物版本。基线若有变化，列出差异与影响，不 reset、stash 或覆盖他人的改动。

## 3. 隔离环境与执行安全

执行任何 seed、迁移、取消、删除、清理或进程终止之前，建立本轮资源归属清单：数据库、Redis 实例／分区、bucket、Compose project、服务端口、PID、测试账号／对象前缀及清理责任。

- 新建本轮独占、可丢弃、名称以 `_test` 结尾的 PostgreSQL 数据库，以及专用 Redis、独立 bucket；另建迁移升级夹具库。不得复用普通开发数据或上轮实现验证数据开展破坏性试验。
- **不能根据 `_test` 后缀判断安全。** `opspilot_chat_test` 目前承载日常开发数据；`opspilot_media_test` 及带日期的 integration 库／bucket 已用于实现验证，都不得直接重置、清空或作为新验收的可破坏数据。
- 先读 `scripts/with-media-test-env.mjs`、`with-chat-test-env.mjs`、`setup-media-test.mjs` 和 npm 脚本。现有包装器会覆盖外层环境，选择固定数据库、Redis、bucket、端口和本地密钥文件；仅在外层设置 `DATABASE_URL` 不足以隔离。特别检查 `test:media:api`、`test:media:browser` 内嵌包装器，不能在审计包装器外套它们后假定安全。
- 使用独立审计启动器，在最终子进程实际环境中设置本轮所有资源；启动前以连接查询确认 DB 名称、Redis 目标、bucket 和进程归属。seed 只允许对本轮新建空库执行一次。现有 setup 命令是参考入口，不是可盲目执行的安全保证。
- 浏览器必须指向本轮 API，核对 Next 构建时 API URL、API 的 WEB_ORIGIN、私有存储 CORS 和 Playwright `reuseExistingServer`。优先空闲端口；不得连接或强杀未知的 3000／4100 服务。
- 真实直播回归优先使用本轮独立 MediaMTX project、端口和密钥。若必须借用已有实例，先确认归属、无活动发布者及可安全暂停；记录并恢复原配置。无法安全隔离时标记阻塞，不覆盖正在使用的直播服务。
- 只能终止本轮创建的 API、worker、浏览器或发布器。不得停止共享 PostgreSQL／MinIO、执行 `FLUSHALL`、清空 Mailpit、删除已有 bucket／volume 或扫描删除共享上传。故障注入优先使用专用代理、隔离服务或测试进程边界。
- Mailpit 只查询本轮唯一收件人。禁用无关外部服务，不使用真实生产凭据、邮件或付费资源。
- 原始日志／探针置于 `.runtime/media-library-acceptance/<run-id>/`；报告证据置于 `docs/acceptance/opspilot-media-library-evidence/`。只保留必要元数据、摘要和脱敏截图，禁止提交 JWT、cookie、签名 URL、上传密钥、连接密码或原始堆快照。若发现真实凭据泄露，报告位置和影响，建议轮换，不传播值。
- 使用成功／失败均执行的归属清理和恢复流程；保留必要失败证据。结束时列出遗留测试资源、恢复的开发进程和仍存在的阻塞。

## 4. 实现盘点与需求矩阵

先盘点实际文件及调用链，不以本文的路径列表代替源码审查：

| 层 | 重点位置 |
| --- | --- |
| 数据模型／迁移 | `prisma/schema.prisma`；`20261031010000_media_event_correlation`、`20261031020000_media_multipart` |
| API／当前权限 | `apps/api/src/media/` 下 controller、service、DTO、`media-access.guard.ts`、`media-authority.ts`；既有 staff session／membership |
| 对象存储 | `apps/api/src/infrastructure/storage/storage.service.ts` |
| 处理与恢复 | media processing／queue recovery／cleanup processor 和 scheduler、`command-runner.ts`、既有队列、audit／domain-event／outbox |
| 前端／协议 | `apps/web/src/features/media/`、`apps/web/src/app/(app)/streamops/media/page.tsx`、`packages/media-contracts/` |
| 现有验证 | `tests/media-queue.test.ts`；四组 `apps/api/test/media-*.e2e-spec.ts`；三组 `e2e/media-*.spec.ts`；迁移、重启与容器探针 |
| 回归设施 | 现有 Chat／Topics／Polls／准入／直播测试，Playwright 配置、Dockerfile、环境包装器 |

画清 File → manifest → MediaUpload／MediaAsset → MinIO parts → finalization → durable job → BullMQ → FFmpeg → variants → READY 的状态和权限边界，确认没有另建上传体系或替换现有身份模型。

正式报告至少包含以下矩阵。每项补充实际行为、文件行号、命令／运行证据、断言、问题编号和状态。**C 为核心门槛，不能把其 `NOT VERIFIED` 当作通过。**

| ID | 要求 | 核心 |
| --- | --- | --- |
| BASE-01 | 版本、环境归属、证据和可复现命令明确 | C |
| DATA-01 | 增量迁移及旧 single-PUT 数据兼容 | C |
| UP-01 | 真实视频／音频上传、实际字节和元数据持久化 | C |
| UP-02 | 分片边界、签名约束、服务器完整性与大小检查 | C |
| UP-03 | 实际媒体探测、非法／损坏输入和明确失败 | C |
| QUEUE-01 | 文件／分片并发有界，槽位预留／释放、进度准确 | C |
| QUEUE-02 | 多 tab／多账号配额、失败后调度和重复回调 | C |
| RES-01 | 断网、失败重试、刷新后仅补传缺失分片 | C |
| RES-02 | 内容身份匹配、旧会话可发现、S3 初始化失败可恢复 | C |
| CAN-01 | 上传中取消、取消重试、临时存储最终清理 | C |
| CAN-02 | 取消与完成竞争具有确定、可解释语义 | C |
| IDEM-01 | 重复／丢响应不重复分配资产或初始处理任务 | C |
| AUTH-01 | 当前 session／membership／角色／owner 后端校验 | C |
| AUTH-02 | 跨 workspace／upload 隔离，合法 event 复用 | C |
| AUTH-03 | 撤权、过期、直接存储访问与已签发 URL 的边界 | C |
| STATE-01 | 身份／工作区切换和晚到响应不泄露旧数据 | C |
| CONS-01 | 对象／DB／队列失败边界及可靠恢复 | C |
| CONS-02 | API／worker 真正重启、重执行与旧任务隔离 | C |
| CONS-03 | 删除约束、持久清理、孤儿／缺失对象和竞争 | C |
| PROC-01 | 真 BullMQ／FFmpeg、视频／音频预览和缩略图 | C |
| UI-01 | 完整真实浏览器工作流、错误反馈和实际解码 | C |
| UI-02 | 预览／上传卸载清理、缓存及重复打开资源不失控 | C |
| REG-01 | Chat 和 Topics 关键功能及故障恢复回归 | C |
| REG-02 | Polls／SSE／Live Operations、身份／事件／准入回归 | C |
| REG-03 | 真实直播、Watch Room 及既有媒体／audit 回归 | C |
| BUILD-01 | 类型、lint、生产构建、关键集成／浏览器和容器运行 | C |
| PERF-01 | 可复现本地负载、内存／响应性／清理观测及局限 | — |
| SEC-01 | 敏感日志、路径／MIME／资源边界和依赖风险评估 | C |

## 5. 真实上传、字节完整性与兼容性

至少准备真实可播放视频、真实音频、多分片视频、接近上限的大文件及无效／损坏文件。可使用合成素材；记录大小、媒体属性、内容来源和 SHA-256。使用填充 MP4 只证明传输尺寸与边界，不能据此证明高码率／长视频转码性能。

核实批准契约中的默认值，再记录实际配置及差异：100 MiB 原文件、300 秒媒体时长、5 MiB 非末尾分片、最多 20 片、24 小时会话、每页 3 个文件 worker／每 worker 顺序传片、每 owner 12 个未结束会话／每 workspace 64 个。

必测：

1. 完整流程使用真实 PostgreSQL、MinIO、Redis／BullMQ 和 FFmpeg。初始化到 READY 始终使用同一 MediaAsset；100% 传输不能提前等同于 READY。
2. 分别覆盖小于一片、恰好一片、分片整数倍、末尾不足一片、恰好／接近 100 MiB、超上限、空文件；无效格式用于校验拒绝，不要求空文件成为可播放媒体。
3. 直接请求非法片号、缺失／重复分片、错误长度、错误 checksum、篡改签名和对象标识。核实服务器从存储读取权威 receipt，不能信任客户端自报完成。
4. 对原始源文件和存储中的 original 比较 SHA-256；与 `sourceSha256`、parts、expectedSizeBytes 一致。不得把 multipart ETag 或转码后文件哈希当作源文件完整性证明。
5. 延迟或重复 PUT、同一片重传、晚到旧 grant 不得破坏最终文件；不完整文件不能进入可用状态。核实 listing 的截断／分页处理；当前 20 片上限内无法自然触发的分页分支，应单独标明覆盖方式，不能伪称大量真实分片测试。
6. 验证 MIME／扩展名伪装、损坏媒体、超时长和不支持 codec 的实际探测结果；失败后有明确状态、可解释重试和存储保留／清理策略。
7. 重载浏览器、重启本轮 API／worker 后，已完成 original／metadata／variants 保留且预览可用。seeded 公共演示预览不能充当真实处理证据。
8. 在独立升级夹具库构造旧表、旧上传和代表性 Chat／Topics／Polls／事件数据，应用追加迁移，比较原字段内容摘要及关系。验证 `manifest IS NULL` 的历史 single-PUT 行仍兼容；新 multipart 会话不能绕过专用协议调用旧 complete 端点。

## 6. 队列、重试与真正续传

使用实际延迟的传输观察调度，不只读代码或 mock worker。至少四个文件，其中前三个持有真实在途传输，第四个等待。

- 核实异步哈希／初始化开始前已预留槽位，每页同时在途分片不超过 3；区分文件并发、分片并发、后端转码并发。多 tab 的全局传输数不要求仍为 3，后端 owner／workspace 配额必须独立有效。
- 成功、失败、暂停、取消都释放应有槽位；等待任务有进展，无重复任务／完成通知、负进度、超过 100% 或永久卡死。
- 区分已确认字节、当前片传输字节、finalization、processing。失败／暂停回退到已确认字节必须可解释；进度回调不制造不可控渲染。
- 以真实 DB 并发验证 owner 和 workspace 配额及释放；将 API 限流与配额拒绝分开记录，429 不能冒充配额正确性的证明。
- 传输前后或确认响应丢失时重试，确认存储已有的有效分片被重用，不重复分配 asset／upload。
- **刷新续传完整场景：**至少确认一个分片 → 中断／暂停 → 整页刷新 → 从服务器发现原会话 → 重选文件 → 校验内容 → 只发送缺失片 → 完成处理 → 比较完整哈希。记录各片实际 PUT 次数和字节数。
- 重选同名、同大小、同 mtime 但字节不同的文件必须拒绝；重选正确文件可继续。名字不同但内容相同的处理遵守声明契约，不擅自添加文件名硬约束。
- 旧未完成会话不能被超过 50 条较新的终态记录挤出恢复列表；会话过期后不能继续授权或发布。
- 分别注入「DB 预留后 S3 初始化失败」及「S3 初始化已成功但 multipart ID／响应未持久化」。刷新后仍能恢复同一预留资产，遗留 multipart 只能按自身 key 回收。专门回归 `8632e12`，不能只重试原 init 而不走刷新后的 receipt 路径。
- 关闭上传弹窗、离开路由、logout、切换 user／workspace 的语义分别验证：关闭弹窗可继续页面任务；离页释放本地传输／File 引用并保留可恢复的服务端记录。旧回调不能写入新主体界面。

## 7. 取消、完成竞争与幂等

先记录客户端 task、MediaUpload、MediaAsset、MinIO multipart、processing job 的各自状态；“按钮变成 cancelled”不是完成证据。

| 场景 | 必须核实的结果 |
| --- | --- |
| 排队／哈希时取消 | 不再启动传输；若已有不确定预留，能确认并回收，不能遗留不可发现任务 |
| 初始化响应丢失后取消 | 重用原 operation 查明归属，不错误创建第二资产 |
| 分片在途时取消 | 浏览器停止后续工作；服务器确认终态；允许解释已授权在途请求，最终不能发布 |
| 取消响应丢失／重复取消 | 可以查询／重试取得原结果，无额外副作用 |
| 分片完成，注册尚未提交时取消 | 取消获胜则墓碑持久化，无有效处理任务，不得转为 READY |
| 注册已提交后取消 | 返回权威 UPLOADED／processing 结果，不谎称已取消；后续按资产删除规则处理 |
| 完成响应丢失／重复完成 | 同一 asset、一个初始 durable job，客户端可收敛 |

对取消和完成双方获胜的时序都做确定性测试：数据库锁、测试进程屏障或可解释的网络拦截。仅 `Promise.all` 偶尔跑过一次不足以证明两个分支。记录线性化位置、请求结果、最终 DB 状态、存储对象和队列任务。

取消后的旧 grant／晚到分片／旧 worker 不得复活资产。清理允许等待 grant TTL，但要观察约定期限后的 abort／删除及失败重试，不接受无边界的“稍后清理”。处理已启动时删除返回 409 是允许的既定策略，不要求新增强制终止功能。

## 8. 权限、租户隔离与签名链接

准备独立真实账号和 browser context：owner writer、另一 CONTENT_OPERATOR、ADMIN／OPERATIONS_MANAGER、只读成员、另一 workspace 的员工、已准入观众、未认证者。不能只开两个窗口却使用同一身份。

按实际命名建立 actor × operation 的直接 API 矩阵，至少覆盖 init、list/status、grant/confirm、complete/cancel、asset read/delete、retry、preview/thumbnail grant、event attach/detach：

- 当前 workspace 成员可读该 workspace 资产；写入角色按批准契约控制。观众凭据不自动获得工作区媒体权限。
- owner 只有仍具写权限时才能续传／完成。另一普通 writer 不能操作其上传；manager/admin 可取消别人的上传，但不能冒充 owner 续传或完成。
- 篡改 owner、role、workspace、assetId、uploadId、eventId、operationId、part number 或 object key，检查返回及无授权的 DB／存储副作用。相同 operation 在不同 owner／workspace 中不能泄露或串用记录。
- Workspace A 不能读取、预览、删除、恢复或关联 B 的资产。**同 workspace 的授权活动间复用资产是合法功能**；不得臆造逐活动员工 ACL。外 workspace 活动关联／解除必须拒绝；观众活动准入不得转换成库权限。
- 不重新登录，直接降级角色、删除 membership、撤销／过期 session，再测试原 JWT、原浏览器和后台请求。尤其验证请求等待资源锁后才获得执行权时，会重新校验当前权限。
- 当前约定 UI 最长约 5 秒权限刷新不是后端授权豁免；测量实际清理时间。延迟 list／status／preview 响应、旧缓存和任务回调不得在身份切换后显示别人的信息。
- MinIO 无签名 URL 不可匿名访问；仅知道 object key 不提供权限。检查 part grant 的 key／upload／片号／长度／hash 范围和真实过期行为。

明确区分三种撤权边界：

1. 新的应用操作和 URL 签发：必须受当前权限约束。
2. 已签发 bearer URL：按现有约定，part 默认 60 秒，preview／thumbnail 默认 300 秒，legacy PUT 默认 600 秒。验证实际 TTL、篡改和过期拒绝，不把仍有效的 grant 自动误判为绕过，也不声称其被即时撤销。
3. 已开始的传输／已交付字节：记录真实存储行为；客户端已取得的字节不能召回。无权主体仍不得通过完成操作发布资产。

专门测试 legacy PUT 在有效期内重写 original 的边界，以及完成／删除／清理后的晚到写入。记录对原始哈希、衍生文件和孤儿清理的影响；“向后兼容”不能自动豁免实际完整性或越权问题。

审查路径穿越、危险名称、输入渲染、MIME／扩展名欺骗、体积／片数／配额绕过、无界临时磁盘／内存、错误与日志泄密。新旧 API 都需要检查，不仅检查新 UI。

## 9. PostgreSQL／MinIO／BullMQ 一致性与恢复

普通 Prisma 事务不能原子提交三个系统。对下列边界逐项记录：注入点、哪些副作用已发生、重启前后状态、恢复触发方式、耗时、最终不变量及清理结果。

| ID | 故障／竞争 | 核心预期 |
| --- | --- | --- |
| F-01 | DB 预留成功、S3 初始化失败或成功回执丢失 | 同一会话可恢复，孤儿 multipart 受控 |
| F-02 | PUT 成功、part confirm 或其 DB 提交失败 | 权威 ListParts 可恢复，不盲目重传全部 |
| F-03 | MinIO 完成、上传注册 DB 事务失败 | durable FINALIZING 保留，验证已存 original 后注册一次 |
| F-04 | 完成成功、HTTP 回执丢失 | 查询／重试收敛到同一结果 |
| F-05 | 处理意图提交、Redis enqueue 失败／缺失 | 稳定 job ID 恢复，不丢任务、不重复分配初始 job |
| F-06 | BullMQ active／waiting／delayed／failed／completed 与 DB 不一致 | 健康任务不重复执行；缺失与终态冲突有明确恢复策略 |
| F-07 | 转码／输出写入成功，最终 DB 事务失败 | 重试不产生重复有效 variants／完成事件；旧输出可清理 |
| F-08 | API 在 finalization 中被真正终止 | 重启后保持原 asset/upload，不能依赖旧进程内存 |
| F-09 | worker 被终止、stalled 重执行或旧 worker 延迟返回 | 当前 job／generation 决定可提交者，旧任务不覆盖或复活状态 |
| F-10 | 删除墓碑已提交、对象删除失败 | durable cleanupPending 保留并最终重试成功 |
| F-11 | 对象删除成功、清理回执 DB 事务失败 | 可重复删除，不能留下不可恢复元数据 |
| F-12 | DB 标为 READY，但 original／preview／thumbnail 缺失 | 不返回假可用状态，有检测、错误及可解释恢复 |
| F-13 | expiry／cleanup 与完成、在途写入、retry、attach/delete 并发 | 锁后复核状态，引用／有效对象不被误删，晚到写入不永久成为孤儿 |
| F-14 | 清理多次失败或积压超过单批扫描上限 | 失败项不会永久饿死其他项；恢复后可收敛 |

不得仅调用恢复函数后看到一次成功就宣称自动恢复有效；至少分别证明 API 重试路径、定时／启动 reconciliation 路径和实际进程重启。记录 BullMQ stall／lease 及 30 秒 reconciliation 的实际等待边界，超时不能无限延长以掩盖卡死。

断言重点：

- 一个上传保留一个 asset 和一个初始处理 job；显式 processing retry 可以新建 job。不要把“逻辑结果不重复”表述为外部执行严格 exactly-once。
- 重复执行、并发重复 complete、重复 grant/confirm 不破坏字节或权威状态；失败／成功 phase 的 outbox 和 webhook 依照既有幂等键正确，`traceId` 仅作关联。
- worker 的进度、外部写入、失败和最终提交均受当前任务／generation 约束；不仅检查最终 SQL。
- 删除被活动引用或仍在处理的资产应按契约拒绝；解除引用后才能删除终态资产。若 attach 与 delete 竞争，不能留下悬空关联或误删已引用对象。
- 原始、注册 variants、未注册尝试输出和 multipart 残留分别核对。只清理精确归属 prefix；READY 共享资产不因超过 24 小时自动删除。
- 普通异常与取消需要释放临时资源；SIGKILL 无法执行 finally，应量化本轮遗留 OS 临时文件、验证恢复不依赖它们，并评估运行手册／人工回收边界。不得据此任意扫描删除他人的临时目录。

故障注入必须保留真实 DB／存储／队列侧效果。测试依赖可在明确边界抛错或暂停，但不能用 mock 成功替代实际副作用。不能安全复现的核心竞争标记 `NOT VERIFIED`。

## 10. 真实浏览器、预览与资源

至少用真实登录和真实后端串起上传→分片确认→finalization→processing→READY→缩略图／预览→reload，再覆盖续传、取消、丢响应、权限撤销和删除反馈。

- 视频必须取得真实存储 bytes，`currentTime` 前进并有解码帧；音频必须加载真实音频派生文件并验证播放进展。mock `play()`、单个 HTTP 200、仅挂载元素都不算播放证据。
- 损坏源、处理失败、预览对象缺失、签名过期、网络中断和用户取消要有可操作反馈。上传成功不能掩盖 processing FAILED。
- 切换资产、关闭弹窗、离开页面和变更身份后，旧 source、播放 promise、订阅、timer、AbortController、File／Blob 引用均按契约释放；若使用 object URL，检查创建／撤销时机。
- 专门回归已报告的预览缓存保留问题：连续至少 10 次打开／关闭，观察 detached video、DOM、listeners 和 heap。区分 React Query 缓存、AbortError stack、浏览器／测试工具保留；不能仅以 `pause()` 成功宣称没有泄漏。
- 核实桌面／窄屏队列、加载／错误态、键盘关闭和按钮可操作性；不开展无关视觉重设计。

在受控本地工作负载中记录吞吐、哈希／finalization／处理耗时、浏览器 JS heap 和可取得的进程内存、API 与 worker RSS、UI 响应性、进度更新频率及重复取消后的资源。无法测得的项明确标注，不以 API RSS 代替 FFmpeg／MinIO／浏览器原生内存，不以 DOM mutation 次数冒充 React render 次数。说明是否强制 GC、是否有其他构建负载；不得外推为生产容量或编造改善百分比。

## 11. 原有功能回归与自动化计划

先检查现有脚本及测试的副作用，再在本轮隔离环境顺序执行。编译产物可以生成；不得借此修改生产代码、依赖或既有测试。优先复用既有断言，并以独立探针补缺口。

| 范围 | 最低验证 |
| --- | --- |
| Chat | 员工／观众独立客户端通信、持久历史、分页、审核、scroll／unread、去重、真实 DB timeout／gateway／ticket 故障恢复、撤权和事件隔离 |
| Topics | 提交、pending 隐私、审批、回复、编辑／删除、pin 并发约束、设置、刷新／重连、旧响应与限流恢复 |
| Polls／Live Operations | 发布／投票／结果、SSE 更新、角色控制、原 operational session 和状态流程 |
| 身份／事件 | staff login/logout、workspace 权限、事件管理、注册／邮件准入、邀请与撤销、观众不能取得库权限 |
| Live Streaming／Watch Room | 真实 RTMP→HLS 解码、员工／观众访问、断流／API 重启、撤权、交互不受媒体上传／预览影响 |
| 既有媒体／审计 | single-PUT、真实视频／音频处理、event attach/detach、失败重试、outbox／webhook 幂等及 audit |
| 工程检查 | 类型、lint、单元／状态／真实 API 集成、Playwright、Nest／Next 生产构建、最终镜像启动与真实处理 |

以下是**后续候选命令，不在本轮文档编写中执行**。执行者先准备并验证隔离启动器，再使用无内嵌固定环境的底层命令；不要把以下无环境示例直接运行到日常开发库：

```sh
npm run typecheck
npm run lint
npm run test -- --runInBand
node --import tsx --test tests/chat-state.test.ts tests/topics-state.test.ts tests/topics-drafts.test.ts tests/media-queue.test.ts
npm run build
npm run test:e2e --workspace=@opspilot/api -- --runInBand
# 在确认隔离 API／Web／worker 和 production Web 配置后：
npx playwright test
npx playwright test --config=playwright.chat-recovery.config.ts
npx playwright test --config=playwright.broadcast.config.ts
npx playwright test --config=playwright.ui.config.ts
```

另行审查并在隔离环境运行 `scripts/check-media-migration.mjs`、`media-restart-child.cjs` 的所属测试、`check-media-containers.mjs` 及镜像构建命令。它们可能固定 PostgreSQL 容器名、端口、镜像 tag 或进程路径；记录限制，必要时在独立审计配置中适配，不修改被验收实现。完整构建应先于依赖 dist 的重启／容器测试，不能测试旧镜像后宣称新源码通过。

- 固定端口套件顺序运行，避免共享 Redis worker 或复用已有开发 server。测试前后检查有效环境及服务归属。
- 依赖／安全检查分别记录 production 和含 dev-toolchain 结果；不要沿用旧审计数字，不运行自动 `audit fix`。无法访问 registry 应记录阻塞。
- 每次执行记录命令、时间、退出码、执行／通过／失败／跳过数和证据路径。分清全量一次通过、失败后定向复测和不同版本结果；重复用例不能累加成独立覆盖。
- 不允许本轮修改旧断言以通过；如测试与批准的新契约不符，保留失败并解释，用独立补充断言验证正确契约，不能静默宣布原套件通过。
- 若其他模块原本就有问题，区分基线缺陷、此次引入的回归和环境问题；不得为完成媒体验收而修复其他模块。

## 12. 交付报告与缺陷格式

创建：`docs/acceptance/opspilot-media-library-integration-acceptance.md`。

报告必须包含：

1. **执行摘要与决定**：PASS／CONDITIONAL PASS／FAIL，主要风险及范围。
2. **审查基线与环境**：完整 commit、工作区、源码／构建对应关系、资源隔离和运行版本。
3. **需求矩阵**：本任务所有 ID 的 expected／actual、源码与运行证据、状态、关联问题；允许拆分条目，不得用笼统模块 PASS 替代。
4. **执行记录**：真实命令、退出码、测试数量、失败与复测历史、运行时间、未执行／阻塞项及原因。
5. **专项结论**：上传、续传、取消、权限／签名链接、DB／存储／队列一致性、预览资源、迁移与兼容性分别评价。
6. **缺陷列表**：每项给出严重度、稳定复现步骤、expected／actual、已确定的根因或推断、文件行号、影响面、脱敏证据和建议修复；建议不等于已修复。
7. **回归结果**：Chat、Topics、Polls／SSE、身份／事件、直播／Watch Room、既有媒体／audit 分开记录。
8. **性能与限制**：实际负载、指标、边界；对已声明限制作独立评估，不能自动免责或擅自扩大需求。
9. **环境恢复与后续优先级**：本轮资源清单、遗留物、恢复结果、最优先整改项和剩余风险。

状态定义：`PASS`（有本轮充分证据）、`FAIL`（行为不符）、`NOT VERIFIED`（证据不足／受阻）、`NOT IMPLEMENTED`（要求存在但功能缺失）、`DEFERRED`（仅限原先批准的排除范围）。不得把本应实现但未验证的核心项降为 DEFERRED。

缺陷严重度：

- **P0**：严重安全泄露、不可接受的数据丢失或跨租户完整性破坏。
- **P1**：核心流程失效、权限越界、不可恢复卡死、错误发布／复活、重要一致性或原功能回归。
- **P2**：中等可靠性／体验问题、非核心覆盖缺口或有边界的运维不足。
- **P3**：轻微问题、文档或可维护性改进。

按实际影响定级，不因作者、修复成本或历史“已知限制”降低等级。

## 13. 通过门槛与停止条件

只有满足以下条件，才能对本轮媒体融合给出 PASS：

- 无未解决 P0／P1，矩阵中所有 C 核心项有充分独立证据。
- 真实上传／处理／播放／重启持久化和源文件哈希一致通过。
- 正确分片、真实并发、缺失片续传、初始化失败恢复、取消双方竞争结果及幂等完成通过。
- 当前权限、owner／workspace 隔离、合法 event 复用和存储授权边界通过。
- 关键跨系统失败、旧 worker 隔离、删除／清理及缺失对象恢复得到验证。
- 关键浏览器流程与资源清理、必要回归、生产构建、类型和 lint 通过，环境得到安全恢复。

`CONDITIONAL PASS` 只适用于以上核心门槛已满足、仅留可接受 P2／P3 且条件明确的情况。关键项 `NOT VERIFIED`／`NOT IMPLEMENTED` 或有未解决 P0／P1，不能批准进入下一阶段；结论为 FAIL，注明是已证实缺陷还是关键证据阻塞。不能因测试环境不可用而假装核心项安全，也不能把环境阻塞编造成实现缺陷。

完成时给用户：总体决定、全部 P0／P1、实际测试结果、权限与存储一致性结论、各模块回归状态、剩余限制、优先整改计划、报告路径和审查 commit。

**交付验收报告后停止。不修复代码，不开始其他模块或全系统验收。**
