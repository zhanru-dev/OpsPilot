# 01 · 项目架构

本章回答三个问题：项目由哪些进程组成、代码放在哪里、各层之间怎样通信和做权限判断。所有图都根据当前 `main` 的代码绘制。看到“代码位置”时，建议打开对应文件对照阅读。

> 阅读建议：先看 1.1 和 1.2，建立“有哪些东西在运行”的整体印象，再看 1.3–1.5 了解代码组织，最后看 1.6–1.9 的通信方式和权限。

---

## 1.1 运行时全景：有哪些进程

```mermaid
flowchart LR
  subgraph Browser["浏览器"]
    Staff["员工端<br/>/dashboard · /streamops/..."]
    Viewer["观众端<br/>/events/:id/watch ..."]
  end
  subgraph App["Node.js 进程（本仓库代码）"]
    Web["Web · Next.js 16<br/>apps/web · :3000"]
    API["API · NestJS 11<br/>src/main.ts · :4100"]
    Worker["Worker · NestJS<br/>src/worker.ts"]
    FF["FFmpeg 子进程"]
  end
  subgraph Data["数据与队列"]
    PG[("PostgreSQL 17<br/>业务真相")]
    Redis[("Redis<br/>BullMQ + ticket")]
    MinIO[("MinIO（S3）<br/>媒体文件")]
  end
  subgraph Media["直播"]
    MTX["MediaMTX<br/>RTMP → HLS"]
  end
  Mail["Mailpit（SMTP）"]
  OBS["OBS / FFmpeg 推流端"]

  Staff --> Web
  Viewer --> Web
  Staff -- "REST · SSE · Socket.IO" --> API
  Viewer -- "REST · Socket.IO · HLS" --> API
  Staff -. "presigned 分片直传" .-> MinIO
  API --> Data
  Worker --> Data
  Worker --> Mail
  Worker --> FF
  API -- "HLS 中转 / 控制" --> MTX
  MTX -- "推流鉴权回调" --> API
  OBS -- "RTMP + 推流密钥" --> MTX
```

几个要点：

- **API 和 Worker 是同一份 NestJS 代码的两个入口。** `main.ts` 启动 HTTP 服务；`worker.ts` 只启动队列消费者（媒体处理、outbox、webhook、邮件、清理）。耗时的事情交给 Worker 去做，API 的请求不会被拖慢。
- **浏览器直接访问 API**（`NEXT_PUBLIC_API_URL`）。Next.js 负责页面渲染，不代理业务请求。
- **大文件不经过 API。** 浏览器拿到 presigned URL 后，直接把分片上传到 MinIO；API 只负责签发 URL 和记账。
- **视频流要经过 API。** 观众请求的 HLS playlist 和分片都由 API 鉴权后，再从 MediaMTX 转发，所以 MediaMTX 不对外开放。

## 1.2 一个请求经过哪些层

```mermaid
flowchart TB
  Req["HTTP 请求"] --> Origin["Origin 检查<br/>configure-app.ts<br/>跨站写请求 → 403"]
  Origin --> Helmet["helmet / CORS / cookieParser"]
  Helmet --> Throttle["ThrottlerGuard<br/>默认每路由每分钟 100 次"]
  Throttle --> AuthG["AuthGuard<br/>验证 JWT 签名 → StaffAuthorityService<br/>从 PostgreSQL 读取当前 Session + Membership"]
  AuthG --> Roles["RolesGuard<br/>@Roles(...) 只用当前角色判断"]
  Roles --> Pipe["ValidationPipe<br/>DTO 白名单校验"]
  Pipe --> Ctl["Controller"]
  Ctl --> Svc["Service<br/>业务规则 + Prisma 事务"]
  Svc --> DB[("PostgreSQL")]
  Svc -. "事务内记录" .-> Outbox["DomainEvent / Outbox"]
  Ctl --> Filter["ApiExceptionFilter<br/>统一错误格式"]
```

- 标记了 `@Public()` 的路由（登录、观众端接口、健康检查、MediaMTX 回调）会跳过 AuthGuard。观众端接口改由 `EventIdentityService` 自己校验观众会话（见 1.7）。
- **JWT 只证明“你是谁”。** 当前角色每次请求都从数据库读取，所以降权、移除成员、登出都会立刻生效。

## 1.3 Monorepo 目录地图

