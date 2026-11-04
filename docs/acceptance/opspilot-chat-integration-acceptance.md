# OpsPilot Chat 融合独立验收报告

日期：2026-10-28。审查基线：`cdd924236abc952e7a51e53663491208274dabf4`。

## 结论

**FAIL — 当前不满足 Chat 融合验收门槛。**

发现 **1 项 P1 可靠性缺陷、0 项已确认 P0**：重连订阅初始化中的临时数据库错误被误判为永久权限拒绝，服务恢复后 Chat 仍无法自动恢复。真实 PostgreSQL 行锁等待和生产构建的浏览器页面均已复现；不是仅凭代码推测。

权限隔离、员工／观众双向聊天、持久化、常规断线恢复及原有功能回归在本次执行的路径中通过。它们不能抵消上述重连失败。建议修复该 P1 并补充对应回归后再验收，不建议据此进入下一模块。

本轮只审查、运行测试并生成报告。**未修改应用源代码、schema、迁移、依赖、现有测试或配置，未修复缺陷，未迁移其他模块。** Git HEAD 保持原基线。新增内容仅为本报告和验收证据；临时审计脚本、构建产物和原始日志在忽略的 `.runtime/chat-acceptance/` 下。

证据：[结构化结果](opspilot-chat-evidence/results.json)、[真实数据库故障截图](opspilot-chat-evidence/transient-db-lock-error.png)。上轮迁移报告仅用于理解设计，本报告的通过结论来自本轮重新执行。

## 基线与验收环境

- 仓库：`/Users/ruzhan/computer_science/projects/OpsPilot`；分支 `feat/streamops-chat-integration`；开始时工作区干净。
- 检查范围：`apps/api/src/event-chat/`、前端 `features/chat/`、员工 Live Operations 与观众确认页面、现有认证／入场机制、共享契约、Chat migration、相关 Jest/Playwright 测试。
- 新建 PostgreSQL 数据库：`opspilot_chat_acceptance_test`，端口 5546；仅在这个新库应用迁移和 seed。
- 独立 Redis 分区：9；独立 MinIO bucket：`opspilot-chat-acceptance`。
- 复用本地测试 Mailpit，使用唯一测试收件人；未清空邮箱。未调用数据库 reset，未删除共享数据、既有上传或存储卷。
- macOS / Node 22.20.0 / PostgreSQL 17 / Redis 7.4.10 / 本地 Chrome。既有 E2E 使用开发服务器；补充探针使用 Nest 编译产物和 Next 生产构建。
- 固定端口测试期间，暂时停止了先前由本任务启动的开发服务；结束后已恢复到原 `opspilot_chat_test` 数据库，API 和 Web 均可访问。

## 需求矩阵

