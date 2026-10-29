# OpsPilot Topics / Q&A 融合独立验收报告

日期：2026-10-29（Europe/London）。审查基线：`a5bb2caf8041f9404cbdb6946ae42033f0417fb9`，分支 `feat/streamops-chat-integration`。

后续记录：用户授权修复后，P1-01 与 P2-01 的实现和复验见[修复报告](opspilot-topics-remediation.md)。本文件保留原审查基线的 FAIL 结论与原始证据。

## A. 执行摘要与决定

**FAIL — 当前不满足 Topics 融合验收门槛。**

本轮确认 **1 项 P1、1 项 P2，未发现已确认 P0**：

- **P1-01：成功提交的响应丢失后，重试遇到真实 HTTP 429，前端丢弃原 operation ID。限流结束再提交，同一次问题发表意图产生两条 PostgreSQL 记录。** 使用真实准入观众、生产前端、Nest 限流器和 PostgreSQL 完整复现。
- **P2-01：编辑主题时收到他人的回复，失效通知使主题卡片卸载，未保存的编辑草稿无提示丢失。** 开发报告已披露编辑器可能关闭，本轮独立确认其实际影响。

权限隔离、待审隐私、审核与配置、父子关系、并发七条置顶限制、通常的幂等重试、真实数据库故障恢复及原有功能回归在列明的执行范围中通过。通过项不能抵消 P1-01：本阶段要求端到端重试不重复，而数据库唯一键无法防止前端换一个新 ID 再次提交同一意图。

**本轮只审查、测试和记录，未修复缺陷。** 未修改应用源代码、schema、迁移、依赖、既有测试或运行配置，未开始其他模块。新增审计探针和临时配置均在被忽略的 `.runtime/topics-acceptance/`；持久交付为本报告及脱敏证据。

证据入口：[结构化结果](opspilot-topics-evidence/results.json)、[P1 失败断言](opspilot-topics-evidence/rate-limit-failure.txt)、[文件校验值](opspilot-topics-evidence/sha256.json)。开发阶段的测试声明未直接计为本轮通过证据。

## B. 基线、环境与安全边界

| 项目 | 本轮实际情况 |
| --- | --- |
| 目标仓库 | `/Users/ruzhan/computer_science/projects/OpsPilot` |
| HEAD／分支 | `a5bb2caf8041f9404cbdb6946ae42033f0417fb9`／`feat/streamops-chat-integration` |
| 开始时工作区 | 仅未跟踪的 `docs/acceptance/opspilot-topics-integration-acceptance-task.md`；无已跟踪应用文件差异 |
| 参考材料 | [批准任务](../integration/topics-integration-task.md)、[架构契约](../integration/topics-integration-plan.md)、[迁移报告](../integration/topics-migration-report.md)、[Chat 历史验收](opspilot-chat-integration-acceptance.md)与[修复记录](opspilot-chat-reconnection-remediation.md) |
| Mudu 源仓库 | HEAD `7bd9a2f36df8d0992260e1ba356754d6fce05f63`，只读；原有两项 streaming 未跟踪资料保持原状 |
| 系统／运行时 | macOS x64；Node 22.20.0；npm 10.9.3；Chrome 156.0.8078.48；Next 16.4.3；Prisma 6.19.3 |
| 主验收 PostgreSQL | 新建 `opspilot_topics_acceptance_20261029_test`，127.0.0.1:5546，PostgreSQL 17.11 |
| 升级夹具 PostgreSQL | 另建 `opspilot_topics_upgrade_20261029_test`；旧版迁移／seed 后追加当前 Topics 迁移 |
| Redis | 新建专用容器 `opspilot-topics-acceptance-redis-20261029`，127.0.0.1:6392，Redis 7.4.10；未清空共享 Redis |
| 存储 | 独立 bucket `opspilot-topics-acceptance-20261029`，MinIO 9002；实际 HeadBucket 200 |
| 邮件 | 既有本地 Mailpit 8025／SMTP 1026；仅读取唯一测试收件人的邮件，未清空邮箱 |
| 应用 | 隔离 Nest／worker 与 Next；关键 E2E 使用 Next standalone 生产构建。API 故障探针加载实际 Nest 编译产物 |

