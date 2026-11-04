# OpsPilot 全系统独立验收：缺陷登记

日期：2026-11-03（Europe/London）。审核实现：`516f2a31242c615ab6858dc6472438aa38f13e00`，原分支 `feat/streamops-chat-integration`。

本文件只登记问题，没有实施修复。证据来自本轮独立隔离环境，非历史报告的通过结论。证据目录：`opspilot-final-system-evidence/`。

## 总览

| ID | 等级 | 模块 | 问题 | 状态 |
| --- | --- | --- | --- | --- |
| SYS-AUTH-01 | P1 | 原有 REST / 统一权限 | 降权、移除成员或登出后，旧 access cookie 仍能访问原有接口 | 运行复现，未修复 |
| SYS-AUTH-02 | P1 | Live Operations SSE | 已连接 SSE 不重新验证权限，撤权后继续泄露新数据 | 运行复现，未修复 |
| SYS-AUTH-03 | P2 | Authentication | 同一秒内 refresh rotation 可能产生相同 token，旧值仍可重放 | 运行复现，未修复 |
| SYS-BCAST-01 | P2 | Broadcast UI | 刷新未完成时允许用旧 revision 重试结束，产生额外 409 | 原测试失败＋可控延迟复现，未修复 |
| SYS-CI-01 | P2 | CI / 测试可复现性 | CI 在 build 前运行依赖 `dist` 的真实进程测试 | 冷构建顺序复现，未修复 |
| SYS-OPS-01 | P2 | Readiness / Redis | readiness 依赖检查没有 deadline，Redis 暂停时请求不及时返回 | 6 秒有界观测复现，未修复 |
| SYS-DEP-01 | P2 | 开发依赖 | 完整依赖审计报告 36 moderate、4 low；生产依赖审计为 0 | 工具报告确认，未修复；未证明应用可被利用 |
| SYS-DOC-01 | P3 | 架构 / 威胁模型文档 | 主架构和威胁模型仍停留 v1.2，与现有身份和媒体契约不符 | 源码对照确认，未修复 |

合计：**P0 0、P1 2、P2 5、P3 1**。依赖审计的 40 个包节点不是 40 个独立应用缺陷；作为一项维护问题登记。NOT VERIFIED 的生产部署/跨浏览器范围单列于主报告，不伪装成已复现缺陷。

## SYS-AUTH-01 — 原有 REST 继续信任旧 JWT 权限

**等级：P1。** 涉及工作空间数据访问和实际写操作，不能由前端隐藏按钮缓解。

复现：

1. 在独立 PostgreSQL 中创建自有 workspace、OPERATIONS_MANAGER、ADMIN 和 LIVE event；使用真实密码登录，保留 cookie。
2. 在隔离夹具中把 manager 的当前 WorkspaceMembership 降为 VIEWER。
3. 使用原 cookie 直接 PATCH `/api/v1/stream-events/:id`，POST `/:id/live-polls`，POST `/:id/live-session/updates`。
4. 删除该用户的 membership，再 GET `/workspaces/current`、`/stream-events`、`/stream-events/:id/live-session`。
5. 正常 POST `/auth/logout` 后重放保留的 access cookie。

期望：未来受保护操作按当前 membership、role、Session.revokedAt/expiry 判断；降权拒绝管理操作，移除成员/登出后拒绝原有私有资源。

实际：步骤 3 分别返回 **200、201、201**；步骤 4 三项均 **200**；登出 **204** 后旧 cookie 读取 workspace 仍 **200**。同一用户重新登录为 VIEWER 后，修改 event 正确返回 **403**。这证明旧 role claim 是差异来源，不是 VIEWER 被产品允许编辑。

对照：移除成员后 Chat、Topics、Broadcast、Media 均 **403**；登出后 Media **401**、refresh **401**。现有高级模块采用了较严格的边界，但没有形成全应用统一保证。

根因：`AuthGuard` 只验 JWT 签名/过期时间，把 payload 直接写入 request.user；`RolesGuard` 直接读取 user.role。原有服务通常按 JWT 的 workspaceId 查询，未再验证 Session/membership。旧 access token 的正常有效期为 15 分钟；此问题并不允许凭空伪造未签名身份。

证据：`security-results.json`、`probes/audit-security.cjs`。24 项安全观测中的相关失败有原始 HTTP 状态。角色/成员变更通过明确标记的 DB 夹具完成；没有虚构本产品不存在的权限管理 UI。

受影响文件：`apps/api/src/auth/auth.guard.ts`、`auth.service.ts`、`common/guards/roles.guard.ts`、`events/events.service.ts`、`live-polls/live-polls.service.ts`、`live-sessions/live-sessions.service.ts`。其它依赖同一全局 guard 的原有管理 API 应一并排查；本轮并未声称逐个复现了所有路径。

