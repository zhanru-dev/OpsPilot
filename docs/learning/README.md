# OpsPilot 学习手册

OpsPilot 是一个面向线上活动的运营平台：员工准备活动、上传和处理媒体、开启直播；观众登记入场后，在同一个观看页里看视频、聊天、提问和投票。它同时是一个**完整的全栈工程教学样本**，覆盖了 NestJS、Prisma/PostgreSQL、Next.js/React、WebSocket/SSE、对象存储、后台队列、FFmpeg、RTMP/HLS 直播，以及真实的测试和 CI。

## 目录

| 章节 | 内容 |
| --- | --- |
| [01 · 项目架构](01-architecture.md) | 运行时全景、请求管道、目录地图、前后端模块、通信方式、权限关口、数据模型、后台任务、端口 |
| [02 · 业务流程](02-business-flows.md) | 端到端旅程、活动状态机、就绪评分、观众入场、登录与续期、Chat、Topics、媒体上传与处理、直播、运营与通知 |
| [03 · 课程大纲](03-curriculum.md) | 23 课 + 3 个结业项目，每课列出目标、文件、配图和练习 |
| [04 · 代码质量体检](04-code-quality.md) | 适合教学的部分、读起来吃力的地方、分阶段整理计划 |
| **[05 · 从零搭建（主线课程）](05-build-from-scratch.md)** | **在新仓库里从空目录开始，44 课写完整个系统：业务代码、Docker、CI/CD、测试、部署** |

## 建议的学习方式

1. 先通读 01 和 02 的图，不用看懂每个细节，先建立“系统里有什么、数据怎么流动”的整体印象。
2. 按 **05** 的顺序上课：在新仓库 `opspilot-lab` 里从零写代码。本仓库是参考答案，每课做完再对照。
3. 03 是“读代码”的课程表，作为每课的参考阅读。
4. 每课结束后，在新仓库的 `notes/` 下记录自己的笔记，例如 `lesson-04.md`。
4. 遇到读不懂的地方，把文件路径和行号告诉老师，比如“`chat.service.ts` 第 203–257 行”。

## 先修知识

- **必需**：TypeScript 基础语法、HTTP 和 REST、SQL 基础（SELECT、JOIN、事务的概念）、React 组件和 hooks 的基本用法。
- **会在课程中讲**：NestJS 的依赖注入、Prisma、行锁和乐观并发、JWT 和 cookie、SSE 和 WebSocket、presigned URL、BullMQ、HLS。

## 跑起来

```sh
cp .env.example .env
npm ci
npm run services:up      # Postgres / Redis / MinIO / Mailpit
npm run db:generate
npm run db:deploy
npm run db:seed          # 演示数据；只对开发库执行
npm run dev              # Web :3000 · API :4100 · Worker
```

演示账号见仓库根目录 README 的 “Demo Accounts” 一节。跑测试前请先看 README 中 “Running tests beside a developer environment” 一节：测试使用独立的数据库和端口，不会碰你的开发数据。

## 和代码保持同步

本手册中的图和行数都基于当前 `main`。代码有结构性变化（新增模块、拆分文件、改变流程）时，请在同一个 PR 里更新对应的图和课程表。