固定端口套件使用 3000／4100；只暂停了此前由本任务启动、已核对 PID 的开发 supervisor。验收结束恢复原本的普通开发服务和 `opspilot_chat_test` 配置。进程重启专项使用独立 4207 端口。

两个新库分别只 seed 一次；没有 reset 普通开发库、修改共享业务数据、删除用户上传或清空存储卷。API／browser 套件清理的仅是其创建的隔离夹具。专用审计 Redis 结束后停止，数据库和容器保留用于复现。

原始日志及 Playwright trace 留在忽略目录，trace 可能含认证网络信息，未复制进交付证据。公开证据不包含 cookie、JWT、一次性 ticket、验证 token 或真实密钥。未执行外部部署或收费服务调用。

## C. 需求矩阵

代码入口简称：后端 [TopicsService](../../apps/api/src/event-topics/topics.service.ts)、[Controller](../../apps/api/src/event-topics/topics.controller.ts)、[共享身份](../../apps/api/src/event-interactions/event-identity.service.ts)、[Gateway](../../apps/api/src/event-chat/chat.gateway.ts)；前端 [useTopics](../../apps/web/src/features/topics/use-topics.ts)、[state](../../apps/web/src/features/topics/state.ts)、[panel](../../apps/web/src/features/topics/topics-panel.tsx)。运行证据详见结构化结果中的 commands、independentProbes、browserObservations 和 realPostgresFaults。

| ID | 预期 | 实际行为及代码／运行证据 | 结论 |
| --- | --- | --- | --- |
| BASE-01 | 固定基线和独立证据 | 当前 HEAD、环境信息、实际命令及退出码记录；旧报告仅作参考 | PASS |
| DATA-01 | 追加迁移保留原数据 | 新库完整迁移；旧版夹具追加 Topics 后，38 张既有表记录数与内容摘要相同；数据库 CHECK/FK 的拒绝测试通过 | PASS |
| AUTH-01 | 当前员工权限生效 | shared identity 在事务中重读 session/membership；同一登录会话切换五角色的直接 REST 探针通过 | PASS |
| AUTH-02 | 观众必须有效准入 | 真实注册／邮件确认；未准入、过期、撤销及生命周期拒绝；员工 cookie 不替代观众准入 | PASS |
| AUTH-03 | workspace/event/父子隔离 | 外 workspace 403、观众跨 event 401、错误 event 下操作 root 404；API 套件验证同 event FK | PASS |
| AUTH-04 | pending 正文、计数、回复、通知私有 | 非作者看到 pending=0；私有 notice 只达作者／moderator；重新送审移除公开父子投影；延迟旧私有快照在降级后未复活 | PASS |
| AUTH-05 | 撤权影响既有 token/socket | 原会话降级后写入 403；排队在权限锁之后的请求入库 0；观众过期后读 401、UI 清空；本地撤权展示延迟 0.80–2.83 秒 | PASS |
| TOP-01 | 提交、审核、过滤、分页、持久化 | 真实四主体浏览器流程；API canonical IDs；reload；更换整个 API 进程后原会话读到原主题和回复 | PASS |
| TOP-02 | 编辑送审与父子一致性 | service 事务／版本检查；编辑后公开读者失去正文与回复；parent/reply race 和父子 redaction 测试通过 | PASS |
| TOP-03 | 七条置顶、approved 前置、先 unpin | event 锁＋pin CHECK/unique；两位不同 moderator 的八路屏障并发最终 7 成功／1 冲突；既有测试覆盖最后一个槽 | PASS |
| TOP-04 | 三项设置约束后端 | configure/create race、前端开关与直接 API 拒绝通过；关闭 review 不发布已有 pending | PASS |
| TOP-05 | 生命周期、版本与输入检查 | DRAFT/CONFIGURING/READY/LIVE/COMPLETED/ARCHIVED/CANCELLED 实测；409、空白、超长、未知身份字段等拒绝；脚本文本正常显示 | PASS |
| CON-01 | 并发操作维持不变量 | distinct moderator 冲突、八路 pin、approve、edit/approve、reply/delete、settings/create、SQL 回滚检查通过 | PASS |
| CON-02 | 丢响应后的整个重试链只创建一次 | 相同 ID 的服务端幂等及普通网络重试通过；**丢响应→429→重试**在 UI 生成新 ID，实测 2 条记录 | **FAIL / P1-01** |
| RT-01 | 正确订阅及公开／私有通知 | 同一 `/chat` Gateway、channel 绑定 ticket；独立员工／观众及私有通知 API/WS 集成通过 | PASS |
| RT-02 | 重复、乱序、漏通知可恢复 | 真实帧重复／旧帧重放；丢掉全部目标通知后 1.38–2.88 秒由 REST 修复；私有 sequence 空隙不当作公开日志缺口 | PASS |
| REC-01 | 员工临时故障恢复 | 首次 ticket/订阅/snapshot、重连订阅、已连接 snapshot/idle：真实 PG 锁超时后无需 reload 恢复；有效主体遇到坏／过期 ticket 重新认证 | PASS |
| REC-02 | 观众临时故障恢复 | 对同样阶段执行真实 PG 故障与 Redis ticket 过期，恢复后可发表且只入库一次；真正撤销仍拒绝 | PASS |
| STATE-01 | 分页、旧响应与 moderation 一致 | 40 根加载窗口中三次页间提交后收敛为 40 个唯一实体／48 总数；延迟 delete 快照、ACK 和重复通知测试通过 | PASS |
| STATE-02 | 切换隔离与 cleanup | 活动切换旧私有响应丢弃；角色降级旧快照不显示；五轮 filter 切换保持 1 Topics＋1 Chat，卸载后均为 0，6 秒无残留 Topics 请求 | PASS（已执行切换范围） |
| UI-01 | 端到端可用并保留未提交意图 | 正常流程与窄屏通过；429 后意图 ID 丢失；远端回复会抹掉未保存编辑草稿 | **FAIL / P1-01、P2-01** |
| REG-01 | Chat 不回归 | 原实时、分页锚点／未读、撤回及 reload；12 项恢复 E2E；40 路混合写入实测通过 | PASS |
| REG-02 | Polls/SSE/Live Operations 不回归 | 主浏览器、真实 API 与补充 UI 套件通过；未替换 Polls 或 SSE | PASS（套件范围） |
| REG-03 | 认证、入场、事件、权限、既有媒体 | 原 API 5 suites、主浏览器和 UI 套件重新执行；媒体结论限于已有测试覆盖 | PASS（套件范围） |
| BUILD-01 | 类型、lint、生产构建和关键验收 | 类型／lint／Nest/Next 构建通过；原关键 E2E 通过，但新增关键幂等验收失败 | **FAIL：关键验收不全通过** |
| PERF-01 | 有界本地负载与资源可观察 | 105 根夹具取最新 100，100 回复展开；混合写入、DOM/heap/socket 数据见下文 | PASS（有限本地观察） |
| EXT-01 | 生产部署、多副本和容量 | 未做 HTTPS/代理、容器部署、多副本或生产规模试验；未据本地测试推断 | NOT VERIFIED（本轮部署范围之外） |

