# 03 · 课程大纲：一行一行读懂 OpsPilot

> **现在的主线是 [05 · 从零搭建](05-build-from-scratch.md)。** 本章改作参考阅读：05 的每一课做完后，按这里列出的文件去读参考答案里对应的实现。

这份大纲按“读懂现有代码”的顺序排列，**从简单到复杂**：每一课只引入少量新概念，并尽量复用前面课程学过的模式。

## 每节课怎么上

1. **目标**：先说清这节课学完后你能解释或写出什么。
2. **跑起来**：先运行相关测试或页面，亲眼看到这段代码在做什么。
3. **逐行阅读或重写**：按下表列出的文件，从上到下逐行讲解。重点讲清楚“为什么这样写”，以及“不这样写会出什么问题”。
4. **小练习**：做一处小改动或写一个小测试，跑测试验证。
5. **回顾**：用 3 句话复述本课要点，记到 `docs/learning/notes/`（自己的笔记）。

> 行数是当前 `main` 上的近似值，用来估计每课的时长：大约每 150–200 行一节课。标了 ★ 的课程有审计期间修复的真实缺陷，可以先看“修复前”的代码，再看“修复后”的代码。

---

## 第 0 部分：准备

### 第 0 课 · 跑起来，看全貌（约 1 节）
- **目标**：能在本机启动全部服务、登录、走一遍演示，知道每个目录是干什么的。
- **阅读**：`README.md` 的 Local Setup、本目录的 [01-architecture.md](01-architecture.md) 第 1.1–1.3 节、`docker-compose.yml`、`package.json` 中的 scripts。
- **练习**：运行 `npm run services:up` → `db:deploy` → `db:seed` → `npm run dev`，用 Alex 账号登录，找到 Launch Control、Live Operations 和 Media Library。

---

## 第 1 部分：后端基础（NestJS + Prisma）

### 第 1 课 · NestJS 应用是怎么启动的（约 2 节）
- **概念**：模块、依赖注入、全局 guard/pipe/filter、两个入口（API 和 Worker）。
- **文件**：`apps/api/src/main.ts`（18）、`worker.ts`（13）、`app.module.ts`（70）、`worker.module.ts`（46）、`configure-app.ts`（80）。
- **练习**：给 `health` 加一个只返回版本号的 `@Public()` 路由，并写一个 e2e 断言。

### 第 2 课 · 配置校验：为什么启动时就要失败（约 1 节）
- **概念**：fail fast、生产环境的安全约束（HTTPS、secure cookie、强密钥）。
- **文件**：`config/environment.ts`（228）。
- **练习**：读懂 `COOKIE_SAME_SITE=none` 为什么要求 `COOKIE_SECURE=true`。

