# 04 · 代码质量与“可教学性”体检

本章记录：作为教学材料，这份代码哪些地方已经很好、哪些地方读起来吃力，以及计划怎样整理。整理遵守三条原则：

1. **不改变业务行为**：每一步都有现成的测试作为安全网（单元 109 · API e2e 116 · 浏览器 30 + 12 + 12 + 5）。
2. **小步提交**：一次只做一类改动，每次改完都跑完整测试再合并。
3. **先整理，再上课**：要逐行讲的文件，先整理成“一屏能看懂一件事”的样子。

## 4.1 已经适合教学的部分

| 优点 | 例子 |
| --- | --- |
| 业务不变量写在数据库里，不只靠代码 | Topics 的 `pinSlot` 取值 1..7 + 唯一索引；Chat 作者字段二选一的 CHECK；每个活动最多一个 ACTIVE 直播的部分唯一索引 |
| 前后端共享协议类型 | `packages/*-contracts` |
| 状态逻辑写成纯函数，并有测试 | `features/chat/state.ts` + `tests/chat-state.test.ts`、`features/topics/state.ts` |
| 测试覆盖真实依赖 | API e2e 直接连 PostgreSQL、Redis、MinIO、FFmpeg、MediaMTX；浏览器测试做真实解码 |
| 有真实缺陷的修复记录 | 审计中的 P1/P2 缺陷都有“修复前失败、修复后通过”的回归测试 |
| 格式统一 | Prettier + ESLint，CI 强制执行 |

## 4.2 读起来吃力的地方（按影响排序）

| # | 问题 | 位置（行数） | 为什么影响教学 |
| --- | --- | --- | --- |
| Q1 | **一个 `useEffect` 装下整套连接逻辑** | `chat/use-chat.ts`：一个 effect 约 450 行、13 个可变闭包变量；`topics/use-topics.ts`（418）、`broadcast/use-broadcast.ts`（277）结构相同 | 逐行讲解时很难记住每个 `let` 变量在哪里被改过；没法单独写单元测试；同一套“ticket → 连接 → 就绪 → 收到通知后重新同步 → 退避 → 拒绝”的模式重复写了三遍 |
| Q2 | **超大组件** | `events/launch-control.tsx`（932，单个组件约 860 行）、`app/(app)/integrations/page.tsx`（646）、`topics/topics-panel.tsx`（739）、`chat/chat-panel.tsx`（470）、`streamops/media/page.tsx`（609） | 一个文件里同时放着数据请求、状态、表单和渲染，没法一节课讲完 |
| Q3 | **超大服务类** | `broadcast/broadcast.service.ts`（609：会话、授权、推流鉴权回调、reconcile 全在一起）、`media/media-processing.processor.ts`（650）、`event-topics/topics.service.ts`（622） | 职责太多，读的时候容易迷路 |
| Q4 | **写法紧凑** | 逗号连写的变量声明（`const a = …, b = …`）、多层嵌套三元表达式，主要在 broadcast、media、topics 中 | 读者要在脑子里自己拆开 |
| Q5 | **几乎没有“为什么”的注释** | 全部代码注释约占 0.5% | 加锁、事务、幂等这些地方，不说明原因很难看懂 |
| Q6 | **新旧两套上传接口并存** | `POST /media-assets/uploads`（旧的单次 PUT，Web 端已经不用）和 `/media-assets/multipart` | 学习时容易混淆该看哪一套 |
| Q7 | **只为演示存在的接口** | `POST /media-assets/:id/simulate-successful-retry` | 需要明确标注“仅用于演示” |

## 4.3 整理计划与进度

| 阶段 | 内容 | 风险 | 验证 |
| --- | --- | --- | --- |
| **R1 说明性注释** | 在加锁、事务、幂等键、fencing、授权边界这些位置加简短的“为什么”注释；不改任何逻辑 | 很低 | lint + typecheck |
| **R2 写法整理** | 把逗号连写的声明拆成多行，把嵌套三元改成具名的小函数或查表；加 ESLint 规则 `one-var: never`、`no-nested-ternary`，防止以后再出现 | 低 | 全部测试 |
| **R3 拆分大组件** | 把 Launch Control、Integrations、Topics、Chat 面板、Media 页面按区块拆成子组件，每个文件只做一件事；行为和 DOM 不变 | 低到中 | 浏览器测试（选择器不变）+ UI 隔离测试 |
| **R4 实时连接重构** | 把 Chat、Topics、Broadcast 共用的连接流程提取成一个不依赖 React 的 `EventChannelConnection`（显式状态机），三个 hook 各自缩到约 50 行；为连接器补上用假 socket 的单元测试 | **中到高**（最核心的实时代码） | 单元测试 + Chat 恢复 12 + Topics 11 + 直播 5 + 完整业务流程 |
| **R5 拆分后端服务** | broadcast 拆成会话、授权、推流回调、reconcile 几个服务；media 处理器拆成探测、转码、持久化几个步骤；对外接口不变 | 中 | 全部 API e2e |
| **R6 收敛接口**（可选） | 删除旧的单次上传接口，并把演示接口限制为 `DEMO_SEED_ALLOWED` 开启时才可用。属于产品决定，因为会删掉一条兼容性测试 | 中 | 媒体测试 |

**进度（分支 `refactor/teachability`）：**

| 阶段 | 状态 | 结果 |
| --- | --- | --- |
| R1 | 完成 | Chat、Topics、Broadcast、Readiness、Events 等服务在加锁、幂等、日志、修订号检查处有“为什么”注释 |
| R2 | 完成 | Web 与 API 的 ESLint 都启用了 `one-var: never` 和 `no-nested-ternary`，现有代码零违例 |
| R3 | 完成 | Launch Control（932 → 容器约 250 + 11 个小文件）、Integrations（646 → 190 + 6）、Media（609 → 276 + 5）、Topics 面板（739 → 4 个文件）；新增通用组件 `QueryState` |
| R4 | 放进课程 | 见下文 |
| R5 | 放进课程 | 见下文 |
| R6 | 待你决定 | — |

R4 和 R5 不在开课前做，而是放进课程：从零搭建时，我们先写一个最简单、能跑的版本（例如只有“连接 → 收消息”的 Chat hook），再按测试暴露的问题一步步加上重连、回放、撤权处理，最后对照现有实现，自己把重复的连接流程提取成 `EventChannelConnection`。这样比直接读一个已经重构好的状态机更容易理解每一行为什么存在。