## D. P1-01 — 429 使不确定提交失去原幂等标识

**严重性：P1；状态：未修复；阻止本阶段通过。** 已复现于准入观众创建主题。根主题和回复共用 Composer，因此回复有相同代码风险，但本轮未单独跑完整的“回复丢响应→429→等待→再发”场景。

### 复现步骤（真实限流，非模拟成功／429 响应）

1. 启动本轮隔离 API 和生产前端，观众完成真实邮件准入，进入 READY 活动。
2. 从同一请求来源发出 29 次合法预备创建请求，均返回 201。当前 Controller 的创建限额为每 60 秒 30 次。
3. 在 UI 输入一个新的问题，发送第 30 次创建。Playwright 先用 `route.fetch()` 让真实后端完成请求并确认 201，然后仅丢弃发回浏览器的响应。PostgreSQL 已有该问题 1 条。
4. UI 显示 **Retry question**。点击，客户端确实复用第一次的 operation ID；真实 Nest 限流器返回 429，`Retry-After: 60`。
5. UI 随即丢弃 operation，将按钮变回 **Submit question**；文本仍保留。用户没有编辑文本，也没有点击 **Discard retry**。
6. 按实际 Retry-After 等待 61 秒，再按界面提供的提交按钮继续原意图。
7. 请求生成新 operation ID，后端返回 201；直接查询 PostgreSQL，同一作者、同一活动、相同问题正文共有 **2 条**。

