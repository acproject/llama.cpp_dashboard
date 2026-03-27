# 第一阶段实施清单：将 MiniMemory 升级为运行态控制平面

## 1. 文档目标

本清单基于《MiniMemory 在 llama.cpp_dashboard 中的定位与演进报告》，将第一阶段工作进一步拆解成可以直接进入开发排期的事项。

第一阶段的目标不是一次性做成完整多 Agent 平台，而是先把当前项目从“服务调度面板”升级为“具备运行态控制能力的 Agent Gateway 基础层”。

这一阶段聚焦四件事：

1. 为每次网关请求建立统一的 `runId`
2. 将路由、重试、上游选择、会话归属写入 MiniMemory
3. 建立真实的活跃请求计数与运行事件流
4. 增加最小可用的运行态查看入口与 API

## 2. 第一阶段范围

### 2.1 本阶段要做

- Run 级运行记录
- Session 到服务实例的归属记录
- 请求级事件流与审计数据
- 真实活跃请求计数
- 网关运行态查询 API
- 最小运行态页面入口

### 2.2 本阶段不做

- 完整 Agent Registry
- 完整 Task Dispatcher
- DAG 任务编排
- Evidence Search 接入业务主链路
- 多角色协作工作流 UI

## 3. 第一阶段产出物

本阶段建议交付 4 类产出物：

1. MiniMemory 新键空间
2. 运行态数据结构与类型定义
3. 查询与控制 API
4. 页面入口与调试界面

## 4. 键空间设计

本阶段以“运行态控制面”为中心，新增以下键空间。

### 4.1 Run 主记录

- `agent:run:<runId>`

用途：

- 保存单次请求或协作运行的主状态
- 保存请求入口、模型、session、当前服务实例、状态、耗时等核心字段

建议 TTL：

- 默认保留 24 小时

### 4.2 Run 事件流

- `agent:run:events:<runId>`

用途：

- 记录一次运行中的关键事件
- 例如 `received`、`routed`、`retried`、`completed`、`failed`

建议存储形式：

- List

建议 TTL：

- 默认保留 24 小时

### 4.3 Session 归属

- `agent:session:<sessionId>`
- `agent:session-route:<sessionId>:<modelKey>`

用途：

- 保存会话级归属信息
- 保存某个 session 对某个模型的最近路由结果

说明：

- 可以保留当前已有的 `llama:session-route:<session>:<model>`，但建议逐步补充一套更偏 Agent 语义的键

建议 TTL：

- 2 小时到 24 小时，按会话长度决定

### 4.4 服务活跃请求计数

- `agent:service:active:<serviceId>`
- `agent:service:total:<serviceId>`
- `agent:service:error:<serviceId>`

用途：

- 区分活跃并发、累计请求数、错误数
- 支撑真实的 least-connections、拥塞判断、熔断判断

建议 TTL：

- 活跃计数不设 TTL，由请求完成后显式回收
- 总量和错误量长期保留

### 4.5 Run 索引

- `agent:runs:recent`
- `agent:runs:by-session:<sessionId>`
- `agent:runs:by-service:<serviceId>`

用途：

- 方便页面快速拉取最近运行列表
- 支撑按 session、service 查询

建议存储形式：

- List

## 5. 数据结构设计

下面的数据结构建议作为第一阶段最小可用模型。

### 5.1 RunRecord

```ts
export interface RunRecord {
  id: string
  status: 'received' | 'routed' | 'running' | 'completed' | 'failed'
  upstreamPath: string
  method: string
  model?: string
  sessionId?: string
  sessionRouteKey?: string
  modelRouteKey?: string
  serviceId?: string
  serviceName?: string
  serviceHost?: string
  servicePort?: number
  schedulingMode?: 'direct' | 'enabled'
  candidateCount: number
  retryCount: number
  startedAt: number
  completedAt?: number
  latencyMs?: number
  error?: string
}
```

### 5.2 RunEvent

```ts
export interface RunEvent {
  runId: string
  type: 'received' | 'parsed' | 'routed' | 'retry' | 'completed' | 'failed'
  timestamp: number
  serviceId?: string
  serviceName?: string
  detail?: string
  metadata?: Record<string, unknown>
}
```

