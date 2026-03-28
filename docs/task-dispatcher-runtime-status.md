# Task Dispatcher / Runtime Monitor 当前实现整理

## 1. 当前目标

当前这条链路已经从“请求转发 + 服务监控”推进到了“可观测任务编排 + 可拉取执行”的阶段，主要覆盖三件事：

1. OpenAI 兼容网关为每次请求自动创建根任务，并把请求生命周期映射成任务事件
2. 任务模型支持队列、租约、结果与子任务，能够从“自动生成任务”升级成“可拉取执行任务”
3. 监控页已经接入任务运行态，开始具备面向执行器的操作基础

## 2. 当前数据模型

任务相关状态目前统一落在 MiniMemory，核心键空间如下：

- `task:<taskId>`：任务主记录
- `task:events:<taskId>`：任务事件流
- `task:children:<taskId>`：子任务列表
- `task:lease:<taskId>`：任务租约
- `task:result:<taskId>`：任务执行结果
- `task:queue:<queueName>`：任务队列

主记录 `TaskRecord` 已包含以下编排字段：

- `status`：`pending / queued / running / completed / failed / cancelled`
- `queueName`
- `requestedAgentId`
- `assignedAgentId / assignedAgentName`
- `parentTaskId / rootTaskId / childrenCount`
- `retryCount / maxRetries`
- `dependsOnTaskIds`
- `claimedAt / startedAt / completedAt`

运行态视图 `TaskRuntimeView` 在主记录基础上进一步聚合：

- `lease`
- `result`
- `queueDepth`
- `isClaimable`

## 3. 网关调度现状

OpenAI 网关的主链路已经具备如下行为：

- 进入网关后自动创建根任务
- 为请求路由、重试、候选切换写入任务事件
- 为每次上游尝试创建 `service_attempt` 子任务
- 为执行中的任务写入租约与最终结果
- 在响应头补充 `x-orchestrator-task-id`

调度策略已经从“直接选 Service”扩展成“先选 Agent，再按 Agent 约束选 Service”：

- 若请求显式指定 `agentId / x-agent-profile`，优先使用指定 Agent
- 若请求未指定 Agent，则会根据模型、Agent 默认模型、偏好服务与能力匹配进行自动选 Agent
- 选中 Agent 后，再通过 `serviceIds` 与 `capabilities` 约束服务候选集
- 服务层仍保留原有的 weighted / least-connections / round-robin 行为

请求中的能力约束目前支持从以下位置推导：

- `requiredCapabilities`
- `required_capabilities`
- `metadata.requiredCapabilities`
- `metadata.required_capabilities`
- `x-agent-capabilities`
- `tools` 非空时自动附加 `tools`

## 4. 任务执行模型现状

目前任务已具备“可拉取执行”的最小闭环：

- `queueTask(taskId)`：把任务放入指定队列并切换为 `queued`
- `claimTask(taskId)`：显式认领指定任务并创建租约
- `claimNextTask()`：按队列顺序查找可认领任务并认领
- `releaseTaskLease(taskId)`：释放租约
- `setTaskResult(taskId)`：写入结果并同步任务状态

`claimNextTask()` 目前具备以下判定逻辑：

- 只从指定 `queueName` 中取任务
- 会跳过不存在任务、脏数据和不可认领任务
- 会检查依赖任务是否已经满足
- 会检查租约是否过期或被别人持有
- 若任务声明了 `requestedAgentId`，认领时会做匹配约束

## 5. 当前 API 面

### 5.1 查询类

- `GET /api/runtime/tasks`
  - 返回任务列表、租约、结果、队列统计和状态摘要
- `GET /api/tasks`
  - 支持按 `status / queueName / parentTaskId / runId / sessionId / assignedAgentId / requestedAgentId` 过滤
- `GET /api/tasks/:id`
  - 返回任务详情聚合视图
- `GET /api/tasks/:id/events`
- `GET /api/tasks/:id/children`
- `GET /api/tasks/:id/lease`
- `GET /api/tasks/:id/result`

### 5.2 动作类

- `POST /api/tasks/:id/queue`
- `POST /api/tasks/:id/claim`
- `POST /api/tasks/claim-next`
- `POST /api/tasks/:id/complete`
- `POST /api/tasks/:id/fail`
- `PUT /api/tasks/:id/lease`
- `DELETE /api/tasks/:id/lease`
- `PUT /api/tasks/:id/result`
- `DELETE /api/tasks/:id/result`

## 6. 监控页现状

监控页当前已经增加 Task 面板，并展示：

- 任务总数、排队数、执行中数、持有租约数、队列数
- 每个队列的 `depth / claimable / running / updatedAt`
- 每条任务的状态、优先级、队列、Agent、Run、Session、租约、结果和错误
- 执行器操作区，可直接填写执行器 ID 与默认队列
- 队列级 `claim next`
- 任务级 `release / complete / fail`

运行态监控接口 `/api/monitor` 也已经把任务聚合进总览摘要：

- `activeTasks`
- `queuedTasks`
- `totalTasks`
- `leasedTasks`
- `tasks`
- `taskQueues`

## 7. 当前已知边界

当前实现已经具备编排闭环雏形，但仍有几个边界点：

- 任务队列还没有独立 worker 进程，当前主要通过 API 拉取模拟执行器行为
- 任务结果与租约释放还可以进一步收敛为更原子的执行器动作接口
- 监控页虽然能看任务，但面向执行器的操作流还需要补 claim next / release / complete / fail 的直接入口
- Agent 选择目前是基于规则与匹配分数，后续还可以引入负载、成功率与历史命中率

## 8. 下一步建议

建议将下一阶段聚焦为“执行器状态增强”：

1. 增加执行器最近操作历史与失败原因聚合
2. 支持队列筛选、批量认领和批量释放
3. 增加任务详情抽屉，直接查看事件流与子任务树
4. 为 Agent 自动选路补充更强的负载与成功率反馈
