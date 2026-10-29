# OpsPilot Chat：P1 重连修复与回归验证

日期：2026-10-29。范围：本轮 Chat 验收 P1-01 及员工／观众恢复测试。
没有迁移 Topics、Media Library 或 Live Streaming；没有修改 Mudu 仓库。

## 基线与结论

原独立验收审查的是 `cdd924236abc952e7a51e53663491208274dabf4`；
`07705e9` 保存了原 FAIL 报告、运行证据和截图。
[原报告](opspilot-chat-integration-acceptance.md) 的历史结论保留，本文记录后续修复。

**本轮修复验证：PASS；P1-01 已修复。** 修复与测试提交：`1ac03b451d49b5f024382987c4c7983548b10431`。
员工与观众的真实 PostgreSQL 超时恢复、会话撤销及相关回归均通过。
此为修复后的验证记录，不改写原独立审查结论，也不代表已完成生产部署验收。
机器可读摘要见 [恢复验证结果](opspilot-chat-recovery-evidence.json)。

## 根因与修复

订阅票据已经消费后，`ChatGateway.handleConnection()` 调用 `history(limit=1)`。
原实现把包括数据库超时在内的所有异常都发送为 `chat.denied`；前端收到该事件
直接将 `denied` 置为永久状态，取消重试，并禁用刷新按钮。因此基础设施恢复后，
REST 已恢复正常，页面仍必须整页刷新才能重新接入。

本次生产代码只修改三个文件：

- `apps/api/src/event-chat/chat.gateway.ts`：初始化的 401/403/404 才发送
  `chat.denied`；其他故障发送 `chat.unavailable` 后关闭未完成的订阅，保持与
  正常回放路径一致的错误分类。
- `apps/web/src/features/chat/use-chat.ts`：临时错误清理旧监听器／连接、终止旧请求、
  隐藏尚未重新验证的历史，重新通过受保护的 REST 接口取得一次性票据，再订阅、
  校验当前权限及补齐历史。兼容旧网关错误发送的 `chat.denied(503)`。
  Socket 握手 401 可能是票据失效，允许换票；新的 REST 请求若确认会话失效或权限
  不足，仍进入终止状态。真正的订阅拒绝不自动恢复权限。
- `apps/web/src/features/chat/chat-panel.tsx`：未连接时提供“Retry chat connection”，
  已连接时仍为刷新历史；明确拒绝访问后该按钮禁用。

复用现有约 1 秒自动重连、5 秒修复检查、canonical message ID、客户端幂等 ID、
事件游标和权限边界。没有变更数据库 schema、权限规则、SSE 或其他产品流程。
重连不重用已消费的票据，也不直接展示缓存消息以绕过重新鉴权。

## 可重复的故障验证

新增 `apps/api/test/chat-recovery-server.ts`：仅供测试的 Nest 启动入口，要求显式
`NODE_ENV=test`、数据库名以 `_test` 结尾、以及指定故障文件目录。它运行真实应用模块，
使用真实认证、Redis、PostgreSQL 和 Socket.IO，没有新增生产故障接口。
构建配置排除整个 `test` 目录；本次检查生产 `dist` 中不存在该入口。
生产前端模式由 `scripts/start-chat-recovery-web.mjs` 启动 standalone 构建，
按现有 Dockerfile 的布局复制生成的 public/static 资源，不改变应用构建配置。

真实数据库场景：对测试活动行持有 `FOR UPDATE` 锁 6.5 秒，实际业务查询等待该锁，
超过 Prisma 交互事务默认 5 秒限制，原业务服务产生 503。没有把数据库查询结果替换
成 mock。每个故障只匹配一个活动、身份类别和调用阶段，并消费一次。

另用精确的一次性异常覆盖网关回放 503；用浏览器传输控制覆盖丢弃连接、阻断票据
请求、无效票据和旧协议 503。它们仍通过真实后端和数据库，属于故障注入，不能视为
真实 Redis 宕机或公网网络测试。

`e2e/chat-recovery.spec.ts` 对员工和观众分别验证：

