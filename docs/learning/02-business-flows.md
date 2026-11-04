# 02 · 业务流程

本章按“一场线上活动从准备到复盘”的顺序，画出每个关键业务流程。每张图下面列出它对应的代码入口，方便你对照阅读或在课上逐行讲解。

---

## 2.1 端到端产品旅程

```mermaid
flowchart TB
  A["员工登录<br/>/login"] --> B["创建活动<br/>DRAFT"]
  B --> C["配置活动 CONFIGURING<br/>访问策略 · 内容区块 · Runbook"]
  C --> D["准备媒体<br/>分片上传 → Worker 转码 → READY<br/>挂载到活动"]
  D --> E{"Launch Control<br/>就绪评分<br/>有阻断项吗？"}
  E -- 有 --> C
  E -- 没有 --> F["标记 READY<br/>开放观众登记"]
  F --> G["观众登记 → 邮件验证 → 入场<br/>获得观众会话"]
  F --> H["Go live → LIVE<br/>自动开启 LiveSession（运营会话）"]
  H --> I["准备直播 BroadcastSession<br/>生成推流密钥 → OBS 推流"]
  I --> J["Watch Room<br/>视频 + Chat + Topics + Polls"]
  G --> J
  H --> K["Live Operations 运营室<br/>时间线更新 · Poll 管理 · 管理 Chat/Topics"]
  J --> L["结束直播（视频停止，运营继续）"]
  K --> M["完成活动 COMPLETED<br/>关闭 LiveSession"]
  L --> M
  M --> N["复盘：Analytics 快照 · 审计日志<br/>Webhook 投递记录"]
  N --> O["归档 ARCHIVED（只读）"]
```

## 2.2 活动状态机

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> CONFIGURING
  DRAFT --> CANCELLED
  CONFIGURING --> READY: 就绪检查无阻断项
  CONFIGURING --> CANCELLED
  READY --> CONFIGURING: 退回修改
  READY --> LIVE: 再次检查就绪 + 开启 LiveSession
  READY --> CANCELLED
  LIVE --> COMPLETED: 结束 LiveSession
  COMPLETED --> ARCHIVED
  CANCELLED --> ARCHIVED
  ARCHIVED --> [*]
```

- 代码：`apps/api/src/events/events.service.ts` 的 `transitionMap` 和 `transition()`。
- 进入 READY 和 LIVE 前，都会调用 `ReadinessService.calculate()`。有 blocker 就返回 400，并附上阻断原因。
- 每次状态变化都会在**同一个事务**里写入 `DomainEvent`（例如 `event.ready`、`event.live`），后续触发 webhook（见 2.10）。
- **观众只能在 READY 和 LIVE 状态下登记和入场**（`attendee-eligibility.ts` 中的 `attendeeStates`）。

## 2.3 Launch Control 就绪评分

```mermaid
flowchart LR
  subgraph Criteria["6 项检查（readiness.service.ts）"]
    C1["指定了负责人"]
    C2["时间安排有效"]
    C3["配置了观众访问策略"]
    C4["准备了观看页内容"]
    C5["挂载了 READY 媒体"]
    C6["关键 Runbook 已完成"]
  end
  Criteria --> Score["加权得分 0–100"]
  Score --> S{"状态"}
  S -- "有 blocker" --> Blocked["BLOCKED<br/>不能进入 READY/LIVE"]
  S -- "100 分" --> Ready["READY"]
  S -- "其他" --> Risk["AT_RISK"]
