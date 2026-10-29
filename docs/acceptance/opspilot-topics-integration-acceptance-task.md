# OpsPilot StreamOps Topics / Q&A — 独立工程验收任务

文档日期：2026-10-29。状态：**待执行，本文不是验收报告，不表示任何验收项已通过。**

本次文档编写只定义后续验收任务；不运行验收、不修复代码、不开始下一模块。

## 1. 角色、目标与边界

作为独立 Principal Full-stack Engineer、QA Lead 和应用安全审查者，对 OpsPilot 已融合的 Topics / Q&A 做基于证据的全栈验收。

目标是确认员工与已准入观众可以在正确的 StreamEvent 中使用问答，审核、回复、编辑、置顶、删除和设置具有真实后端约束，实时状态与当前权限一致，并且原有 Chat、Polls 和业务功能没有回归。

这是验收任务。不得修改应用源代码、schema、迁移、依赖、既有测试或运行配置，不得静默修复缺陷或削弱断言。允许在被 Git 忽略的独立审计目录编写补充探针和临时测试配置，调用原实现并记录证据；不得将审计钩子写入生产代码。新增持久化文件仅限本次报告和脱敏证据。

不迁移 Mudu Media Library、Live Streaming，不增加附件、论坛、投票或新的认证／权限系统。Mudu 源仓库只读。已有媒体工作流仅执行必要回归。

## 2. 基线与依据

文档编写时的基线如下；正式验收开始时必须重新记录，不能假设工作区未变：

| 项目 | 基线 |
| --- | --- |
| 目标仓库 | `/Users/ruzhan/computer_science/projects/OpsPilot` |
| 分支 | `feat/streamops-chat-integration` |
| Topics 实现 HEAD | `a5bb2caf8041f9404cbdb6946ae42033f0417fb9` |
| 编写本文之前的工作区 | 干净 |
| 历史 Chat 集成基线 | `cdd9242` |
| 后续 Chat 恢复修复 | `1ac03b4`；文档检查点 `b09f5a2` |
| Mudu 参考仓库 | `/Users/ruzhan/computer_science/projects/mudu-engineering-showcase`，参考 HEAD `7bd9a2f36df8d0992260e1ba356754d6fce05f63` |

按以下顺序建立验收依据：

1. [已更新的 Topics 集成任务](../integration/topics-integration-task.md)：批准的产品范围与业务语义。
2. [实现前架构／契约计划](../integration/topics-integration-plan.md)：身份、生命周期、API、状态与恢复设计。
3. [Topics 迁移报告](../integration/topics-migration-report.md)及实际实现：待独立核实的实现声明与限制。
4. [统一集成基础](../integration/mudu-integration-foundation.md)：StreamEvent、员工／观众身份与共享设施边界。
5. [历史 Chat 验收](opspilot-chat-integration-acceptance.md)与[重连问题修复报告](opspilot-chat-reconnection-remediation.md)：既往缺陷与回归重点。

历史 Mudu 行为仅用于解释来源，不自动成为 OpsPilot 的验收要求。开发报告、旧测试输出和代码存在都不等于本轮通过证据。历史 Chat FAIL 也不能直接当作当前版本结论。

记录完整 commit、分支、未提交差异、Node/npm/PostgreSQL/Redis/浏览器版本。保留原始工作区，不 reset、stash、覆盖或提交他人的改动。若基线发生变化，说明差异及审查影响；报告明确区分实现基线和本次报告的提交。

## 3. 环境隔离与证据规则