1. 首次订阅遇到真实数据库超时后自动恢复，无页面 reload。
2. 重连初始化遇到同类超时后恢复、补齐离线消息且无重复；手动重试也可恢复。
3. 已连接状态的回放发生临时 503 后重新接入并发送。
4. 握手票据被拒绝时取得新票据，保留合法会话的访问能力。
5. 旧网关将临时 503 发送为 denied 时仍可恢复。
6. 断线期间撤销员工会话／使观众会话到期后，恢复请求被拒绝；历史保持隐藏、
   输入框与重试按钮禁用，直接 REST 查询返回 401。

数据库超时用例使用两个独立浏览器 context，并验证恢复后的消息被另一身份接收，
且 PostgreSQL 仅保存一个记录。页面内存标记确认没有靠整页刷新恢复。

后端另增加四个真实 Socket.IO 集成用例：员工／观众各验证临时初始化错误的分类、
一次性票据不可复用、换新票据后持久化发送，以及真正权限拒绝仍终止订阅。
既有消息去重、ACK 丢失、分页、跨活动、跨 workspace、撤权与登出测试保留。

## 实际执行环境与命令

本机 macOS，Node v22.20.0、npm 10.9.3；独立 Docker Compose PostgreSQL 17（5546）、
Redis 7.4.10（6381）、MinIO（9002）、Mailpit（8025 / SMTP 1026）。浏览器为本机 Chrome 156.0.8078.48。

原验收库 `opspilot_chat_acceptance_test`／Redis DB 9 上先复现红灯，并执行初轮测试。
完整 API 回归初次为 **43 通过、1 失败**：旧 analytics seed 的日期跨了一天，
14 天查询只包含 13 个样例。未修改断言、analytics 代码，也未重置该数据库。

为保证原回归所需的当天 fixture，单独新建 `opspilot_chat_recovery_20261029_test`，
执行已有迁移并只在这个新库首次 seed；使用 Redis DB 10、
`opspilot-chat-recovery-20261029` bucket。没有重置或重新 seed 普通开发库、原验收库、
共享库或用户上传；只清理用例创建的活动数据。恢复测试所需邮件 token 仅从自己创建
的测试 registration 读取，仍通过真实 verification API 完成入场。

下表的 `A`、`R` 是以下实际本地命令前缀（wrapper 位于忽略的 `.runtime`，不含生产凭证）：

```sh
# A：原验收隔离环境
node scripts/with-chat-test-env.mjs node .runtime/chat-acceptance/env.mjs <command>
# R：本次新建隔离环境
node scripts/with-chat-test-env.mjs node .runtime/chat-recovery/env.mjs <command>
```

新库初始化实际执行：

```sh
docker exec opspilot-chat-test-postgres-1 psql -U opspilot -d postgres -v ON_ERROR_STOP=1 \
  -c 'CREATE DATABASE opspilot_chat_recovery_20261029_test;'
# 以下只针对上述新建空库，不能对已有数据库随意 seed。
R npm run db:deploy
R env DEMO_SEED_ALLOWED=true npm run db:seed
```

| 命令 | 实际结果 |
| --- | --- |
| `A npm run test:chat:recovery -- --grep 'staff recovers.*initial subscription'`（修复前） | **1 失败**；真实锁超时后等待 20 秒仍为 Access unavailable |
| `A npm run test:chat:recovery`（首轮修复后） | **8 通过**，1.5 分钟；随后扩充票据与旧协议用例 |
| `npm run typecheck` | PASS（API + Web） |
| `npx tsc --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2022 e2e/chat-recovery.spec.ts playwright.chat-recovery.config.ts` | PASS；新增浏览器测试与配置单独类型检查 |
| `npm run lint` | PASS（API + Web） |
| `npm test -- --runInBand` | **91 通过 / 14 suites** |
| `npm run test:chat:state` | **5 通过** |
| `A npm run test:e2e --workspace=@opspilot/api -- --runInBand` | **43 通过、1 失败**；上述跨日 seed 原因 |
| `R npm run test:e2e --workspace=@opspilot/api -- --runInBand` | **44 通过 / 4 suites**；Chat 16、其他 28 |
| `node scripts/with-chat-test-env.mjs npm run build` | PASS（Nest + Next 生产构建） |
| `R env CHAT_RECOVERY_PRODUCTION_WEB=1 npm run test:chat:recovery` | **12 通过**，1.5 分钟；最终 standalone 生产构建启动模式 |
| `R npm run test:ui` | **11 通过**，1.9 分钟；2 Chat + 9 原功能 |
| `R npm run test:ui:isolated` | **12 通过**，24.6 秒；使用 mock 的 UI 回归单独计数 |