本轮证据：`retryRetained=0`、`operationIdPreserved=false`、`confirmedRows=2`、共 3 次 UI 提交请求。最后的测试保留了“ID 必须相同”的失败断言，没有降低断言或修改产品使其通过。

| 检查点 | 预期 | 实际 |
| --- | --- | --- |
| 首次响应丢失 | 原意图状态为不确定，保留 ID | 正确保留 |
| 重试 429 | 暂时不可执行；不能据此断言首次未提交 | 清除原 operation |
| 限流解除后重试 | 复用原 ID，返回已有 canonical topic | 新 UUID，新增第二条 topic |
| 数据库唯一键 | 同一逻辑操作最多一条 | 对相同 ID 有效，但新 ID 绕过了同一意图的约束 |

证据：[失败断言](opspilot-topics-evidence/rate-limit-failure.txt)、[出现两个相同问题的页面](opspilot-topics-evidence/duplicate-after-rate-limit.png)、结构化结果中 `lost-receipt-rate-limit-*`。

### 已确认根因

- [topics-panel.tsx](../../apps/web/src/features/topics/topics-panel.tsx) 62–65 行：只有 `operation` 存在时才复用 ID，否则生成新 UUID。
- 同文件 74–80 行：只有网络异常或 HTTP ≥500 被判为 uncertain；所有其他 ApiError（含 429）执行 `setOperation(null)`。这是把“这次重试被拒绝”错误地当成“此前操作未成功”。
- [topics.controller.ts](../../apps/api/src/event-topics/topics.controller.ts) 创建入口的 30/60s 限流触发在服务层幂等处理之前。此次 429 没有告诉客户端首次创建的真实结果。
- [topics.service.ts](../../apps/api/src/event-topics/topics.service.ts) 的 `(eventId, authorKey, clientOperationId)` 查重正常；缺陷是客户端改变 ID，不是数据库唯一键失效。

### 建议修复与复验（本轮不实施）

保留已经进入“不确定交付”状态的操作标识，尤其是后续遇到 429 等可重试拒绝时；尊重 Retry-After 并保留明确的重试入口。只有确认 canonical 结果、确认未执行，或用户明确放弃该意图时才能清除其标识。继续执行当前权限检查，不应为解决重试问题绕过授权或限流。

复验必须覆盖员工和观众、主题和回复：真实成功提交丢响应，再遭真实 429，限流解除后重试；断言全链路 ID 不变、记录恰好一条、UI 最终确认成功。另覆盖权限／配置变化后的不确定操作，区分“本次拒绝”与“原操作未提交”。

## E. P2-01 — 远端回复使编辑草稿丢失

**严重性：P2；状态：未修复；开发报告已有披露，本轮独立复现。** 不会覆盖已保存正文或造成权限泄漏，但用户未保存输入被无提示丢弃。

步骤：员工 A 编辑一个 approved、未置顶主题，输入新正文而不保存；不同员工 B 在同一主题发表回复。A 收到 `topics.changed` 后编辑器消失，重新显示原正文和新回复；草稿不在页面中，也没有恢复入口。

证据：[回复前的编辑草稿](opspilot-topics-evidence/editor-before.png)、[回复后草稿消失](opspilot-topics-evidence/editor-after.png)。本轮复现两次，均为 `editorRemoved=true`、`draftStillInPage=0`。

根因：`use-topics.ts` 264–276 行接收失效通知后从 canonical map 暂时移除 root；`state.ts` 的 invalidateTopic 有意避免展示可能已变私有的正文；`topics-panel.tsx` 231–234 行将编辑草稿放在会被卸载的 TopicCard 内。重新挂载不能恢复这份局部 state。当前提升到 TopicsScope 的仅是创建／回复草稿。

建议：在经过验证的 actor/event 作用域中保留编辑草稿与起始版本，重新确认可见性后提示冲突／恢复；真正失去权限时继续隐藏对应正文和编辑界面。不要为了保留输入而取消隐私失效机制。补测“编辑中收到回复／审批／删除／权限变化”，分别定义保留、冲突提示和清除语义。

## F. 实际测试执行
所有下表命令都经本轮审计启动器运行，实际形式是：

```sh
node .runtime/topics-acceptance/run.mjs LABEL COMMAND [ARGS...]
```

该启动器记录日志和退出码，调用以下前缀，在已有测试包装器之后覆盖隔离数据库、Redis 与 bucket：