### 5.3 SessionRecord

```ts
export interface SessionRecord {
  sessionId: string
  currentRunId?: string
  lastRunId?: string
  lastModel?: string
  boundServiceId?: string
  updatedAt: number
}
```

### 5.4 ServiceRuntimeStats

```ts
export interface ServiceRuntimeStats {
  serviceId: string
  activeRequests: number
  totalRequests: number
  failedRequests: number
  lastRunAt?: number
  lastErrorAt?: number
}
```

## 6. API 设计

本阶段 API 以“观察运行态”为主，不引入复杂写入接口。核心写入由网关内部自动完成。

### 6.1 新增 API：运行列表

- `GET /api/runs`

用途：

- 返回最近运行记录
- 支持按 `sessionId`、`serviceId`、`status`、`model` 过滤

建议查询参数：

- `sessionId`
- `serviceId`
- `status`
- `limit`

响应结构建议：

```json
{
  "success": true,
  "data": {
    "items": [],
    "total": 0
  }
}
```

### 6.2 新增 API：运行详情

- `GET /api/runs/:id`

用途：

- 查看某一次运行的主记录
- 返回事件流、当前路由、重试信息

响应结构建议：

```json
{
  "success": true,
  "data": {
    "run": {},
    "events": []
  }
}
```

### 6.3 新增 API：Session 运行态

- `GET /api/sessions/:id`

用途：

- 查看某个 session 当前绑定的服务
- 查看最近一次运行和最后一次模型路由

### 6.4 新增 API：服务运行态统计

- `GET /api/runtime/services`

用途：

- 查看各服务实时活跃请求数
- 作为现有监控页的补充数据源

响应结构建议：

```json
{
  "success": true,
  "data": {
    "items": []
  }
}
```

### 6.5 可选调试 API：手动清理运行态

- `POST /api/runtime/cleanup`

用途：

- 清理过期 run 数据
- 用于调试环境排障

说明：

- 第一阶段可以先不做页面按钮，只保留内部接口或后置实现

## 7. 页面入口设计

当前侧边栏已有：

- 总览
- 服务监控
- 服务管理
- 服务调试
- 调度配置
- Nginx配置

第一阶段建议只新增 1 个页面入口，避免 UI 膨胀。

### 7.1 新增页面：运行态

- 路径：`/runs`
- 名称：`运行态`

页面职责：

- 展示最近运行记录
- 支持按状态、模型、服务过滤
- 展示 runId、sessionId、serviceId、重试次数、耗时、状态
- 支持点击进入详情

### 7.2 新增页面：运行详情

- 路径：`/runs/[id]`

页面职责：

- 展示一次运行的完整信息
- 展示事件时间线
- 展示最终路由到的上游服务
- 展示是否发生 busy 重试或候选切换

### 7.3 本阶段不新增独立 Session 页面

原因：

- 第一阶段应尽量收敛页面数量
- Session 查询可以先在运行详情和调试页面中体现

## 8. 代码改动点建议

下面是建议优先修改的文件与模块。

### 8.1 `types/index.ts`

新增：

- `RunRecord`
- `RunEvent`
- `SessionRecord`
- `ServiceRuntimeStats`

### 8.2 `lib/minimemory.ts`

新增：

- 运行态相关 key builder
- 计数器增减辅助函数
- 最近运行列表写入辅助函数
- 运行事件写入辅助函数

建议新增键生成函数：

- `RUN(id)`
- `RUN_EVENTS(id)`
- `SESSION(id)`
- `SESSION_ROUTE(sessionId, modelKey)`
- `SERVICE_ACTIVE(id)`
- `SERVICE_TOTAL(id)`
- `SERVICE_ERROR(id)`
- `RUNS_RECENT`
- `RUNS_BY_SESSION(id)`
- `RUNS_BY_SERVICE(id)`

### 8.3 `app/api/openai/v1/[...path]/route.ts`

这是第一阶段最核心的落点。

建议新增逻辑：