```mermaid
flowchart LR
  Root["仓库根目录<br/>npm workspaces"] --> Apps["apps/"]
  Root --> Pkgs["packages/<br/>前后端共享的协议类型"]
  Root --> Prisma["prisma/<br/>schema.prisma · 16 个 migration · seed.ts"]
  Root --> E2E["e2e/<br/>Playwright 浏览器测试"]
  Root --> Tests["tests/<br/>纯状态单元测试（node --test）"]
  Root --> Scripts["scripts/<br/>测试环境 wrapper · setup · 检查脚本"]
  Root --> Infra["infrastructure/mediamtx<br/>docker-compose*.yml"]
  Apps --> ApiApp["apps/api<br/>NestJS：src/ 业务代码 · test/ 集成测试"]
  Apps --> WebApp["apps/web<br/>Next.js：src/app 路由 · src/features 功能 · src/components 通用 UI"]
  Pkgs --> C1["chat-contracts"]
  Pkgs --> C2["topics-contracts"]
  Pkgs --> C3["broadcast-contracts"]
  Pkgs --> C4["media-contracts"]
```

`packages/*-contracts` 存放前后端共用的 TypeScript 类型，例如 Chat 消息、Topic 快照、直播快照，用来保证两端对同一份数据的理解一致。

## 1.4 后端模块地图（apps/api/src）

```mermaid
flowchart TB
  subgraph Core["基础层"]
    Config["config/<br/>环境变量校验"]
    PrismaM["prisma/"]
    Common["common/<br/>装饰器 · guards · 请求上下文"]
    InfraQ["infrastructure/queues<br/>BullMQ 队列定义"]
    InfraS["infrastructure/storage<br/>S3/MinIO 封装"]
    Health["health/"]
  end

  subgraph Identity["身份与权限"]
    Auth["auth/<br/>登录 · refresh · StaffAuthorityService"]
    WS["workspaces/"]
    EI["event-interactions/<br/>EventIdentityService<br/>员工/观众统一身份"]
    Attendee["attendee-access/<br/>观众验证 · 会话 · 邮件"]
  end

  subgraph Original["原有 OpsPilot 业务"]
    Events["events/<br/>活动 CRUD · 状态机 · runbook"]
    Ready["readiness/<br/>上线就绪评分"]
    Access["access-policies/"]
    Content["content-blocks/"]
    Reg["event-registrations/"]
    Inv["event-invitations/"]
    LS["live-sessions/<br/>运营会话 + SSE"]
    Polls["live-polls/"]
    Analytics["analytics/ · dashboard/"]
    Reco["recommendations/<br/>确定性规则 + 可选 AI"]
    Integr["integrations/<br/>outbox → webhook"]
    Audit["audit/ · error-reports/ · feature-flags/"]
    DE["domain-events/"]
  end

  subgraph New["集成进来的五个模块"]
    Chat["event-chat/<br/>REST + Gateway（Socket.IO）"]
    Topics["event-topics/"]
    Media["media/<br/>分片上传 · 处理 · 清理 · 恢复"]
    Bcast["broadcast/<br/>直播会话 · 授权 · HLS 中转"]
  end

  Auth --> PrismaM
  EI --> Attendee
  Chat --> EI
  Topics --> EI
  Bcast --> EI
  Chat -. "同一个 Gateway 承载三个频道" .-> Topics
  Chat -.-> Bcast
  Events --> Ready
  Events --> LS
  Events --> DE
  DE --> Integr
  Media --> InfraS
  Media --> InfraQ
```

- **原有业务**沿用经典的 Controller → Service → Prisma 结构，由全局 guard 负责员工权限。
- **集成进来的模块**（Chat、Topics、Broadcast，以及媒体的部分接口）需要同时服务员工和观众，所以统一通过 `EventIdentityService.validate()`，在**数据库事务内加行锁**后再校验身份和权限。这样即使权限在操作进行中被撤销，也不会让旧权限完成写入或推送。

## 1.5 前端结构（apps/web/src）