- 使用新建、明确可丢弃且名称以 `_test` 结尾的 PostgreSQL 数据库、专用 Redis 实例或确认无人使用的逻辑库、独立存储 bucket，以及带唯一前缀的测试账号／事件／收件人。
- 可复用本地 Compose 服务，但不能复用普通开发数据库、此前实现验证数据库或已有上传作为可破坏测试数据。禁止 reset 共享数据库、清空 Redis、清空 Mailpit、删除已有 bucket 或 volume。
- 特别检查 `scripts/with-chat-test-env.mjs`：它会覆盖传入环境并选择 `opspilot_chat_test`、默认 Redis 分区和固定 bucket。不能仅在外层设置环境变量就认为完成隔离；必须在其子命令中覆盖，或使用独立审计启动器。
- 在迁移、seed、测试之前，验证实际连接的数据库名、Redis 分区、bucket 和服务进程归属。seed 仅允许对本轮新建空库执行一次。迁移升级试验使用另一个独立夹具库。
- 浏览器必须访问本轮隔离 API；核实已构建前端的 API URL，避免 `reuseExistingServer` 误用普通开发服务。优先选择空闲端口；不得强杀未知进程。若测试工具固定端口，先确认可安全暂停的任务进程，记录并恢复环境。
- Mailpit 仅查询本轮唯一收件人的邮件。关闭不需要的外部 AI、邮件或其他收费服务，测试不依赖外部凭据。
- 原始日志／临时探针放在 `.runtime/topics-acceptance/`；可提交证据放在 `docs/acceptance/opspilot-topics-evidence/`。记录命令、耗时、退出码、断言和环境映射，不能记录 cookie、JWT、一次性 ticket、验证 token、真实密钥或私有研究资料。
- 网络拦截只能用于可辨认的故障注入。先证明真实请求已提交／真实连接已中断，再注入丢响应或延迟；不能以 mock 成功响应代替真实数据库与 WebSocket 证据。
- 环境不支持的用例标记 `NOT VERIFIED`，说明阻塞点和所需条件，不执行危险替代方案。

## 4. Phase A — 实现盘点与需求矩阵

先盘点以下实际文件及其依赖，确认名称、路由和运行语义，而不是机械照抄本文：

| 层 | 重点位置 |
| --- | --- |
| 身份与授权 | `apps/api/src/event-interactions/`、`event-chat/chat-authorization.service.ts`、原 staff／attendee session 与 admission 服务 |
| Topics 后端 | `apps/api/src/event-topics/` |
| 实时设施 | `apps/api/src/event-chat/chat.gateway.ts`、`chat-ticket.service.ts`、Redis ticket 生命周期 |
| 数据库 | `prisma/schema.prisma`、`prisma/migrations/20261029010000_event_topics/migration.sql` |
| 前端／契约 | `apps/web/src/features/topics/`、`packages/topics-contracts/` |
| 产品入口 | `features/live-operations/live-session-room.tsx`、`features/registrations/confirm-attendee.tsx` |
| 自动化 | `apps/api/src/event-topics/topics.spec.ts`、`apps/api/test/topics.e2e-spec.ts`、`tests/topics-state.test.ts`、`e2e/topics.spec.ts`及 Chat 恢复套件 |

确认 Topics 复用 StreamEvent、既有身份和 `/chat` Gateway，没有重复 Room、用户体系或替代 Polls。分别画清 staff 与 attendee 的 REST 身份入口、ticket 签发、WS 订阅、受保护读取和写入路径。

建立下列最低需求矩阵；正式报告逐项填写实际行为、代码位置、运行证据、问题编号和结论，不得只填写笼统的模块 PASS：

| ID | 验收要求 |
| --- | --- |
| BASE-01 | 实现基线、测试环境和独立证据可追溯 |
| DATA-01 | 新库迁移与已有数据升级安全，模型、索引、约束正确 |
| AUTH-01 | 员工当前 membership／session／角色限制有效 |
| AUTH-02 | 观众准入、session、邀请及生命周期有效，身份不混用 |
| AUTH-03 | 跨 workspace／event／作者／父主题访问隔离 |
| AUTH-04 | 待审正文、回复、计数及通知标识的隐私隔离 |
| AUTH-05 | 已连接客户端与既有 token 遵守撤权、退出和过期 |
| TOP-01 | 提交、审批、分页、过滤与 PostgreSQL 持久化 |
| TOP-02 | 编辑重新送审、回复资格、父子删除一致性 |
| TOP-03 | 七条置顶上限、审批前置条件、先取消置顶再删除 |
| TOP-04 | audience publishing／replies／review 设置真正约束后端 |
| TOP-05 | 生命周期、版本冲突、错误反馈及边界输入 |
| CON-01 | 多位真实 moderator 并发操作维持业务不变量 |
| CON-02 | 重复请求、丢响应、SQL 回滚与提交状态可判定 |
| RT-01 | 员工／观众真实 WS 订阅、公开与私有通知正确 |
| RT-02 | 重复、乱序、缺失事件及提交后通知丢失可恢复 |
| REC-01 | 员工首次连接及重连遇到临时故障后自动恢复 |
| REC-02 | 观众首次连接及重连遇到临时故障后自动恢复 |
| STATE-01 | 分页与实时更新一致，旧快照／ACK 不复活内容 |
| STATE-02 | 活动、身份、过滤器、权限切换隔离与订阅清理 |
| UI-01 | 完整真实浏览器流程、可操作反馈与基本可用性 |
| REG-01 | Chat 含故障恢复回归 |
| REG-02 | Polls／SSE／Live Operations 回归 |
| REG-03 | 登录、事件、准入、权限及既有媒体回归 |
| BUILD-01 | 类型、lint、Nest／Next 生产构建及关键 E2E |
| PERF-01 | 受控本地负载、资源清理及共享事件锁影响可解释 |