```sh
node scripts/with-chat-test-env.mjs node .runtime/topics-acceptance/env.mjs COMMAND [ARGS...]
```

不能去掉覆盖层直接使用普通 `with-chat-test-env.mjs`，它会选择普通本地测试／开发资源。临时脚本保留在本机忽略目录；源码和既有套件未改。完整命令历史含初次夹具失败、耗时和日志位置，见 results.json 的 commands。

### 主套件

| LABEL | 实际 COMMAND | 本轮结果 |
| --- | --- | --- |
| migrations | `npm run db:deploy` | PASS，主验收新库完整迁移 |
| seed | `npm run db:seed` | PASS，仅主验收新库一次 |
| typecheck | `npm run typecheck` | PASS，API／Web，12.10 秒 |
| lint | `npm run lint` | PASS，23.81 秒 |
| unit | `npm test -- --runInBand` | **94 tests / 15 suites passed**，4.55 秒（启动器总时长） |
| state | `node --import tsx --test tests/chat-state.test.ts tests/topics-state.test.ts` | **10 passed** |
| api | `npm run test:e2e --workspace=@opspilot/api -- --runInBand` | **60 tests / 5 suites passed**；Jest 39.54 秒 |
| build | `npm run build` | PASS，Nest＋Next 优化生产构建，18.49 秒 |
| browser | `env E2E_PRODUCTION_WEB=1 npm run test:ui -- --output=.runtime/topics-acceptance/regression-browser-results` | **16 passed**；生产前端、真实 API／worker，2.6 分钟 |
| chat-recovery | `env CHAT_RECOVERY_PRODUCTION_WEB=1 npm run test:chat:recovery -- --output=.runtime/topics-acceptance/chat-recovery-results` | **12 passed**；含真实 PG 超时，1.5 分钟 |
| ui-isolated | `npm run test:ui:isolated -- --output=.runtime/topics-acceptance/ui-isolated-results` | **12 passed**；HTTP mock UI 夹具，30.5 秒，不能替代真实集成证据 |

### 独立补充探针

| LABEL | 实际 COMMAND | 本轮结果 |
| --- | --- | --- |
| probes-corrected | `env NODE_ENV=test node .runtime/topics-acceptance/probes.cjs` | **9/9 完成且通过**：角色、生命周期、隐私、八路 pin、moderation retry、100 回复边界、撤权锁顺序、ticket 安全、Chat 混合写入 |
| topics-fault-browser-configured | `npx playwright test --config=.runtime/topics-acceptance/playwright.config.ts` | 当时 4 项用例，**4 passed**：员工／观众真实 PG 故障各四个阶段，另含无效 ticket、丢通知和撤权 |
| topics-extra-browser | `npx playwright test --config=.runtime/topics-acceptance/playwright.config.ts --grep 'expired ticket\|bounded history'` | 真实 Redis TTL 过期的员工／观众 **2 passed**；资源探针首次因审计计数器错误失败，见下文 |
| topics-resource-browser | `npx playwright test --config=.runtime/topics-acceptance/playwright.config.ts --grep 'bounded history'` | **1 观察探针完成**：100 根／100 回复、真实 pin 丢响应、cleanup，且复现 **P2-01**；不代表编辑草稿保留通过 |
| topics-initial-http-browser | `npx playwright test --config=.runtime/topics-acceptance/playwright.config.ts --grep 'initial HTTP'` | **4 passed**：员工／观众各自首次 ticket 和首次 snapshot 的真实 PG 超时 |
| topics-stale-authority-browser | `npx playwright test --config=.runtime/topics-acceptance/playwright.config.ts --grep 'delayed private snapshot'` | **1 passed**：旧私有快照在降级后不复活，页间三次真实提交后收敛 |
| topics-rate-limit-browser | `npx playwright test --config=.runtime/topics-acceptance/playwright.config.ts --grep 'lost completion followed'` | **1 failed：P1-01**；真实限流后新 ID，PostgreSQL 2 条记录；77.64 秒 |
| restart | `env NODE_ENV=test node .runtime/topics-acceptance/restart.cjs` | PASS，更换真实 API 进程后同一会话读取到 1 根主题＋1 回复 |
| environment | `node .runtime/topics-acceptance/environment.mjs` | PASS，核实数据库版本／名称、专用 Redis、存储可用性、浏览器版本 |