```mermaid
flowchart LR
  subgraph Routes["app/（路由，Next.js App Router）"]
    Login["login/"]
    AppG["(app)/ 员工区<br/>dashboard · analytics · integrations<br/>audit-logs · settings"]
    SO["(app)/streamops/<br/>events · events/[id] · events/[id]/live<br/>live · media"]
    Pub["events/[id]/<br/>register · confirm · watch（观众区）"]
  end
  subgraph Features["features/（业务功能）"]
    FE["events/<br/>Launch Control"]
    FLO["live-operations/<br/>运营室 + Polls"]
    FC["chat/<br/>use-chat · state · chat-panel"]
    FT["topics/"]
    FB["broadcast/<br/>use-broadcast · live-player（hls.js）"]
    FM["media/<br/>upload-queue · upload-panel"]
    FR["registrations/"]
    FA["auth/"]
  end
  subgraph Shared["共享"]
    Comp["components/ UI 组件"]
    Lib["lib/api.ts<br/>fetch 封装 + 自动 refresh"]
  end
  SO --> FE
  SO --> FLO
  FLO --> FC
  FLO --> FT
  FLO --> FB
  Pub --> FC
  Pub --> FT
  Pub --> FB
  SO --> FM
  Features --> Lib
  Routes --> Comp
```

运营室（`events/[id]/live`）和观众的观看页（`events/[id]/watch`）复用同一套 Chat、Topics、Broadcast 组件，通过 `mode: "staff" | "attendee"` 区分身份。

## 1.6 浏览器和服务器之间的三种通信方式

```mermaid
flowchart LR
  B["浏览器"]
  subgraph API
    R["REST<br/>/api/v1/..."]
    S["SSE<br/>/stream-events/:id/live-session/stream"]
    G["Socket.IO 命名空间 /chat<br/>频道：chat · topics · broadcast"]
  end
  B -- "命令和查询<br/>cookie 认证" --> R
  S -- "运营快照<br/>每 3 秒，在授权锁内发送" --> B
  B -- "先 POST .../ticket 换一次性 ticket<br/>（Redis，30 秒）" --> R
  B <-- "ticket 建立连接后：<br/>chat.event / topics.changed / broadcast.snapshot" --> G
```

| 方式 | 用在哪里 | 为什么选它 |
| --- | --- | --- |
| REST | 所有命令（发送、审核、开始直播……）和首次加载 | 简单、可重试，幂等性由 `clientOperationId` 保证 |
| SSE | Live Operations 运营快照 | 单向推送，原有功能就是这样设计的 |
| Socket.IO | Chat、Topics、直播状态通知 | 双向通信；Chat 发送用 ack；同一个连接通道复用三个频道 |

**一个重要的设计：** WebSocket 推送的大多只是“有变化”的通知。客户端收到后，会用 REST 拉取一份经过授权验证的快照。过期或乱序的推送因此不会覆盖新数据，也不会把已删除的内容恢复回来。教程第 5、6 课会详细讲这一点。

## 1.7 身份与权限的四道关口

```mermaid
flowchart TB
  subgraph Staff["员工"]
    SC["cookie: opspilot_access（JWT，15 分钟）<br/>opspilot_refresh（7 天，单次有效）"]
    SA["StaffAuthorityService.current()<br/>Session 未撤销、未过期 + Membership 仍存在 → 当前角色"]
    SC --> SA
  end
  subgraph Attendee["观众"]
    AC["cookie: opspilot_attendee<br/>path 只限当前活动，12 小时"]
    AA["AttendeeAccessService.authenticate()<br/>会话有效 + 邮箱已验证 + 仍符合活动访问策略"]
    AC --> AA
  end
  SA --> EI["EventIdentityService.validate(tx, eventId, principal)<br/>事务内对 Session/Membership/Registration/AccessPolicy 加 FOR SHARE 锁"]
  AA --> EI
  EI --> Cap["各模块的能力计算<br/>chat: read/send/moderate<br/>topics: create/moderate/publish<br/>broadcast: view/manage/start/publish"]
  Cap --> T1["WebSocket：一次性 ticket（Redis）+ Origin 检查"]
  Cap --> T2["HLS：playback ticket（120 秒）+ cookie 身份必须一致"]
  Cap --> T3["RTMP：推流密钥（4 小时）由 MediaMTX 回调 API 校验"]
  Cap --> T4["MinIO：presigned URL（分片 60 秒）"]
```

**员工角色**（`WorkspaceRole`）：`ADMIN`、`OPERATIONS_MANAGER` 可以管理；`CONTENT_OPERATOR` 可以推流和管理媒体；`ANALYST`、`VIEWER` 只读。观众永远不会获得 workspace 权限。

## 1.8 数据模型（核心实体）