| ID | 验收点 | 实际结果与证据 | 结论 |
| --- | --- | --- | --- |
| AUTH-01 | 未认证者不能访问受保护 Chat | 原 API 套件直接请求拒绝；Chat 接口未依赖 UI 隐藏 | PASS |
| AUTH-02 | 当前员工角色决定读／发／撤回能力 | 独立探针用同一既有登录会话切换数据库五种角色，返回值与下表一致 | PASS |
| AUTH-03 | 工作区隔离 | 外工作区历史和 ticket 均为 403；原套件另有跨租户断言 | PASS |
| AUTH-04 | 观众只能进入已准入活动 | 活动 A 的观众读取活动 B 为 401；独立 A socket 未收到 B 的消息 | PASS |
| AUTH-05 | 身份来自服务器，不能伪造角色／发送人 | DTO 拒绝额外身份字段；消息作者由 session/membership/registration 推导；真实数据库约束测试通过 | PASS |
| AUTH-06 | 撤回权限和目标活动同时受保护 | 观众撤回 403；将 A 消息 ID 放在 B 的删除路由返回 404 | PASS |
| AUTH-07 | 已签发 JWT、已连接 socket 遵守权限撤销 | 原套件测试成员降级、移除、logout 和票据失效；补测在降级事务锁后排队的发送返回 403，入库 0 条 | PASS |
| AUTH-08 | 观众过期、撤销、活动关闭 | API／socket 和浏览器回归通过；撤销后私有内容消失、没有可用输入框 | PASS |
| AUTH-09 | ticket 一次性、过期和 Origin 检查 | 实际 Redis GETDEL、过期票据和错误 Origin 的 socket 测试通过 | PASS |
| CHAT-01 | 员工与观众独立浏览器双向聊天 | 补测员工→观众、观众→员工实际 UI 发送／接收；原 E2E 另验证真实邮件准入 | PASS |
| CHAT-02 | PostgreSQL 持久化、重载和历史分页 | 原 API／浏览器套件检查实际记录、reload、前后向分页、历史锚点 | PASS |
| CHAT-03 | 重试、ACK 丢失和重复事件不重复入库 | 原套件并发同 ID、冲突文本、丢失 ACK、浏览器消息重试、版本／墓碑检查通过 | PASS |
| CHAT-04 | 撤回不会被旧响应复活 | 原 reducer／API 测试通过；补测观众离线时撤回，重连后显示墓碑 | PASS |
| REC-01 | 常规断线补回遗漏事件 | 430 条原 E2E；补测离线时新增和撤回同时恢复 | PASS |
| REC-02 | 超过恢复预算时可恢复 | 独立补测 2,105 条遗漏事件：回到最新 30 条并显示明确刷新提示 | PASS |
| REC-03 | 临时后端错误后能重连 | 一次真实数据库锁等待导致 503，之后永久进入 denied，需整页刷新 | **FAIL / P1-01** |
| UI-01 | 旧消息阅读不受新消息打断 | 原浏览器套件验证历史加载锚点、新消息未读数和跳至最新 | PASS |
| UI-02 | 切换活动／身份隔离与清理 | 补测先获取 A 历史但延迟返回，导航 B 后释放旧响应，未显示 A 内容；原 E2E 覆盖双活动 cookie、双身份和退出 | PASS |
| UI-03 | 有界渲染和基础响应性 | 450 条 journal 突发后 DOM 300 行，输入框可用 | PASS（本地有限负载） |
| REG-01 | 既有登录、活动、入场、Live Operations、投票、权限、媒体相关路径 | 下方列明本轮重新执行的回归证据 | PASS（已执行范围） |
| BUILD-01 | 类型、lint、生产构建 | 本轮全部通过 | PASS |
| DEPLOY-01 | 真实托管 HTTPS／代理／多节点部署 | 本轮没有部署，也未重跑镜像 smoke；不能沿用旧报告作为新证据 | NOT VERIFIED |

### 员工角色实测

操作对象为同一 READY 活动；角色在 PostgreSQL 中修改，继续使用之前已登录的会话。

| 当前角色 | GET history | POST message | DELETE message |
| --- | --- | --- | --- |
| ADMIN | 200 | 201 | 200 |
| OPERATIONS_MANAGER | 200 | 201 | 200 |
| CONTENT_OPERATOR | 200 | 201 | 403 |
| ANALYST | 200 | 403 | 403 |
| VIEWER | 200 | 403 | 403 |

员工可读取其当前工作区内的活动，这符合已批准的领域契约；不存在额外的逐活动员工 ACL，不能将这项既定行为误报为越权。观众身份与员工身份分别处理，员工 cookie 不替代观众准入。

## P1-01：重连初始化的临时错误使 Chat 永久进入权限拒绝状态

**优先级：P1；状态：未修复。** 影响首次连接及重连初始化路径；本轮在有效观众重连时复现。没有发现该缺陷导致越权或丢失已提交消息，影响是持续不可用及错误的权限提示。

### 可重复步骤

1. 用真实认证完成观众准入，在浏览器中确认 Chat 为 Connected。
2. 关闭该浏览器的 Chat WebSocket，并暂时阻断新 ticket 请求，确认客户端进入断线状态。
3. 恢复 ticket 请求。在服务器已验证 ticket、即将读取初始化 history 时，用另一个 PostgreSQL 事务执行：

   ```sql
   BEGIN;
   SELECT "id" FROM "StreamEvent" WHERE "id" = '<本次验收活动 UUID>' FOR UPDATE;
   -- 本次隔离探针在持锁状态等待 6.5 秒。
   COMMIT;
   ```

4. 原 `ChatService.history()` 在同一活动上等待 SHARE 锁，超过默认交互事务时限，实际返回 503。审计包装器只安排持锁时机，调用原 history 实现；未替换数据库返回值、未修改应用文件。
5. 行锁释放后，确认同一观众的 `GET /public/events/:id/chat/context` 返回 200。
6. 等待 7 秒，超过正常 5 秒客户端恢复检查周期，页面仍为 Access unavailable；刷新 Chat 按钮和发送框均被禁用。
7. 整页 reload 后同一观众恢复 Connected。