## 5. Phase B — 真实工作流、数据与迁移

至少准备两个不同员工主体（例如 manager 与 admin）、两个不同已准入观众、一个只读员工、另一活动及另一 workspace。不同 browser context 不等于不同主体：断言两位 moderator 的 actor ID 不同。员工登录、观众邮件验证与准入必须走既有真实流程。

执行并保存浏览器／API／数据库一致证据：

1. 观众 A 提交主题；作者及 moderator 可见 pending，观众 B 和普通非作者看不到正文、回复或私有计数。
2. 员工审核后，A、B 和其他有权限主体看到同一 canonical topic；B 回复，员工回复，各端一致。
3. 员工置顶／取消置顶；两个不同 moderator 并发冲突，数据库与两个 UI 最终一致，失败端有明确反馈。
4. 编辑触发应有审核状态，单条回复删除、父主题删除和 tombstone 行为正确；旧请求不能让内容重新出现。
5. 操作三个配置开关，直接 API 与 UI 同时遵守。关闭审核不自动批准已有 pending。
6. reload 保留已提交状态；重启本轮拥有的 API 后，从真实 PostgreSQL 读到一致主题与回复。
7. 覆盖空值、空白、超长、非法 UUID、未知身份字段、错误版本／游标、分页上限、Unicode 和 HTML／脚本文本。用户输入作为文本显示，不能形成可执行内容。

新库必须完整迁移。再在独立夹具库构造 Topics 迁移前版本及代表性 Event、Chat、Polls、注册、权限和媒体元数据，然后执行追加迁移，比较旧表记录及关键内容摘要。不得向普通开发库做破坏性升级试验，也不得修改旧迁移以通过测试。

核实 staff／attendee 作者互斥字段、同 event 父子外键、观众与 event 外键、幂等唯一键、pinSlot 范围与唯一约束、正文／墓碑约束、sequence／version 索引。用隔离事务验证非法直接 SQL 被对应数据库约束拒绝；区分数据库约束和事务服务规则，不能把仅有服务校验描述为数据库强制。

## 6. Phase C — 权限与隐私审查

建立 actor × lifecycle × operation 的实测矩阵，逐项直接调用后端，不以按钮隐藏作为证明：

- 覆盖 ADMIN、OPERATIONS_MANAGER、CONTENT_OPERATOR、ANALYST、VIEWER、已准入／未准入观众、未认证者。根据批准契约检查 read/create/reply/moderate/configure 及本人编辑／删除权限。
- 覆盖 DRAFT、READY、LIVE、COMPLETED、ARCHIVED：发送、审核、配置、历史读取及 archived 不可修改的边界。员工可访问其 workspace 内活动不等于越权；不臆造未批准的逐活动员工 ACL。
- 篡改路由 eventId、topicId、replyId、作者／role／workspace 字段；用 A 的父主题给 B 回复、用 B 的路由操作 A 数据、读取同 workspace 的另一活动及外 workspace 数据。每个拒绝路径确认数据库无写入、socket 无泄露。
- 观众凭据仅能用于其实际准入活动。浏览器同时拥有员工与观众 cookie 时，非法观众凭据不能回退成员工身份。
- 验证 pending 的列表、过滤器、总数、回复、错误响应、mutation retry 返回值和 WS 通知；never-public pending 的 ID 不能向无权用户广播。
- 已公开主题编辑回 pending 后，旧公开读者可以收到无正文的失效通知，但不能取得新私有正文或回复。权限改变前已交付的字节不可召回；检查应用当前展示和后续访问，不要求擦除用户保存的副本。
- 在原会话／已连接 socket 上执行成员降级、移除、logout、观众撤销／过期及邀请失效。核实未来受保护操作和通知重新授权，记录 UI 清理延迟与拒绝状态，不能只重新登录再测。
- 审查 Origin、cookie／CSRF 防护、一用 ticket、过期与重放、channel 绑定。Topics ticket 不应获得 Chat 命令权限，Chat ticket 不应订阅 Topics 私有事件。
- Topics 当前写入使用 REST；验证伪造 WS mutation 事件不会绕过 REST 授权，不要求实现并不存在的 WS 写接口。
- 验证权限变化与正在执行事务的顺序：已持有授权锁的请求允许先于撤销提交完成；撤销提交后的请求不得继续利用旧角色。记录锁和线性化边界，避免将此契约误判为无限有效的 JWT 权限。