较早运行的临时 Playwright 文件随后增加了用例；报告按各次实际测试发现数记录，不将早期 4 项通过说成最终整个临时文件通过。失败的 P1 用例保留原断言。

升级专项也通过启动器执行以下命令，各阶段结果均已记录：

```sh
node .runtime/topics-acceptance/upgrade-env.mjs npx prisma migrate deploy --config .runtime/topics-acceptance/upgrade/prisma.config.ts
node .runtime/topics-acceptance/upgrade-env.mjs npx prisma generate --config .runtime/topics-acceptance/upgrade/prisma.config.ts
node .runtime/topics-acceptance/upgrade-env.mjs npx tsx .runtime/topics-acceptance/upgrade/seed.ts
node .runtime/topics-acceptance/upgrade-env.mjs node .runtime/topics-acceptance/upgrade/add-chat.cjs
node .runtime/topics-acceptance/upgrade-env.mjs node .runtime/topics-acceptance/preserve.mjs .runtime/topics-acceptance/upgrade-before.json
node .runtime/topics-acceptance/upgrade-env.mjs npm run db:deploy
node .runtime/topics-acceptance/upgrade-env.mjs node .runtime/topics-acceptance/preserve.mjs .runtime/topics-acceptance/upgrade-after.json
```

前四步使用从 `b09f5a2` 读取的旧 schema／seed、旧迁移副本及独立生成的 Prisma client，全部位于忽略目录；当前仓库迁移没有改变。最后追加当前 Topics 迁移。保留的原数据包括 5 个 Event、1 个 Chat message＋journal、1 个 registration、2 个 Poll、3 个 MediaAsset、3 个 membership；38 张表摘要一致。比较 StreamEvent 时排除新增五个 Topics 字段。

### 初次审计夹具错误及纠正

以下不属于产品修复；初次输出保留，既有套件与其断言没有改变：

1. 独立生命周期探针最初把无准入资格的观众读预期为 403；既有 `AttendeeAccessService.authenticate()` 在 REST 入口统一返回 401。错误断言使事件停留 DRAFT，后续依赖步骤连带失败。依据原有身份契约纠正探针的精确状态码，创建新的夹具整组重跑，9/9 通过；拒绝访问的要求没有放宽。
2. 临时 Playwright 配置文件位于 `.runtime/`，webServer 默认 cwd 导致路径重复，第一次 API 没启动。明确设为仓库 cwd 后运行。真实故障用例从开始就按 6.5 秒锁等待设计 20 秒恢复观察窗，不通过无限延长等待掩盖卡死。
3. 旧库 Chat fixture 的嵌套 Prisma create 多传了由父关系继承的 eventId，第一次在输入校验阶段失败。只修正临时 fixture，然后成功插入并比对升级摘要；未修改 schema／迁移。
4. 资源探针的转发 socket 关闭回调可在最终导航时再次触发，计数器错误下降到 -10。改为每连接只扣减一次，并增加读取真实 Gateway client map 的独立核对：卸载后当前 actor 的 Topics／Chat client 都为 0，且 6 秒无轮询。初次错误与重新测量均保留。

上述夹具问题与 **P1-01 的真实产品失败严格分开**。P1 没有通过修改测试或产品消除。

## G. 数据、授权和恢复结论

### 数据库与事务

StreamEvent 是唯一事件域；新增 EventTopic／EventTopicReply，没有 Room、平行 User 或 Workspace。staff／attendee 的 author shape、同 event 外键、操作唯一键、正文／墓碑、pinSlot 范围与唯一性在真实 PostgreSQL 验证。

写入先锁 StreamEvent FOR UPDATE，再验证并锁定当前 session／membership／准入权限；读与通知使用 event SHARE 锁。版本、root、reply 和设置在事务中提交。真实 SQL 约束失败测试验证没有部分 revision／root 写入。两位不同 moderator 在锁屏障后八路争抢，7 次成功、1 次冲突。

父主题删除后所有存活回复 redaction；累计 100 回复后第 101 条拒绝，删除一条后仍拒绝新回复，符合当前定义的“累计创建”限制。这是服务事务规则，不是针对管理员任意 SQL 的 trigger 保证。