本轮先用一次性服务异常注入定位分支，再用上述真实数据库锁等待确认；两次结果一致。数据库、会话和权限均在隔离环境，未向生产服务注入故障。

### 预期与实际

| 项目 | 预期 | 实际 |
| --- | --- | --- |
| 临时 503 | 保留可重试状态，重新取得 ticket 并恢复 | 进入永久 denied |
| 权限恢复／验证 | 当前权限有效时继续自动恢复 | context 200，但 UI 仍拒绝 |
| 手动恢复 | 至少能使用可用的重试入口 | Chat 刷新按钮禁用，只能整页刷新 |
| 文案 | 服务暂时不可用 | 同时出现“temporarily unavailable”和“session no longer has access” |

证据 JSON：`contextStatus=200`、`ui=Access unavailable`、`refreshDisabled=true`、`composerDisabled=true`、`reloadRecovers=true`。参见[截图](opspilot-chat-evidence/transient-db-lock-error.png)。

### 根因与涉及位置

- [`chat.service.ts`](../../apps/api/src/event-chat/chat.service.ts) 60–95 行：实际数据库事务异常被转换为 503，分类合理。
- [`chat.gateway.ts`](../../apps/api/src/event-chat/chat.gateway.ts) 99–135 行：`handleConnection` 捕获所有异常后统一发 `chat.denied` 并断开，没有区分认证失败与临时服务错误。
- [`use-chat.ts`](../../apps/web/src/features/chat/use-chat.ts) 330–332 行：收到 `chat.denied` 时忽略状态码，直接调用 `deny()`。
- 同文件 92–108 行：`denied=true`，清空私有状态并停止重试；后续 `connect()` 的 guard 不允许恢复。因此等待更长时间不能从当前挂载状态修复。
- [`chat-panel.tsx`](../../apps/web/src/features/chat/chat-panel.tsx) 213–217 行：刷新按钮在 `ready=false` 时禁用，缺少此错误下的可用恢复入口。

### 建议修复及复验门槛（本轮未执行）

1. 服务端仅将真正的权限／身份失败发为 denied；将 5xx、临时连接／查询故障保留为可重试错误。
2. 客户端根据错误类别处理，临时错误需重新取得一次性 ticket 后重连；仍需保留私有状态隔离，不能为了恢复而跳过重新授权。
3. 提供合理的手动重试入口，避免暂时故障陷入无法操作的终态。
4. 补充真实 socket + 浏览器回归：首次连接、重连初始化和正常 pump 三个阶段分别注入临时错误；断言无需 reload 即恢复，同时权限撤销仍不可恢复为可写。

## 本轮测试执行

服务型测试使用以下前缀，避免使用普通开发数据：

```sh
node scripts/with-chat-test-env.mjs node .runtime/chat-acceptance/env.mjs <command>
```

临时环境包装器仅覆盖 `DATABASE_URL` 为新验收库、Redis URL 为 `/9`、S3 bucket 为验收桶，其他配置沿用已有本地测试封装。它不属于应用改动。

| 实际命令（需要前缀的标明 A） | 本轮结果 |
| --- | --- |
| A `npm run db:deploy` | PASS，新库迁移成功 |
| A `npm run db:seed` | PASS，仅新建验收数据库，执行一次 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test --workspace=@opspilot/api -- --runInBand` | **91/91**，14 suites |
| `npm run test:chat:state` | **5/5** |
| A `npm run test:e2e --workspace=@opspilot/api -- --runInBand` | **40/40**，4 suites，26.856 秒 |
| A `npx playwright test --output=.runtime/chat-acceptance/browser-results` | **11/11**，2.0 分钟；真实后端与浏览器 |
| A `npx playwright test --config=playwright.ui.config.ts --output=.runtime/chat-acceptance/ui-results` | **12/12**，26.6 秒；mock UI 补充回归 |
| A `npm run build` | PASS，Nest 和 Next 生产构建 |
| A `node .runtime/chat-acceptance/probes.mjs` | **6 通过、1 失败**；失败为 P1-01 |
| A `node .runtime/chat-acceptance/probes-db-lock.mjs` | **1 失败**；真实 PostgreSQL 锁等待再次确认同一 P1，非另一个缺陷 |
| `npm audit --omit=dev --registry=https://registry.npmjs.org --json` | PASS，生产依赖发现数 0 |