## 7. Phase D — 并发、幂等与业务不变量

使用真实 PostgreSQL、不同连接和明确的启动屏障／锁控制，记录请求时间与提交结果。不能用顺序调用或两次登录同一账号代替真实冲突。

1. 六条已置顶时，两位 moderator 同时争夺第七个槽；再用至少八个合格主题竞争空槽。最终最多七个唯一槽，无 pending／deleted 主题被置顶。各响应和版本必须可解释。
2. 并发 approve、pin/unpin、edit/approve、delete/pin、reply/delete、settings/create；断言合法提交顺序、409 冲突及失败事务无残留写入。删除 pinned 主题必须拒绝。
3. 删除父主题后正文与存活回复按契约一起清除；迟到回复不能形成孤儿。并发回复推进版本后，旧版本删除不能静默覆盖新状态。
4. 相同 operation ID 同载荷重复 create/reply 只产生一个实体；同 ID 不同载荷拒绝。编辑／删除后重试原创建不能恢复旧正文；当前权限仍需验证。
5. 服务端真实提交后丢弃 create、reply 和关键 moderator 操作的响应，按实际接口语义重试／查询。区分稳定 operation ID 与 expectedVersion 的不同保证，不将“看不到响应”直接标记为未提交。
6. 同一次编辑响应丢失，随后主题被批准，再重试编辑，不能重新变成 pending。重复已实现的目标状态不应无故再产生版本；陈旧冲突意图不得覆盖新版本。
7. 注入真实 SQL 失败／事务超时，确认主题、回复、pin、设置与 event revision 同步回滚。共享 event.updatedAt 的业务语义不得因问答变更被意外改变。
8. 验证回复上限：当前报告声明每根主题最多 100 条“累计创建过”的回复，删除不释放额度。核实批准契约、UI 提示及边界，记录这个产品限制，不擅自要求分页重写或将删除后不释放额度自动判为缺陷。

## 8. Phase E — 实时、断线与故障恢复

使用独立 staff／attendee 浏览器与真实 Socket.IO 连接。明确识别目标模块的 ticket／帧；页面同时有 Chat 和 Topics socket，不能靠“最后一个 socket”选择故障对象。

对员工与观众分别覆盖以下矩阵，并记录检测时间、恢复时间、UI 状态、socket／请求次数和最终数据：

| 阶段／故障 | 预期检查 |
| --- | --- |
| 首次 ticket／订阅初始化／初始 snapshot 暂时失败 | 显示可恢复状态，服务恢复后无需 reload 即成功；身份仍须重新验证 |
| 已连接后真实断开；离线期间创建／审批／编辑／删除 | 新 ticket 与权威快照恢复正确可见集合，父子关系和计数一致 |
| 重连初始化发生真实 PostgreSQL 锁等待超时／503 | 不进入永久 denied，解除故障后员工与观众均自动恢复 |
| 丢失通知、提交成功但通知发布失败 | 周期性 REST 修复，不把私有 sequence 间隙当成必须补齐的公开日志 |
| 重复／乱序／迟到 `topics.changed` | 不倒退已验证快照、不复活删除内容、不泄露 pending |
| 一次性 WS ticket 过期，但主体会话有效 | 重新确认主体身份并取得新 ticket；不能永远判定身份已失效 |
| 主体会话真正过期／撤权／活动不可访问 | 停止受保护访问并清理展示；不能用无限重试绕过权限 |
| Topics 临时不可用／组件卸载 | Chat 保持独立工作，Polls／SSE 不受误清理影响 |

报告声明健康情况下约 3 秒 idle 授权检查、5 秒 REST 修复。核实实际常量、请求时延和退避，预先定义有依据的测试截止时间并记录实测值；不能靠无限延长 timeout 把卡死变成通过。注入故障后确认健康 context 为 200，再观察恢复，重点防止历史 Chat 的“暂时 503 被当成永久权限拒绝”重现。