数据库同 ID 幂等正常；P1-01 是浏览器失去原意图标识，使两条各自满足数据库约束的记录被创建。持久化、FK 和数据升级通过不能替代这项端到端保证。

### 安全与私有数据

同一个既有 JWT 登录会话更改角色后，服务读取当前 membership。ADMIN／OPERATIONS_MANAGER 可以审核／配置；CONTENT_OPERATOR 可发但需要 review；ANALYST／VIEWER 只读。观众身份仍为已验证 registration/session，不是 WorkspaceMembership。

在持有成员撤权写锁时排队的创建最终 403，入库 0。批准的“已持授权锁操作可先于撤权提交完成”语义被保留；不要求召回撤权前已经交付的字节。

直接 API、WebSocket 原生客户端和浏览器均检查隔离；一次性 ticket 重放 401、错误 Origin 403、Topics ticket 发 `chat.send` 入库 0。浏览器同时测试非法 ticket 与专用 Redis 中真实过期的票据；TTL 为确定性试验缩短到 1 秒，等待键实际消失，未绕过 consume 校验。

已公开 root 编辑回 pending 后仅发无正文的失效提示。权限降级发生在私有 HTTP 快照取回但尚未交给 UI 期间，旧快照释放后页面仍为 0 私有卡片／30 公开卡片，Pending(0)。未发现此次执行范围中的跨 event/workspace 越权或待审正文泄漏。

### 故障恢复

共执行 **12 次真实 PostgreSQL 锁超时注入**：员工与观众各自覆盖首次 ticket、首次订阅、首次 snapshot、重连订阅、已连接 snapshot、idle 授权检查。探针只在内存中包装真实服务方法安排锁时机；另一真实事务持 StreamEvent 排他锁 6.5 秒，原实现发生超时并返回 503，未用 mock 503 代替此证据。

| 阶段 | 员工 | 观众 |
| --- | --- | --- |
| 首次 ticket 故障至可发送（含登录／准入） | 9.21 秒 | 11.33 秒 |
| 首次订阅故障至可用（含登录／准入） | 8.91 秒 | 13.08 秒 |
| 首次 snapshot 故障至可发送（含登录／准入） | 8.86 秒 | 9.45 秒 |
| 重连订阅，从触发断线至验证恢复 | 9.54 秒 | 9.51 秒 |
| 已连接 snapshot 故障 | 7.26 秒 | 8.54 秒 |
| idle 授权检查故障 | 9.50 秒 | 9.01 秒 |

以上时间包含约 6.5 秒故障，不是健康请求时延或生产 SLA。所有用例在原页面恢复，context 200，输入可用，后续提交持久化；未复现历史 Chat 的永久 denied。正常撤权依然 fail closed。

普通漏通知由周期 REST 修复；有效主体不会因一次 ticket 拒绝永久失去访问。该恢复结论不涵盖 P1-01 的应用重试意图丢失，后者是独立失败项。

## H. 性能、资源与架构评估

均为本机有限观察，无生产容量承诺：

| 工作负载 | 实测结果 |
| --- | --- |
| 45 根 Topics、加载额外两页 | 330 ms；原生产浏览器套件记录 |
| 105 根数据库夹具，UI 加载到 100 根；其中一根有 100 条接近长度上限的回复 | 专项流程约 1.33 秒，包含加载／展开和一次采样；20 根首个快照 252,917 bytes；100 条回复可展开 |
| 上述页面输入框填入文本 | Playwright 操作约 85 ms；仅一次本地操作，不等于输入延迟分位数 |
| 两位 moderator 的 20 个 Topics 写＋20 个 Chat 写同时发起 | 40/40 提交；总约 990 ms；Topics p50 659／p95 987 ms，Chat p50 614／p95 968 ms；event.updatedAt 未改变 |
| Chat 430 条漏事件恢复 | 1,478 ms；真实 REST／WS 读取已提交 journal |
| Chat 450 条实时突发 | 3,835 ms；DOM 保持 300 行 |
| 100 根加载窗口 | 全页面 1,462 DOM 元素，强制 GC 后 JS heap 约 10.40 MB |
| 五轮 All/Approved 切换 | 回到 20 根窗口后 DOM 各轮 508；heap 约 10.02–10.23 MB；始终 1 Topics＋1 Chat 连接 |
| 离开页面 | 当前 actor 的两类 Gateway client 都为 0；6 秒无 Topics 请求；DOM 133，GC 后 heap 约 3.12 MB |