历史归属：与融合前 `0e005c193769d67a945e98229a1f2707163d8f52` 对比，上述 auth guard/service、roles guard、live-session service 没有融合改动。是本轮发现的原有缺陷和集成遗漏，不能错误归因为 Media/Chat 新代码引入。

建议：在现有身份体系中统一读取当前 Session 和 membership，派生当前 role/workspace，保留各业务能力检查及必要事务锁；不要建立第二套登录/RBAC。回归矩阵需覆盖 event、policy、content、runbook、invitations、registrations、Polls、Live Operations、analytics、integrations 等原有边界，以及所有集成模块。

## SYS-AUTH-02 — SSE 在权限撤销后仍发送新内容

**等级：P1。** 与 AUTH-01 有共同背景，但只修复建立连接时的 REST guard 不能关闭已存在的流。

复现：

1. 合法员工打开 `/api/v1/stream-events/:id/live-session/stream`。
2. 删除其 workspace membership。
3. 另一个仍有权限的管理员通过实际 POST 接口写入一个此前不存在的随机 operational update。
4. 保留原 SSE，等待超过其 3 秒轮询周期。

期望：不再发送撤权之后的新私有内容，连接终止或明确要求重新认证。

实际：原 SSE 收到新 marker。另用相同真实管理员身份、测试签发的 2 秒 access JWT 建立流：JWT 过期后新的 REST 请求 **401**，已打开 SSE 仍收到随后新写入的内容。该短 JWT 只用于精准时钟边界，未伪造角色或修改生产认证代码。

根因：`LiveSessionsService.streamForEvent` 每 3 秒调用 `getForEvent(eventId, capturedUser)`；capturedUser 始终来自连接建立时的 JWT。查询只匹配 captured workspaceId，没有当前 Session/membership 验证或连接授权租期。

证据：`security-results.json` 的两项 SSE 新数据观测，`probes/audit-security.cjs`；`apps/api/src/live-sessions/live-sessions.service.ts` 与 controller。

建议：在每次受保护快照生成/发送边界重查有效会话和成员权限，定义连接授权租期与过期策略，撤权时终止连接并清理定时器/订阅。已发送到客户端的字节不可收回；问题是撤权后新生成数据仍被发送。

所需回归：membership 删除、role 降级、logout、会话过期、跨 workspace/event、撤权与一次 SSE 查询并发，以及客户端重新连接/清空私有数据。保留正常 SSE 与 Polls 回归。

## SYS-AUTH-03 — refresh 值在同一秒内未轮换

**等级：P2。** 不是无凭证登录，也不是已撤销 Session 被恢复；是 rotation 契约和重放防护缺口。

复现：真实登录；跨过一秒后 refresh；立即再 refresh；重复使用刚被“轮换”的 refresh cookie。

期望：一次成功轮换产生新的不可预测 token identity，并使已消费值失效；如允许并发宽限，应有明确协议与测试。

实际：三次均 **200**；相邻两次 refresh token 值相同（只记录相等布尔值，不导出 token）。

根因：refresh JWT payload 只有 sub/sessionId/type；iat/exp 为秒精度，无 nonce/jti。相同秒、相同 payload 的签名值相同，重新 Argon2 hash 不改变 token identity。另外读取旧 hash 和更新 hash 不在原子消费边界内；并发 refresh 的额外风险是代码观察，本轮未把它当成已运行的独立攻击结果。

证据：`security-results.json.refreshRotation`；`apps/api/src/auth/auth.service.ts`。

建议：每次轮换使用独立 token identity，事务/条件更新消费旧值，并明确多 tab 并发语义。回归同秒连续 refresh、同值重放、并发 refresh、logout 与 refresh 竞争。正常已登出 refresh 被拒绝的现有证据必须保留。

## SYS-BCAST-01 — 刷新中的旧 revision 可再次提交

**等级：P2。** 可通过等待刷新完成后重试恢复；未发现结束错误 replacement session 或数据损坏。

复现：准备广播；并发观察令 broadcastRevision 增长；End 返回 409；延迟浏览器取得新的 GET snapshot；点击 Refresh 后立即点击 Retry ending。

期望：刷新期间禁用依赖新 revision 的命令，或命令等待有效的最新 snapshot。

实际：Retry 仍 enabled，发送旧 revision，再次 **409**；释放 GET 后重试 **201**，正确结束当前 session。

证据：原 `e2e/broadcast.spec.ts` 首次运行 **3 passed / 1 failed**，失败为期待 201、实际 409；保持原断言的 3 次单项复测通过，表明具有时序敏感性。新增独立诊断通过控制真实 GET 的交付时机确定复现：`broadcast-race-results.json`、`probes/final-audit-broadcast-race.spec.ts`。诊断脚本通过表示“复现并验证恢复”，不表示缺陷已经修好。

根因：`BroadcastScope.busy` 覆盖命令而不覆盖手动 refresh；`useBroadcast.refresh()` 已在 syncing 时会标记 dirty 后立即返回，UI 没有可等待的刷新完成状态。