至少一个关键数据库失败场景使用真实锁／事务失败；仅 mock 抛错不足以证明恢复。浏览器 offline 模式可能不会关闭已有 socket，必须用服务端连接状态或帧记录证明断线。Redis 故障如需测试，仅操作专用实例，不暂停共享 Redis。

## 9. Phase F — 前端状态、分页与资源

- 验证 canonical map 与 approved/pending/pinned 投影一致，计数是授权后的总数而非加载条数；分页游标不能泄漏其他 event／private 数据。
- 加载多页时并发发生审批、删除、设置或权限变化；合并页必须属于一致 authority／watermark。达到重试上限后应可继续恢复，不能空转或永远保留失效快照。
- 确定性延迟旧列表、后续页和 mutation ACK；在其返回前切换 event、身份、filter、权限，或删除／重新送审目标。旧响应不能污染新上下文或让私有内容重新出现。
- 重复失效通知造成主题卡片暂时卸载时，未确认 reply 的文本和 operation ID 仍能按契约重试，不能重复发表；错误提示不得随卡片消失。
- 报告声明草稿只在当前作用域内存保存，切换身份／活动会清除，不跨整页 reload 持久化。按该语义验证，不能将其描述为离线持久草稿功能。
- 验证 API 默认／最大分页数量、UI 最多加载 100 根主题、回复默认折叠与展开。检查达到上限时的可理解反馈，不把文档中的有界窗口当作无限历史访问的证明。
- 检查加载、空态、409、403、503、未知提交结果、手动重试、审核反馈、禁用设置说明和键盘基本操作；包含窄屏视口。远端更新关闭编辑器的既有限制需实测并评估丢失输入的影响。
- 多次进出页面、切换事件、退出／重新登录，记录 Topics 拥有的 socket、listener、timer、AbortController 和在途请求是否释放；不能清理共享设施时断开 Chat，也不能由迟到回调写入已卸载组件。

## 10. Phase G — 测试执行与原功能回归

先审阅脚本与配置，再在隔离环境运行。以下是当前仓库的命令清单，不是本文已执行的结果；执行时记录真实命令、环境前缀、测试数量、失败、跳过和耗时。

```sh
npm run typecheck
npm run lint
npm test -- --runInBand
node --import tsx --test tests/chat-state.test.ts tests/topics-state.test.ts
npm run test:e2e --workspace=@opspilot/api -- --runInBand
npm run build
E2E_PRODUCTION_WEB=1 npm run test:ui
CHAT_RECOVERY_PRODUCTION_WEB=1 npm run test:chat:recovery
npm run test:ui:isolated
```

服务型命令必须使用第 3 节核实后的专用环境，不得直接复制运行到默认数据库。类型／构建若需要环境也使用隔离配置。定位问题可运行 `npm run test:topics:api`、`npm run test:topics:state`、`E2E_PRODUCTION_WEB=1 npm run test:topics:browser`；无需无理由反复执行已经通过的相同套件。

开发报告记录过 API 60 tests、主浏览器 16 tests、Chat 恢复 12 tests；这些数字仅帮助核对测试发现情况，不是本轮结果，也不是必须凑齐的数量目标。解释新增／缺失／跳过测试的原因。

至少分别报告以下回归：

| 功能 | 必测边界 |
| --- | --- |
| Chat | 员工／观众互聊、真实持久化、分页／锚点／未读、审核撤回、常规与临时数据库失败恢复、活动／身份切换 |
| Polls 与 SSE | 原创建／发布／关闭／观众投票、权限、实时更新和断流 fallback，Topics 不接管 Polls 状态 |
| Live Operations／Event | 事件访问与生命周期、运营界面及 operational session 流程 |
| Authentication／Admission | 登录退出、refresh、真实注册／邮件确认／入场、撤销和 cookie 身份边界 |
| Permissions | 当前 workspace membership、角色变更、跨租户拒绝，提取共享身份服务后行为不退化 |
| 既有 Media | 当前已有的 attach/detach、租户隔离及相关处理路径；不将单元模拟称为真实上传集成 |

真实 API／数据库／WS 与生产构建浏览器测试是主要证据。`test:ui:isolated` 使用 mock 夹具，只证明其覆盖的 UI 行为。检查测试选择实际 Chat socket 和忽略 Topics ticket 的适配是否保持原断言有效；不将跳过关键请求称为回归通过。