最后一次 API RSS 快照约 193 MB，不足以证明长期内存稳定。浏览器 heap 使用 CDP 强制 GC 后采样；有限循环未显示无界 socket／轮询增长，不能据此断言不存在其他泄漏。大量历史夹具由 Prisma 生成，仅用于读取／渲染负载，不作为用户创建工作流的证明；真实创建持久化另由 API/UI 用例验证。

架构优点：复用原身份、event 和 Gateway；Topics REST mutation 与 content-free WS invalidation 边界清楚；event 事务锁、版本、幂等键、可见性检查易于追踪；周期 snapshot 修复提交与通知之间的空隙；模块各自拥有 socket，清理没有破坏 Chat；Polls/SSE 保持原模式。

代价与限制：所有 Topics 写和 Chat 共用 event 锁，较高并发会排队，本轮 40 路观察通过但不能推断更大负载。每次刷新可能重取整个已加载窗口及回复；100 根 UI 上限、单根累计 100 回复是明确限制，旧的第 101 根仍能通过 REST 游标读取但 UI 本次仅显示最新 100。没有跨页无限历史浏览承诺。

实时通知进程内发送，跨副本主要靠轮询收敛；本轮未部署多副本。500 是 Gateway 中 Chat＋Topics 连接总量限制声明，不是 500 位同时打开两个模块的用户容量证据。未做 100 根各 100 回复的组合最大负载、长期 soak 或容量上限压测。

未发现需要重大重写的证据。P1 优先修正不确定操作的生命周期；P2 保留草稿时继续遵守失效与权限边界，不需要替换认证或实时设施。

## I. 原有功能回归

| 模块 | 本轮证据 | 结论 |
| --- | --- | --- |
| Chat | 真正员工／观众互聊、持久化、撤回、reload、430 漏事件／450 突发、历史锚点／未读；12 项恢复；Topics 混合写 | PASS（已执行路径） |
| Polls | manager／analyst 多端、观众投票、关闭结果、只读与权限；真实 API、主浏览器及 mock UI 补充 | PASS |
| SSE／Live Operations | 既有快照／断流 fallback 套件、运营 session 与 launch-readiness golden flow | PASS（各套件对应的真实／mock 层次） |
| Staff Auth | 登录、refresh rotation、logout/session，旧 JWT 当前权限复核，UI 只读 | PASS |
| Attendee Admission | 真实 SMTP／邮件验证、普通注册、域名／邀请限制、并发撤销、session 失效 | PASS |
| Workspace／Event | 跨租户拒绝、事件管理、生命周期及 archived 不可变 | PASS |
| 既有 Media／集成 | 现有 attach/detach、租户、处理／签名逻辑和 reliability/webhook 界面相关 API／单元／UI 回归 | PASS（已有覆盖）；未重新执行完整视频上传／播放验收 |

Topics 的 P1 不应描述为上述既有回归全部失败；同样，原有模块通过也不能让 Topics 忽略自身失败项。

## J. 优先修复计划、未验证范围与最终门槛

1. **先修 P1-01**：保留不确定操作 ID，处理 429／Retry-After，补齐员工／观众的主题和回复链路故障测试。完成后运行服务端幂等、Topics 浏览器、权限与 Chat/Polls 相关回归。
2. **再处理 P2-01**：提升编辑草稿所有权，加入当前权限／版本校验与明确恢复提示；验证通知、删除、重新送审和权限变化各自的清理语义。
3. 将本轮真实 Topics 数据库故障和迟到私有快照探针整理为稳定的常规自动化；本次它们位于审计目录，没有擅自加入应用测试目录。

未执行：HTTPS／反向代理／容器部署 smoke、多节点即时推送、生产规模容量、长时间内存 soak、最大 roots×replies 组合负载、完整媒体上传播放。并发操作用例和各种状态切换是列明的有限组合，不宣称穷尽所有交错顺序。它们不替代未来部署验收。

**最终决定：FAIL。** 已复现的 P1 违反稳定请求标识与不重复创建的核心验收条件；在修复并通过针对性复验前，不批准本次 Topics 融合完成。P2 另列为中等体验缺陷。审查基线保留为 `a5bb2ca`，没有生成修复提交或开始下一个模块。
