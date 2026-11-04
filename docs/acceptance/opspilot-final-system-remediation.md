# OpsPilot 全系统验收问题修复

起点：`7644c92d4a0d91e0e1318bc4ae55bc0787ad46fe`，源分支 `feat/streamops-chat-integration`；实施分支 `fix/final-system-acceptance`。只修复 2026-11-03 全系统验收的 2 项 P1、5 项 P2、1 项 P3，不开发新模块。原审计报告保留为历史证据。

## 实施与验证顺序

1. SYS-AUTH-01/02：统一当前 staff Session/membership，SSE 在授权行锁内发送并在失效时终止；前端清空失效快照并经真实认证恢复。
2. SYS-AUTH-03：唯一 refresh identity 与原子消费；明确并发/重试契约。
3. SYS-BCAST-01：刷新未确认前阻止旧 revision 命令，保留原 operation/session identity。
4. SYS-CI-01/OPS-01：冷构建和真实直播 CI gate；独立、有界依赖健康探针。
5. SYS-DEP-01/DOC-01：兼容依赖修复及当前架构/威胁模型。
6. 独立测试副本中执行完整相关回归、真实上传/处理/直播和已发现缺陷探针，记录首次失败与复测；最后仅合并修复及报告。

隔离：复用此前明确归审计所有的 `opspilot-final-audit-20261103-*` 服务、专用 PostgreSQL/MinIO；不使用共享开发数据库。执行副本只适配端口和专用实例名，原断言保留。私有环境在 `.runtime/final-system-remediation/20261103`，不提交密码/token/原始认证 trace。

## 当前检查点

- P1 后端：新增真实 PostgreSQL/REST/SSE 11 项通过；包含旧角色、成员删除、logout、Session/JWT 过期、跨 workspace、SSE 在途快照与撤权竞争。
- `npm run typecheck` 通过。
- 首次新测试夹具遗漏必填 description，修正测试数据后重跑通过；没有削弱断言。
- 新增浏览器权限/清理/续期用例，尚待最终生产 Web 回归；不在此提前声称通过。

## 授权语义

REST 在全局 guard 中查询当前 Session 和 WorkspaceMembership，再交由原 RolesGuard/业务服务检查；已在 guard 通过的普通原有 REST 请求可在随后撤权前后完成，这是请求授权边界，不宣称所有旧路由持有事务授权锁。新互动与媒体原有操作级锁保留。

SSE 每次快照在 Session→Membership 的共享锁内读取、发送；撤权提交后不再发送新私有快照；长请求结束前再次检查 token/session expiry，退出订阅停止后续轮询。用户降为仍有读取权限的 VIEWER 时可继续读取，但快照携带当前 viewerRole，隐藏管理控件。失效/暂时故障不发送资源内容。客户端只在收到服务端 `access-changed`（expired/denied）或 REST 返回 401/403/404 时丢弃私有快照；访问过期时通过原 refresh 流程恢复，真正撤权则显示拒绝。纯传输故障（`onerror`，或 `access-changed` 的 reason 为 `unavailable`）保留最后一份已授权快照，经 REST 复核一次访问，然后以 2s→4s…最长 30s 的指数退避重连；重连纪元变化不再卸载房间。

logout 允许移除成员或 access 过期的用户终止其原签名 Session并清 cookie；不授予任何资源访问，仍受 Origin 检查，签名 sub/sessionId 与持久 Session.userId 必须匹配。

## 独立审计后的补充修复（2026-11-04）

独立审计（`docs/acceptance/claude-audit-20261104/`）在本分支 `06e8182` 上确认 SYS-AUTH-01/02/03 与 SYS-OPS-01 已修复，但发现一个由 SYS-AUTH-02 客户端改动引入的回归 CA-LIVEOPS-01：

- 现象：SSE 不可用而 REST 正常时，每次 `onerror` 都清空快照并卸载整个房间，REST 一成功就立即新建 EventSource，没有退避。10 秒内出现 54 次 EventSource、105 次 `GET /live-session`，管理按钮反复脱离 DOM。
- 影响：`e2e/live-polls.ui.spec.ts` 只有 3/7 通过（修复前主线为 7/7）。

修复（`apps/web/src/features/live-operations/live-session-room.tsx`）：

- 区分“权限变化”和“传输故障”两种情况，处理方式见上文“授权语义”。
- 私有快照的清理改为只在作用域卸载（换活动或换身份）时执行。

新增回归测试 `e2e/live-operations-sse-degraded.spec.ts`：只阻断 SSE、REST 保持正常时，10 秒内 EventSource ≤4 次、快照读取 ≤6 次，不出现 “Rechecking access”，“New poll” 仍可点击。

在隔离环境中的验证结果（Web 3131 / API 4231，独立 PostgreSQL、Redis、MinIO、Mailpit、MediaMTX）：

| 命令 | 结果 |
| --- | --- |
| `npm run lint` / `npm run typecheck` / `npm run build` | 通过 |
| `npx playwright test --config=playwright.ui.config.ts` | 12/12（修复前 8/12） |
| `node scripts/with-media-test-env.mjs env E2E_PRODUCTION_WEB=1 npx playwright test` | 仓库自带的 29 项与新增回归测试全部通过；其中 `current-authority` 2/2（撤权和过期场景仍清理私有数据） |
| SSE 降级探针（10 秒） | EventSource 3 次、REST 4 次、房间始终渲染（修复前 54/105） |
| `npx playwright test --config=playwright.broadcast.config.ts` | 4/4 |
| 完整业务旅程（审计诊断用例） | 1/1 |

注：在 media 配置下运行默认 Playwright 时，有 3 个审计专用的直播用例失败。它们只是被复制到审计副本中、需要直播配置，不属于仓库自带测试；改用直播配置后已单独通过。

尚未完成（见审计修复计划）：

- SYS-BCAST-01（直播刷新时序）
- SYS-CI-01（CI 顺序与直播覆盖）
- CA-TEST-01（测试隔离）
- CA-PERF-01（容量）
- 其余 P3 项

本分支合入主线后，需要在合并后的提交上重跑上表以及审计 J 节列出的全部命令。

状态：两个 P1 和 CA-LIVEOPS-01 已修复，并有运行证据；上述 P2/P3 项仍待处理。