```

评分是**确定性规则**（ADR-0002），可选的 AI 建议只是辅助，不参与判断（ADR-0005，`recommendations/`）。

## 2.4 观众登记与入场

```mermaid
sequenceDiagram
  autonumber
  actor V as 观众浏览器
  participant W as Web /events/:id/register
  participant API as API
  participant DB as PostgreSQL
  participant Q as Redis 队列
  participant WK as Worker
  participant M as 邮箱（Mailpit）

  V->>W: 填写姓名、邮箱（以及同意条款）
  W->>API: POST /public/events/:id/registrations
  API->>DB: 事务：检查活动状态 + 访问策略<br/>（PUBLIC/REGISTRATION/EMAIL_DOMAIN/INVITE_ONLY）
  alt 符合资格
    API->>DB: 创建 EventRegistration + AttendeeVerification（15 分钟）
    API->>Q: 投递验证邮件任务
  else 不符合资格（例如没被邀请）
    Note over API: 不创建任何记录，但仍返回同样的结果<br/>防止别人借此探测哪些邮箱已被邀请
  end
  API-->>V: { status: "RECEIVED" }
  Q->>WK: attendee-mail
  WK->>M: 发送带一次性链接的邮件
  V->>W: 点击邮件链接 /events/:id/confirm#token
  W->>API: POST /public/events/:id/attendee/verify
  API->>DB: 事务：token 未使用且未过期 → 标记已用<br/>删除旧会话，创建 AttendeeSession（12 小时）
  API-->>V: Set-Cookie opspilot_attendee（path 只限当前活动）
  V->>W: 进入 /events/:id/watch
```

- 代码：`event-registrations.service.ts` 的 `register()`、`attendee-access.service.ts` 的 `enqueue/verify/authenticate()`、`attendee-eligibility.ts`。
- **入场不等于成为 workspace 成员。** 观众 cookie 只对 `/api/v1/public/events/:id` 这一个活动有效。
- 在 INVITE_ONLY 模式下撤销邀请，或者活动离开 READY/LIVE，观众随后的每次请求都会被拒绝，因为每次都会重新检查资格。

## 2.5 员工登录、续期与当前权限

```mermaid
sequenceDiagram
  autonumber
  actor S as 员工浏览器
  participant API as API
  participant DB as PostgreSQL

  S->>API: POST /auth/login（邮箱 + 密码）
  API->>DB: argon2 校验密码；创建 Session（保存 refresh hash，7 天）
  API-->>S: Set-Cookie access（JWT 15 分钟）+ refresh（JWT 带唯一 jti）
  S->>API: GET /stream-events（带 access cookie）
  API->>API: AuthGuard 验证 JWT 签名（只取 sub、sessionId、workspaceId）
  API->>DB: StaffAuthorityService：Session 未撤销/未过期 + Membership 存在 → 当前角色
  API-->>S: 200（RolesGuard 按“当前角色”判断）
  Note over S,API: access 过期后，lib/api.ts 自动触发续期<br/>多个标签页之间用 Web Locks 串行
  S->>API: POST /auth/refresh
  API->>DB: 条件更新：只有 hash 仍是“刚才那一个”时才轮换<br/>旧 refresh 立即失效（单次有效）
  API-->>S: 新的 access + refresh
```

这一流程对应审计修复的 SYS-AUTH-01/03。可以对比 `git show d260eab`、`git show aed3495` 看修复前后的差异，它们是很好的安全案例。

## 2.6 Chat：发送、推送与断线恢复

```mermaid
sequenceDiagram
  autonumber
  participant C as 客户端 use-chat.ts
  participant API as REST
  participant R as Redis
  participant GW as ChatGateway（/chat）
  participant SVC as ChatService
  participant DB as PostgreSQL

  C->>API: POST /.../chat/ticket
  API->>R: 存一次性 ticket（30 秒，绑定身份、活动、频道）
  API-->>C: ticket
  C->>GW: connect(auth.ticket, Origin)
  GW->>R: 取出并删除 ticket；校验 Origin
  GW-->>C: chat.ready（context + watermark）
  C->>GW: chat.send {clientMessageId, text}（带 ack）
  GW->>SVC: send()
  SVC->>DB: 事务：锁住活动行 FOR UPDATE → 复核身份<br/>同一 clientMessageId 已存在则直接返回（幂等）<br/>chatSequence+1 → 写消息 + EventChatEvent 日志
  SVC-->>GW: 消息
  GW-->>C: ack {ok, data}
  SVC->>GW: changes.next(eventId)
  GW->>DB: 给每个连接按 cursor 回放日志（并复核权限）
  GW-->>C: chat.event（按 sequence 递增）
  Note over C: 断线重连：换新 ticket → 从上次的 sequence 继续回放<br/>按 id 和 sequence 去重，删除事件会把消息变成墓碑
