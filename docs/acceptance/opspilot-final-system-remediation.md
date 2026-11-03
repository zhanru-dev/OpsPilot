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

SSE 每次快照在 Session→Membership 的共享锁内读取、发送；撤权提交后不再发送新私有快照；长请求结束前再次检查 token/session expiry，退出订阅停止后续轮询。用户降为仍有读取权限的 VIEWER 时可继续读取，但快照携带当前 viewerRole，隐藏管理控件。失效/暂时故障不发送资源内容；客户端丢弃旧缓存，访问过期时通过原 refresh 流程恢复，真正撤权则显示拒绝。

logout 允许移除成员或 access 过期的用户终止其原签名 Session并清 cookie；不授予任何资源访问，仍受 Origin 检查，签名 sub/sessionId 与持久 Session.userId 必须匹配。

状态：修复进行中，最终命令、结果、限制和后续检查点将在回归完成后补齐。