补充探针以真实 REST、Socket.IO、Prisma/PostgreSQL 和独立 Chrome context 执行；故障 API 加载当前编译产物，只为指定验收活动安排一次故障。补测的观众身份经真实注册与 verify API 取得 cookie，但测试从隔离库解密验证 token，未在这组探针中再走邮件 UI；完整邮件 UI 已由原 E2E 本轮重新验证。

原始日志位于 `.runtime/chat-acceptance/{types,lint,unit,state,api,browser,ui,build,probes-rerun,probes-db-lock}.log`。保留的 JSON 仅包含结果、状态码和测试条件，不包含 cookie、ticket、验证 token 或密钥。

最初补测尝试使用浏览器 offline 仿真，但该模式未关闭已经建立的 WebSocket，只让 REST 失败，不能作为预期断线的证据。该轮结果作废，改为显式关闭真实 WebSocket 并阻断 ticket 传输后完整重跑；没有修改应用或降低验收断言。

## 原有功能回归

| 原有功能 | 本轮证据 | 状态 |
| --- | --- | --- |
| 员工登录／退出／刷新 | API 的 refresh rotation、logout cookie/session；真实浏览器登录 | PASS |
| Event 与 Launch Control | 创建、归属、准备度、生命周期至 Archive；归档不可变 | PASS |
| 注册与入场 | 普通注册、真实 SMTP／邮件确认、域名／邀请限制、撤销 | PASS |
| Live Operations | 工作区隔离、创建／关闭 operational session、管理界面 | PASS |
| SSE 与投票 | 管理员／分析员多端更新、观众投票、关闭投票、断流 REST fallback | PASS |
| 既有权限 | 分析员只读、跨工作区拒绝、相关 UI 控制；新 Chat 当前权限另有独立补测 | PASS |
| 既有媒体／集成 | attach/detach、租户检查、处理／签名单元、可靠性与 webhook 界面 | PASS（已有测试范围） |

没有本轮新增的完整上传→转码→播放实测，因此不将“媒体相关回归通过”扩大解释为整个媒体链路重新验收。没有启动 Mudu 的其他模块迁移。

## 架构与一致性评价

值得保留：单一 StreamEvent 范围、独立员工／观众 principal、当前数据库权限检查、一次性 socket ticket、持久 journal 与 ACK 游标分离、数据库 idempotency 约束、版本化墓碑、前端 keyed scope 和异步请求隔离。原有 SSE 与 Chat WebSocket 边界清晰，没有建立第二套登录或活动层级。

真实锁竞争补测显示：降级事务先持有 membership 锁，发送请求排队，降级提交后发送得到 403 且没有新增消息；说明权限不是只在建立 socket 时检查。另一方面，所有错误都转为 denied 的连接阶段与正常 pump 的临时错误处理不一致，正是本次故障根源。

事件行锁串行化提供简单、明确的顺序和授权语义，但也使锁等待成为必须正确恢复的现实故障边界。无需据此进行大规模重写，应先修复错误分类和恢复状态机。

## 性能观察与未验证范围

本轮原浏览器探针记录：430 条遗漏 journal 恢复 **1,477 ms**；450 条实时 journal 突发到最后消息可见 **3,920 ms**；DOM **300 行**。补测 2,105 条遗漏触发明确的最新快照降级，返回 **30 行**。

这些批量数据通过合法约束形状直接写入隔离数据库，浏览器通过真实 REST／WebSocket 恢复；计时包含插入、调度和浏览器断言。它们验证有界渲染和恢复路径，**不是消息发送 API 吞吐、生产承载量或长期内存测试**。

未验证：500 并发连接、多 API 实例、分布式限流、长期资源增长、托管 HTTPS／反向代理、实际生产部署，以及本轮新的容器重建／重启测试。上次迁移报告中的容器证据不计入本轮重新执行的通过项。

## 优先整改顺序和最终门槛

1. **先处理 P1-01**：临时初始化错误必须保持可恢复；保留认证和权限重新校验。
2. 增加失败初始化／重连的真实数据库和浏览器回归，覆盖员工与观众；再次验证权限撤销不会被重试绕过。
3. 重跑 Chat API／socket／浏览器套件及相关认证、准入、Live Operations／投票回归。
4. 独立复验无 P0/P1 后再决定进入后续融合模块。生产部署能力另设部署／负载门槛。

本报告交付后停止。当前 **FAIL** 不代表全部融合不可用：日常协作路径和隔离检查已经通过，但“临时后端故障后自动恢复”的关键保证尚不成立。