```

- 前端状态：`features/chat/state.ts`（纯函数，可单独测试）+ `use-chat.ts`（连接管理）。
- **为什么要有日志表（journal）：** 只发“最新列表”的话，丢包、重连或乱序时客户端无法知道自己漏了什么；有了按 sequence 递增的事件日志，就能精确补齐。

## 2.7 Topics / Q&A：提问、审核、置顶

```mermaid
stateDiagram-v2
  [*] --> PENDING: 观众提问（开启了审核）
  [*] --> APPROVED: 员工提问，或关闭了审核
  PENDING --> APPROVED: 管理员审核通过
  PENDING --> Deleted: 删除
  APPROVED --> Pinned: 置顶（每个活动最多 7 个 slot）
  Pinned --> APPROVED: 取消置顶
  APPROVED --> Deleted: 删除（同时删除所有回复）
  Pinned --> Pinned: 删除被拒绝（必须先取消置顶）
  Deleted --> [*]
```

规则以及在哪里保证（**不只靠前端**）：

| 规则 | 保证方式 |
| --- | --- |
| 只有 APPROVED 能置顶 | `topics.service.ts` 的 `moderate()` + 数据库 CHECK `EventTopic_pin_check` |
| 每个活动最多 7 个置顶 | `pinSlot` 取值 1..7 + 唯一索引 `(eventId, pinSlot)` + 活动行 `FOR UPDATE` 串行化 |
| 两个管理员同时操作只有一个成功 | `expectedVersion` 乐观并发：版本号对不上 → 409 |
| 置顶中不能删除 | 服务端检查，返回 409 |
| 回复不会挂到已删除的问题上 | 同一把锁 + 父级 `deletedAt` 检查，返回 404 |
| 观众提问、回复的开关 | `topicSettings` 由后端执行，直接调 API 绕不过去 |

## 2.8 媒体：分片上传与处理

```mermaid
sequenceDiagram
  autonumber
  participant U as upload-queue.ts（最多 3 个文件并行）
  participant API as API multipart.service
  participant S3 as MinIO
  participant DB as PostgreSQL
  participant Q as BullMQ
  participant WK as Worker + FFmpeg

  U->>API: POST /media-assets/multipart {clientOperationId, sizeBytes, hashes（每个分片的 SHA-256）}
  API->>DB: 创建 MediaAsset(UPLOADING) + MediaUpload + S3 multipart
  loop 每个分片（5 MiB）
    U->>API: POST /:id/parts/:n
    API-->>U: presigned PUT URL（60 秒，带校验和）
    U->>S3: PUT 分片（浏览器直传）
    U->>API: POST /:id/parts/:n/confirm（服务端向 S3 核对该分片）
  end
  U->>API: POST /:id/complete
  API->>S3: CompleteMultipartUpload
  API->>DB: 事务：MediaAsset → PROCESSING + MediaProcessingJob（持久化意图）
  API->>Q: 入队（失败也没关系：恢复服务会根据数据库补回）
  Q->>WK: media-processing
  WK->>S3: 下载原件
  WK->>WK: ffprobe 校验 → 生成预览 + 缩略图
  WK->>S3: 上传派生文件
  WK->>DB: 带 fencing 的写入：MediaVariant + 状态 READY
  Note over U,API: 刷新页面后：读取上传记录 → 重新选择同一个文件 → 只补传缺失的分片
```

```mermaid
stateDiagram-v2
  [*] --> UPLOADING
  UPLOADING --> PROCESSING: complete 成功
  UPLOADING --> DELETED: 取消 / 过期清理
  PROCESSING --> READY: Worker 成功
  PROCESSING --> FAILED: 文件损坏 / 超出时长
  FAILED --> PROCESSING: 手动重试
  READY --> DELETED: 删除（对象异步清理）