### 第 3 课 · 数据模型与迁移（约 2 节）
- **概念**：Prisma schema、关系、唯一约束、CHECK 约束、迁移只增不改、seed。
- **文件**：`prisma/schema.prisma`（核心模型：Workspace、User、Session、WorkspaceMembership、StreamEvent）、`prisma/migrations/20260812232430_init`、`prisma/seed.ts`（只读前 180 行）。
- **配图**：[01-architecture.md §1.8](01-architecture.md#18-数据模型核心实体)。

### 第 4 课 ★ · 登录、JWT 与“当前权限”（约 3 节）
- **概念**：密码哈希（argon2）、access/refresh 双 token、httpOnly cookie、refresh 单次有效、**JWT 里的角色为什么不可信**。
- **文件**：`auth/auth.controller.ts`（112）、`auth.service.ts`（182）、`auth.guard.ts`（65）、`staff-authority.service.ts`（77）、`common/guards/roles.guard.ts`（24）。
- **审计案例**：SYS-AUTH-01（降权后旧 cookie 还能写）、SYS-AUTH-03（refresh 可以重放）。对照 `git show d260eab` 和 `git show aed3495`。
- **练习**：读 `apps/api/test/current-authority.e2e-spec.ts` 的第一个用例，自己再写一个“降为 ANALYST 后不能创建 Poll”的断言。

### 第 5 课 · 活动业务：状态机、事务与领域事件（约 2 节）
- **概念**：状态转换表、在事务里做“检查 + 修改 + 记录事件”、行锁。
- **文件**：`events/events.service.ts`（329）、`readiness/readiness.service.ts`（159）、`domain-events/domain-events.service.ts`（51）。
- **配图**：[02-business-flows.md §2.2–2.3](02-business-flows.md#22-活动状态机)。
- **练习**：给 readiness 加一条只产生警告、不阻断的检查，并让单元测试覆盖它。

---

## 第 2 部分：前端基础（Next.js + React Query）

### 第 6 课 · 路由、布局与 API 客户端（约 2 节）
- **概念**：App Router、客户端组件、React Query、带 cookie 的 fetch、401 自动续期、多标签页用 Web Locks 串行续期。
- **文件**：`apps/web/src/app/layout.tsx`、`app/(app)/layout.tsx`、`lib/api.ts`（109）、`features/auth/auth-provider.tsx`（57）。

### 第 7 课 · Launch Control 页面（约 3 节）
- **概念**：“容器组件 + 展示组件”的拆分；页面怎样组合查询、变更和对话框；变更成功后让哪些查询失效；错误提示。
- **文件**：`features/events/launch-control/` 目录：容器 `launch-control.tsx`（约 250）、写操作 hook `use-launch-control-actions.ts`、各个面板（`readiness-panel.tsx`、`runbook-panel.tsx`、`recommendations-panel.tsx` 等，每个 20–250 行）、`dialogs.tsx`。
- **顺带学习**：`components/ui/states.tsx` 里的 `QueryState`，统一处理“加载中 / 出错 / 空 / 有数据”四种状态。

---

## 第 3 部分：观众身份

### 第 8 课 · 登记、邮件验证与观众会话（约 3 节）
- **概念**：防止用户枚举（不符合资格也返回同样的结果）、一次性 token、会话 cookie 的 path 隔离、资格每次请求重新判断。
- **文件**：`event-registrations/event-registrations.service.ts`（170）、`attendee-access/attendee-access.service.ts`（228）、`attendee-eligibility.ts`（114）、前端 `features/registrations/public-registration.tsx`、`confirm-attendee.tsx`。
- **配图**：[02-business-flows.md §2.4](02-business-flows.md#24-观众登记与入场)。

### 第 9 课 · 统一身份：EventIdentityService（约 1 节）
- **概念**：`EventPrincipal`（员工/观众联合类型）、在事务里加 `FOR SHARE` 锁、为什么锁要一直持有到“发送完数据”。
- **文件**：`event-interactions/event-identity.service.ts`（151）。

---

## 第 4 部分：实时通信

### 第 10 课 ★ · SSE 与 Live Operations（约 2 节）
- **概念**：Server-Sent Events、RxJS 定时器、在授权锁内发送数据、撤权时通知客户端，以及客户端区分“没权限了”和“只是断线”。
- **文件**：`live-sessions/live-sessions.service.ts`（325，重点是 `streamForEvent`）、`features/live-operations/live-session-room.tsx`（539）。
- **审计案例**：SYS-AUTH-02（撤权后 SSE 继续推送）和它的修复引入的回归 CA-LIVEOPS-01（重连死循环），对照 `git show c29a709`。

### 第 11 课 · Chat 后端：日志、幂等与推送（约 3 节）
- **概念**：一次性 ticket、Socket.IO 中间件、按 sequence 递增的事件日志、`clientMessageId` 幂等、ack、回放 cursor。
- **文件**：`event-chat/chat-ticket.service.ts`（75）、`chat.service.ts`（300）、`chat.gateway.ts`（391）、`chat.controller.ts`（130）、`packages/chat-contracts`。
- **配图**：[02-business-flows.md §2.6](02-business-flows.md#26-chat发送推送与断线恢复)。

### 第 12 课 · Chat 前端：纯函数状态 + 连接管理 + 滚动（约 3 节）
- **概念**：把状态逻辑写成纯函数（容易测试）、去重和乱序合并、重连、滚动锚点保持、DOM 窗口化。
- **文件**：`features/chat/state.ts`（279）、`protocol.ts`（65）、`use-chat.ts`（624）、`chat-panel.tsx`（470）、`tests/chat-state.test.ts`。

### 第 13 课 · Topics：审核规则与并发（约 3 节）
- **概念**：乐观并发（`expectedVersion`）、数据库约束和行锁共同保证不变量、草稿与远端更新冲突。
- **文件**：`event-topics/topics.service.ts`（628）、`features/topics/state.ts`、`drafts.ts`、`use-topics.ts`（418）；界面拆成 `topics-panel.tsx`（列表与筛选）、`topic-card.tsx`（单个问题）、`composer.tsx`（提问/回复表单与重试）、`settings-form.tsx`、`topic-ui.ts`。
- **配图**：[02-business-flows.md §2.7](02-business-flows.md#27-topics--qa提问审核置顶)。

### 第 14 课 · Polls（约 1 节）
- **文件**：`live-polls/live-polls.service.ts`（499）、`features/live-operations/live-polls-panel.tsx`（447）。

---

## 第 5 部分：媒体

### 第 15 课 · 对象存储与 presigned URL（约 2 节）
- **文件**：`infrastructure/storage/storage.service.ts`（392）、`media/media-authority.ts`。

### 第 16 课 · 分片上传、续传与幂等（约 3 节）
- **文件**：`media/multipart.service.ts`（520）、前端 `features/media/upload-queue.ts`（366）、`upload-api.ts`、`upload-panel.tsx`。
- **配图**：[02-business-flows.md §2.8](02-business-flows.md#28-媒体分片上传与处理)。

### 第 17 课 · Worker、FFmpeg 与恢复（约 3 节）
- **概念**：BullMQ 消费者、子进程调用 FFmpeg、fencing（阻止旧 worker 回写）、持久化意图和恢复扫描。
- **文件**：`media/media-processing.processor.ts`（650）、`media-queue-recovery.service.ts`（167）、`media-cleanup.processor.ts`。

---

## 第 6 部分：直播

### 第 18 课 · 直播会话与授权（约 3 节）
- **文件**：`broadcast/broadcast.service.ts`（609）、`broadcast.controller.ts`（182）、`media-utils.ts`（68）、`infrastructure/mediamtx/mediamtx.yml`。
- **配图**：[02-business-flows.md §2.9](02-business-flows.md#29-直播准备--推流--观看--结束)。

### 第 19 课 · HLS 中转（约 1 节）
- **文件**：`broadcast/media-relay.service.ts`（115）、`mediamtx.service.ts`（84）。

### 第 20 课 ★ · 前端直播面板与播放器（约 2 节）
- **概念**：hls.js 的生命周期、自动播放限制、卸载时清理、刷新期间锁住命令。
- **文件**：`features/broadcast/use-broadcast.ts`（277）、`broadcast-panel.tsx`（334）、`live-player.tsx`（233）、`watch-room.tsx`（167）。
- **审计案例**：SYS-BCAST-01，对照 `git show ef29035`。

---

## 第 7 部分：集成、测试与交付

### 第 21 课 · 事务性 Outbox 与 Webhook（约 2 节）
- **文件**：`integrations/outbox.processor.ts`（122）、`webhook-delivery.processor.ts`（195）、`webhook-signature.ts`、`docs/adr/0004-*`。

### 第 22 课 · 测试金字塔（约 2 节）
- **概念**：纯状态测试、Jest 单元测试、真实依赖的 API e2e、Playwright 浏览器测试、隔离测试环境（`scripts/test-env.mjs`）。
- **文件**：`tests/chat-state.test.ts`、`apps/api/test/chat.e2e-spec.ts`（前 200 行）、`e2e/topics.spec.ts`（一个用例）、`playwright.config.ts`、`.github/workflows/ci.yml`。

### 第 23 课 · 容器、健康检查与部署边界（约 1 节）
- **文件**：`apps/api/Dockerfile`、`apps/web/Dockerfile`、`health/health.service.ts`（191）、README 中“Object storage image”一节。

---

## 结业项目（自己动手，我来 review）

| 项目 | 难度 | 内容 |
| --- | --- | --- |
| A | ★★ | 修复 CA-OPS-02：给数据库访问加上有界的超时，数据库卡住时返回 503，并写一个暂停 PostgreSQL 的测试 |
| B | ★★★ | 实现 CA-MOD-01：员工可以撤销某个观众的会话或禁止其发言，Chat、Topics、Polls、HLS 四个边界都要生效 |
| C | ★★★★ | 实现 CA-PERF-01：把每 3 秒的授权轮询改成事件驱动推送 + 有租期的授权缓存，改造前后在相同负载下测量数据库事务数和推送延迟并对比 |