文件：`apps/web/src/features/broadcast/broadcast-panel.tsx`、`use-broadcast.ts`。建议保留原操作 identity/目标 session，显式管理刷新状态或等待共享 refresh promise；测试有界延迟、双击、同 revision、replacement、丢失回执。

## SYS-CI-01 — 冷检出测试先于必要的 API build

**等级：P2。** 构建后的应用和真实进程恢复测试通过；这里的问题是仓库 CI 测试顺序无法可靠复现它们。

复现：在独立验证副本暂移生成的 `apps/api/dist`，保持源码/测试不变，运行 `npm run test:e2e --workspace=@opspilot/api -- --runInBand media-restart.e2e-spec`。探针 finally 恢复原生成目录。

实际：`MODULE_NOT_FOUND`，测试 child 在 ready barrier 前退出，**1 failed**。恢复 build 后同项 **1 passed**，实际经历 API/worker SIGKILL 和真实媒体恢复，约 66.7 秒。

根因：`.github/workflows/ci.yml` 的 quality job 在 `npm run build` 之前运行 API integration；`scripts/media-restart-child.cjs`、`media-live-fence-child.cjs` 直接 require 编译后的 API。媒体专用脚本会先 build，CI 的通用入口没有这个前置步骤。另该 CI 未启用 Broadcast，8 项直播 API 用例会被条件跳过；也没有运行直播浏览器 suite。这是已检查的工作流配置，不是本轮执行过远端 CI 的声称。

证据：`ci-order-results.json`、`ci-clean-api-order.txt`、`media-restart-isolated-recheck.txt`。建议在依赖产物的测试前构建 API，并为必要直播运行条件建立明确 CI gate。保留测试断言，不以跳过进程测试解决。

## SYS-OPS-01 — readiness 在 Redis 不响应时缺少 deadline

**等级：P2。** 暂停恢复后请求及服务能恢复，没有证据证明永久卡死或数据损坏。

复现：仅暂停本轮专用 Redis 容器；GET `/api/v1/health/ready`，客户端设置 6000ms deadline；随后恢复容器。

期望：健康探针在部署可用的时间预算内返回非 ready，例如 503，而非无限等待某个依赖。

实际：6065ms 观测窗口内无响应，由客户端取消；依赖恢复后 ready 为 **200**。本轮没有声称观察了无限时长。

根因：`HealthService.readiness()` 对三个依赖用无 deadline 的 Promise.allSettled；共享 BullMQ Redis 配置 `maxRetriesPerRequest: null` 允许持续等待。worker 所需重试语义不等于 HTTP 健康检查应无界等待。

证据：`infrastructure-results.json.readinessOutage`；`apps/api/src/health/health.service.ts`、`infrastructure/queues/redis-connection.ts`。建议单独有界的探针超时/取消策略，避免简单改坏 worker 重试设置；测 Redis/PG/MinIO 各自慢响应和恢复，区分 live 与 ready。

## SYS-DEP-01 — 开发依赖审计未归零

**等级：P2，维护与开发环境范围。** 全量 `npm audit --json --registry=https://registry.npmjs.org`：36 moderate、4 low、0 high、0 critical；`--omit=dev` 为 0。

直接 advisory 涉及 glob 的 AbortSignal 后仍继续遍历、minimatch 的 globparts 放大、deepmerge 的返回对象 prototype poisoning；其余多为受影响依赖链节点。未证明浏览器/API 生产请求能触达这些开发工具路径。不能将 npm 的包数量或 severity 直接等同于 40 个生产漏洞。

证据：`dependency-audit-official.txt`、`dependency-production.txt`，含 registry 返回的 advisory URL/依赖链。默认 registry 首次不支持 audit API（404 NOT_IMPLEMENTED），已用官方 registry 重跑，并未忽略失败。

建议：单独检查 lockfile 中受影响开发工具链，选择兼容更新，再跑 lint/build/test/CI；不得自动执行 `npm audit fix --force` 或把这些结果升级为无证据的生产可利用性结论。

## SYS-DOC-01 — 主架构/威胁模型过时

**等级：P3。** `docs/architecture.md`、`docs/threat-model.md` 仍描述 v1.2：没有 attendee identities、raw SQL 只用于健康查询、默认 24 小时删除非 seeded 媒体等。实际已有独立 attendee、显式事务行锁、持久媒体和新清理契约。集成文档较新，但主入口缺乏明确历史版本标记。

建议：保留历史记录并明确版本，增加当前整体架构入口；统一权限修复后更新当前授权策略、bearer URL TTL、cleanup/recovery 和生产范围。本轮只记录，不重写原文档。

回归要求：人工核对 README 链接、当前 schema/config、实际已执行命令和支持范围，确保“历史实现”“当前实现”“未验证部署”不混淆。