```mermaid
erDiagram
  Workspace ||--o{ WorkspaceMembership : has
  User ||--o{ WorkspaceMembership : joins
  User ||--o{ Session : "logs in"
  Workspace ||--o{ StreamEvent : owns
  StreamEvent ||--o| AccessPolicy : "access rule"
  StreamEvent ||--o{ RunbookItem : checklist
  StreamEvent ||--o{ ContentBlock : "watch page"
  StreamEvent ||--o{ EventRegistration : registers
  StreamEvent ||--o{ EventInvitation : invites
  EventRegistration ||--o{ AttendeeVerification : "email link"
  EventRegistration ||--o{ AttendeeSession : "admitted"
  StreamEvent ||--o| LiveSession : "operations"
  LiveSession ||--o{ LiveSessionUpdate : timeline
  LiveSession ||--o{ LivePoll : polls
  LivePoll ||--o{ LivePollOption : options
  LivePoll ||--o{ LivePollResponse : votes
  StreamEvent ||--o{ EventChatMessage : chat
  StreamEvent ||--o{ EventChatEvent : "chat journal"
  StreamEvent ||--o{ EventTopic : questions
  EventTopic ||--o{ EventTopicReply : replies
  StreamEvent ||--o{ BroadcastSession : broadcasts
  BroadcastSession ||--o{ BroadcastGrant : "publish / playback"
  Workspace ||--o{ MediaAsset : library
  MediaAsset ||--o{ MediaUpload : "upload attempts"
  MediaUpload ||--o{ MediaUploadPart : parts
  MediaAsset ||--o{ MediaProcessingJob : processing
  MediaAsset ||--o{ MediaVariant : "preview / thumbnail"
  StreamEvent ||--o{ EventMediaAsset : "attached media"
  MediaAsset ||--o{ EventMediaAsset : "reused by"
  StreamEvent ||--o{ DomainEvent : emits
  DomainEvent ||--o{ OutboxEvent : "to deliver"
```

需要先记住的三个区分：

1. **`LiveSession` 和 `BroadcastSession` 是两回事。** 前者是“活动正在运营”（时间线、Polls），后者是“视频正在推流”。结束直播不会结束运营。
2. **`MediaAsset` 属于 workspace，不属于某个活动。** 通过 `EventMediaAsset` 挂到多个活动上复用。
3. **员工（`User`）和观众（`EventRegistration`）是两套身份。** Chat 和 Topics 的作者字段只能二选一，由数据库的 CHECK 约束保证。

完整的 44 个模型见 `prisma/schema.prisma`。

## 1.9 后台任务（Worker）

```mermaid
flowchart LR
  subgraph API进程
    A1["媒体上传完成<br/>写 MediaProcessingJob（持久化意图）"]
    A2["业务事务内<br/>写 DomainEvent + OutboxEvent"]
    A3["登记 / 重发验证邮件"]
  end
  subgraph Redis_BullMQ["Redis（BullMQ）"]
    Q1["media-processing"]
    Q2["outbox"]
    Q3["webhook-delivery"]
    Q4["attendee-mail"]
    Q5["maintenance"]
  end
  subgraph Worker进程
    P1["MediaProcessingProcessor（并发 2）<br/>ffprobe → FFmpeg 预览 + 缩略图 → READY"]
    P2["OutboxProcessor → 生成 WebhookDelivery"]
    P3["WebhookDeliveryProcessor（并发 5）<br/>签名 · 重试 · 退避"]
    P4["AttendeeMailProcessor → SMTP"]
    P5["MediaCleanupProcessor<br/>清理过期上传和孤儿对象"]
  end
  A1 --> Q1 --> P1
  A2 --> Q2 --> P2 --> Q3 --> P3
  A3 --> Q4 --> P4
  Q5 --> P5
```

**设计原则：** “要做什么”先写进 PostgreSQL（持久化意图），再放进队列。即使 Redis 丢了任务、Worker 中途崩溃，恢复服务（`media-queue-recovery.service.ts`）和 outbox 调度器也能根据数据库中的记录把任务补回来。这就是 ADR-0004 中的“事务性 outbox”。

## 1.10 本地端口一览

| 服务 | 开发环境 | 测试环境（默认，可用 `OPSPILOT_TEST_*` 覆盖） |
| --- | --- | --- |
| Web / API | 3000 / 4100 | 3000 / 4100 |
| PostgreSQL | 5544 | 5546 |
| Redis | 6379 | 6381（chat）· 6394（broadcast）· 6402（media） |
| MinIO API / 控制台 | 9000 / 9001 | 9002 / 9003 |
| Mailpit SMTP / UI | 1025 / 8025 | 1026 / 8025 |
| MediaMTX RTMP / HLS / 控制 | 1937 / 8890 / 9999（可选） | 同左 |