```

- 每条 complete 和 cancel 请求都带 `clientOperationId`。响应丢了也可以安全重试，不会产生两个资产。
- **跨系统一致性不靠“分布式事务”：** PostgreSQL 记录“应该发生什么”，MinIO 和 BullMQ 的结果通过幂等键、状态条件和定期恢复（`media-queue-recovery.service.ts`、`media-cleanup.processor.ts`）达到最终一致。
- 代码里还保留着一套旧的单次 PUT 上传接口（`POST /media-assets/uploads`），只为兼容旧客户端，Web 端已经不再使用。

## 2.9 直播：准备 → 推流 → 观看 → 结束

```mermaid
sequenceDiagram
  autonumber
  actor Op as 运营人员
  participant API as API broadcast.service
  participant DB as PostgreSQL
  participant OBS as OBS / FFmpeg
  participant MTX as MediaMTX
  actor V as 观众（hls.js）

  Op->>API: POST /broadcast/sessions {expectedRevision, clientOperationId}
  API->>DB: 事务：锁活动 → 校验能力 start → 只允许一个 ACTIVE（部分唯一索引）
  Op->>API: POST /sessions/:id/publish-key
  API-->>Op: RTMP 地址 + 一次性推流密钥（4 小时，库里只存 hash）
  OBS->>MTX: RTMP publish live/:sessionId?user=publish&pass=…
  MTX->>API: POST /internal/broadcast/auth（Basic 认证的内部密钥）
  API->>DB: 密钥 hash 有效 + 推流人当前仍有 publish 能力？
  API-->>MTX: 200 允许 / 403 拒绝
  loop 每 2 秒 reconcile
    API->>MTX: 查询路径是否在线 → availability: WAITING / LIVE / INTERRUPTED / UNKNOWN
    API-->>V: 有变化时通过 Socket.IO 发 broadcast.snapshot
  end
  V->>API: POST /sessions/:id/playback
  API-->>V: playback ticket（120 秒，绑定观众身份，播放期间自动续期）
  V->>API: GET .../hls/index.m3u8?ticket=…（每个 playlist 和分片都要校验）
  API->>MTX: 用内部凭证取 HLS → 改写 playlist 中的地址后返回
  Op->>API: POST /sessions/:id/end {expectedRevision}
  API->>DB: 状态 ENDED，撤销所有授权
  API->>MTX: 踢掉推流端
  Note over Op,V: 结束的只是视频；活动仍是 LIVE，Chat、Topics、Polls 继续可用
```

**三种状态要分清**（审计 G2 的要求）：

1. **活动的运营状态**（`StreamEvent.status`）：由运营人员推进。
2. **直播的推流状态**（`BroadcastSession.availability`）：由 reconcile 循环观察 MediaMTX 得到。
3. **某个观众的播放状态**（暂停、静音、全屏）：只存在于这个观众的浏览器里，不影响其他人。

## 2.10 运营室、Polls 与事件通知

```mermaid
flowchart LR
  subgraph Ops["Live Operations（events/:id/live）"]
    SSE["SSE 快照，每 3 秒<br/>在 Session/Membership 共享锁内读取并发送"]
    Upd["时间线更新 POST /live-session/updates"]
    Poll["Poll：DRAFT → OPEN → CLOSED<br/>员工和观众都可以投票，每人一票，可修改"]
  end
  subgraph Notify["事件通知"]
    DE["DomainEvent<br/>（与业务写入在同一个事务里）"]
    OB["OutboxEvent → outbox 队列"]
    WH["WebhookDelivery<br/>HMAC 签名 · 最多 5 次指数退避"]
  end
  subgraph Review["复盘"]
    AN["Analytics 每日快照<br/>POST /analytics/refresh · CSV 导出"]
    AU["AuditLog"]
  end
  Upd --> SSE
  Poll --> SSE
  Ops --> DE --> OB --> WH
  Ops --> AN
  Ops --> AU
```

- 撤权后，SSE 会发送 `access-changed` 事件并关闭；客户端清空私有数据（SYS-AUTH-02）。
- 如果只是 SSE 连接断了，客户端保留数据并按退避间隔重连（CA-LIVEOPS-01）。这两种情况的处理方式不同，是很好的对照学习材料。