如已有套件缺少关键场景，补充独立审计探针，而不是修改既有测试来通过。审查故障 harness 的生产排除和仅测试环境保护。Docker 镜像、HTTPS 代理、多实例等未执行范围明确标记，不能由本地生产构建推断已验证部署。

## 11. Phase H — 受控性能与架构评价

在隔离环境做有限、可重复的观察，记录机器、数据量、并发数、持续时间和测量方式：

- 至少覆盖 45 根主题的多页加载，以及 100 根加载窗口和单根回复边界；记录请求数、payload、完成时间、DOM 规模、输入响应与错误。
- 两位 moderator 并发写 Topics 时同时发送 Chat，测量响应分布、锁等待、超时及是否影响 Polls／SSE。关注共享 StreamEvent 写锁的真实代价，不据代码结构臆测性能故障。
- 重复导航／断线／恢复后观察 socket、timer、请求速率和可获得的浏览器／API 内存；无法可靠测量的指标明确标记，不能用一次 heap 数值证明无泄漏。
- 检查持续写入导致多页快照重试时是否有界、是否最终可恢复。报告声明通知进程内发送、跨实例依赖轮询，以及总量 500 个 Chat+Topics socket 上限；不能把它解释成 500 名同时使用两个模块的用户或已实现多节点即时推送。

架构评价围绕授权边界、共享 Gateway 的模块隔离、事务锁顺序、幂等版本语义、受限快照模型、错误分类和测试质量。区分已复现缺陷、已确认设计限制、证据不足和可选优化；无证据不建议重大重写。本地测量不得宣称生产容量或未约定 SLA。

## 12. 缺陷分级、报告与验收门槛

生成正式报告：`docs/acceptance/opspilot-topics-integration-acceptance.md`。

报告必须包含：

1. 执行摘要与 `PASS / CONDITIONAL PASS / FAIL` 决定。
2. 基线、实际环境、审查范围、未提交变更及隔离措施。
3. 完整需求矩阵：ID、预期、实际、代码与运行证据、`PASS / FAIL / NOT VERIFIED / NOT IMPLEMENTED`。
4. 精确测试命令与结果，明确区分本轮证据、旧报告、mock、真实集成、失败和未执行项目。
5. 缺陷清单：严重性、稳定编号、可复现步骤、预期／实际、影响主体、证据路径、基线下文件行号、已证实根因或待确认假设、修复建议。建议不在本轮实施。
6. 数据库／并发、权限／隐私、故障恢复、前端一致性、性能与资源评价。
7. Chat、Polls、认证／准入、Live Operations、权限、媒体的独立回归状态。
8. 按优先级排序的修复与复验计划、环境阻塞、已知限制和最终准入决定。

严重性原则：

- **P0**：严重跨租户／私有数据泄漏、广泛认证绕过或重大不可恢复数据破坏。
- **P1**：主要业务不可用、可实际利用的权限绕过、持久一致性破坏、关键恢复永久卡死，或并发突破核心业务不变量。
- **P2**：局部功能／反馈／资源问题或非关键覆盖不足，未破坏核心安全与一致性保证。
- **P3**：轻微体验、可维护性或非必要优化。

按实际影响定级，不因测试名称自动判 P1。环境阻塞也不自动等于产品缺陷；但关键项未验证仍会阻止通过。

只有同时满足以下条件才能批准本阶段完成：

- 无未解决 P0／P1；员工与观众真实全流程、PostgreSQL 持久化与追加迁移安全已验证。
- 待审隐私、当前权限、撤销、跨事件／工作区隔离、ticket 安全均通过。
- 七条置顶、父子一致性、并发修改、幂等与丢响应恢复通过。
- 员工和观众分别通过真实断线与临时后端失败恢复，不需整页刷新解锁，旧数据不会重新出现。
- 关键分页／状态／资源清理、生产构建浏览器流程通过；Chat、Polls 及必要既有功能回归通过。
- 类型、lint、相关测试与生产构建通过，证据足以支持每个结论。

`CONDITIONAL PASS` 仅适用于核心门槛全部满足、剩余非关键 P2／P3 已明确记录的情况。关键安全、并发、恢复或回归存在未验证项时，结论为 `FAIL` 并说明缺少证据／环境阻塞；不得用条件通过掩盖关键风险。没有发现缺陷不等于完成验收。

**完成后仅交付验收报告、脱敏证据和修复建议。停止，不修复代码，不开始 Topics 之外的迁移。**