- 请求进入即生成 `runId`
- 写入 `received` 事件
- 解析成功后写入 `parsed` 事件
- 路由完成后写入 `routed` 事件
- 上游 busy 重试时写入 `retry` 事件
- 请求完成后写入 `completed` 或 `failed`
- 请求开始时递增活跃计数，请求结束时递减
- 同步更新总请求数、错误数、session 归属信息

### 8.4 `lib/orchestrator.ts`

建议调整：

- 将 `least-connections` 从“累计递增计数”改为“读取真实活跃请求数”
- 不再把请求总量误当作连接数

### 8.5 新增 API 路由

建议新增：

- `app/api/runs/route.ts`
- `app/api/runs/[id]/route.ts`
- `app/api/sessions/[id]/route.ts`
- `app/api/runtime/services/route.ts`

### 8.6 新增页面

建议新增：

- `app/runs/page.tsx`
- `app/runs/[id]/page.tsx`

### 8.7 `components/sidebar.tsx`

建议新增导航项：

- `运行态` -> `/runs`

## 9. 可开发任务拆分

以下任务拆分可直接进入开发迭代。

### 任务 1：补齐运行态类型定义

目标：

- 在类型层建立 Run / Session / RuntimeStats 最小模型

改动范围：

- `types/index.ts`

验收标准：

- 新类型可被 API 与页面直接复用

### 任务 2：扩展 MiniMemory 键空间与辅助方法

目标：

- 在存储层补齐 run、session、active counter、event list 等键工具

改动范围：

- `lib/minimemory.ts`

验收标准：

- 可以通过统一 helper 完成写入与读取
- 不在业务代码里硬编码键名

### 任务 3：在网关接入 run 生命周期写入

目标：

- 为每次网关请求自动生成运行记录

改动范围：

- `app/api/openai/v1/[...path]/route.ts`

验收标准：

- 每次请求都能生成 `runId`
- 成功请求可查询到完整生命周期
- 失败请求也能落盘错误事件

### 任务 4：修正真实活跃请求计数

目标：

- 让 least-connections 基于活跃请求数，而不是总请求数

改动范围：

- `lib/orchestrator.ts`
- `app/api/openai/v1/[...path]/route.ts`

验收标准：

- 请求开始时活跃计数增加
- 请求结束时活跃计数回收
- 调度策略读取的是当前活跃计数

### 任务 5：新增运行态查询 API

目标：

- 提供运行列表、运行详情、会话状态、服务运行态统计接口

改动范围：

- `app/api/runs/route.ts`
- `app/api/runs/[id]/route.ts`
- `app/api/sessions/[id]/route.ts`
- `app/api/runtime/services/route.ts`

验收标准：

- 页面无需直接访问底层存储
- 查询接口结构统一为现有 `success/data/error` 风格

### 任务 6：新增运行态页面

目标：

- 给调试与运维提供最小可用运行态可视化入口

改动范围：

- `app/runs/page.tsx`
- `app/runs/[id]/page.tsx`
- `components/sidebar.tsx`

验收标准：

- 能查看最近运行记录
- 能查看某次运行的事件时间线
- 能识别 busy 重试与最终上游

## 10. 建议开发顺序

建议按下面顺序实施：

1. 类型定义
2. MiniMemory key helper
3. 网关 run 生命周期接入
4. 活跃请求计数修正
5. 查询 API
6. 页面入口与运行详情

这样做的好处是：

- 先把数据写出来
- 再把数据查出来
- 最后再把数据展示出来

## 11. 第一阶段完成标准

当下面条件全部成立时，可以认为第一阶段完成：

- 每次网关调用都有可追踪 `runId`
- 每次运行都有状态、路由、重试、耗时记录
- session 与服务实例归属可查询
- least-connections 已切换到真实活跃请求计数
- 页面可查看最近运行列表与详情
- MiniMemory 已从“配置存储”升级为“运行态控制平面”

## 12. 第一阶段完成后的下一步

第一阶段完成后，项目就会具备多 Agent 演进所需的基础运行面。  
第二阶段再继续引入：

- `AgentProfile`
- Agent 与 Service 映射
- Graph 关系建模
- 能力与工具索引

到那时，系统就会从“运行态控制平面”继续升级为“轻量 Agent Registry + Gateway”。