故障恢复 suite 结束后查询确认：遗留 recovery fixture 活动 0、对应消息 0，
seed analytics snapshots 仍为 14。再次运行 `R npm run db:deploy` 返回无待应用迁移。

命令输出保存在本机 `.runtime/chat-recovery/`。完整命令、退出状态及摘要在本报告中，
不将包含认证测试数据的浏览器 trace 作为公共文档提交。

## 复跑方法

使用已迁移、具有当天 demo fixtures 的专用测试环境（不要重置共享数据）：

```sh
# 使用已有隔离测试环境 wrapper 时，先确认固定端口没有其他进程占用。
node scripts/with-chat-test-env.mjs npm run test:chat:api
node scripts/with-chat-test-env.mjs npm run test:chat:recovery
node scripts/with-chat-test-env.mjs npm run test:ui
# 可选：构建后以生产版 Next 前端执行恢复用例
node scripts/with-chat-test-env.mjs npm run build
node scripts/with-chat-test-env.mjs env CHAT_RECOVERY_PRODUCTION_WEB=1 npm run test:chat:recovery
```

专用 Playwright 配置不复用已运行的服务，避免误连普通 API 而跳过故障注入。
常规 `test:ui` 排除此测试文件，专用命令独立运行；CI 已加入生产前端模式的该命令。

## 原功能回归覆盖

- **认证／权限**：真实登录、refresh rotation、logout、Origin 限制、当前 membership、
  工作区隔离、活动隔离、只读员工、邀请撤销与会话过期。
- **员工／观众 Chat**：真实双会话发送和持久化、删帖同步、重复／延迟事件、
  丢失 ACK、补齐多页历史、读取锚点、未读／跳转、活动切换与大批消息的 DOM 上界。
- **活动／入场**：活动创建、注册、邮件确认、私密邀请、撤销及归档不可变。
- **Live Operations／投票**：操作会话、SSE 相关业务流、跨客户端投票更新、关闭、只读角色。
- **媒体／其他原有流程**：已有 ready media 关联／解除及 workspace 检查，媒体可靠性页面，
  webhook、analytics、AI assurance 和移动视口回归。未宣称重新验证完整视频上传转码链路。
- **隔离 UI 套件**：单独报告，含响应 mock，用于界面错误状态；不作为真实集成的替代。

## 本地服务状态

测试结束后已使用 `node scripts/with-chat-test-env.mjs npm run dev` 恢复普通隔离开发环境，
连接原 `opspilot_chat_test`，没有重新 seed。`http://localhost:3000/login` 返回 200；
`http://localhost:4100/api/v1/health/ready` 返回 ready，database/objectStorage/queues 全部 up。
Mudu HEAD 仍为 `7bd9a2f36df8d0992260e1ba356754d6fce05f63`，原未跟踪验收资料保持不变。

## 限制与后续边界

- 生产前端恢复测试配合测试专用 Nest 入口与真实数据库运行；不等于整个生产容器部署验证。
- 本轮不重建／重启 Docker 应用镜像，不宣称 HTTPS 代理、多节点或真实 Redis 宕机已通过。
- 恢复测试是本地受控故障，未扩大为生产负载或长期 soak test。既有固定重试间隔保持不变。
- analytics 回归依赖当前日期的 seed 是既有测试环境约束，未为本次 Chat 修复改写其他模块。
- 原独立报告的部署未验证项继续保留；完成本次修复不自动授权进入下一模块。
