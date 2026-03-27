# MiniMemory 在 llama.cpp_dashboard 中的定位与演进报告

## 1. 报告结论

当前项目已经把 MiniMemory 用成了一个稳定的运行时状态存储层，但还没有把它充分升级为多 Agent 协作场景下的“共享记忆底座”。

从现状看，MiniMemory 在项目里主要承担了 4 类职责：

1. 服务注册数据存储
2. 调度配置与路由状态存储
3. 健康检查与监控状态缓存
4. 轻量计数器与临时会话粘性状态保存

这说明项目已经具备成为 Agent 中枢的关键前提：有统一入口、有统一状态层、有调度网关、有模型服务抽象。

如果后续希望项目在多 Agent 协作中起到关键作用，最值得做的不是替换掉 MiniMemory，而是进一步把它升级成下面四个层次的共享底座：

- Agent Gateway 的实时路由状态层
- Agent Registry 的能力与关系索引层
- Task Dispatcher 的任务状态与执行队列层
- Collaboration Memory Hub 的共享记忆与证据检索层

简化判断：

- 现在的 MiniMemory：偏“运行态控制数据存储”
- 未来的 MiniMemory：应升级为“多 Agent 协作控制平面 + 共享记忆平面”

## 2. 当前项目里 MiniMemory 已经在做什么

### 2.1 作为服务注册与配置存储

项目中的服务实例、调度配置、Nginx 配置等都通过 MiniMemory 保存。核心键空间定义集中在 `lib/minimemory.ts`：

- `llama:service:<id>`
- `llama:metrics:<id>`
- `llama:health:<id>`
- `llama:dispatch:config`
- `llama:nginx:config`
- `llama:session-route:<session>:<model>`
- `llama:replica-rr:<replicaGroup>`

这说明 MiniMemory 已经是项目的控制面存储，而不只是一个缓存。

### 2.2 作为调度状态存储

调度模块会从 MiniMemory 读取服务列表、配置副本组、记录轮询状态和请求计数。也就是说，当前系统的服务调度决策并不完全驻留在进程内，而是依赖 MiniMemory 的共享状态。

这对后续扩展成多 Agent 调度中心非常重要，因为：

- 单机内存状态无法支撑多进程、多节点控制平面
- 多 Agent 协作天然需要共享状态与可恢复状态

### 2.3 作为会话粘性路由存储

OpenAI 兼容网关里已经用 MiniMemory 保存了 session 与 model 的路由结果，并给了 2 小时 TTL。

这意味着项目已经具备了一种很关键的能力：把“某个请求上下文应该落到哪个执行节点”这类运行态决策持久化下来。

这个能力未来可以直接扩展为：

- Agent 会话归属
- 多轮协作上下文归属
- 子任务执行节点归属
- 长任务恢复点绑定

### 2.4 作为健康与监控状态缓存

健康检查结果、部分监控数据结构都通过 MiniMemory 读写。当前监控闭环还不强，但数据面已经存在。

这类数据后续可以演进成：

- Agent SLA 状态
- Worker 健康度评分
- 工具调用失败率
- 模型负载热度
- 任务拥塞程度

## 3. 当前还没有真正用起来的 MiniMemory 能力

虽然项目已经封装了多类 MiniMemory 能力，但业务层目前只主要使用了 KV、计数器、列表、TTL 这些基础能力。更高级的能力还没有真正进入调度主链路。

### 3.1 Meta / Tag / Graph 能力已具备，但尚未纳入业务核心

在 `lib/minimemory.ts` 中，项目已经提供了：

- `metaset`
- `metaget`
- `tagadd`
- `graphAddEdge`
- `graphDelEdge`
- `graphHasEdge`

这些接口非常适合多 Agent 场景，但当前业务代码中基本还没有把它们用于：

- Agent 能力图谱
- 任务依赖图
- 工具依赖图
- 知识块归属关系
- 协作者关系图

### 3.2 Evidence Search 能力在底层客户端存在，但还没进入项目应用层

MiniMemory 底层客户端已经包含 `EVIDENCE.SEARCHF` 能力，这意味着它不仅能做 KV/图关系，还能承载“向量证据召回”。

这对多 Agent 协作特别重要，因为协作系统常见瓶颈不是“有没有模型”，而是：

- 多个 Agent 是否能共享同一份事实依据
- 新 Agent 接手时是否能快速拿到历史证据
- Planner / Executor / Reviewer 是否能基于同一证据集合工作

目前项目还没有把这部分能力正式接入 API 与编排逻辑，因此 MiniMemory 的上限还远没发挥出来。

## 4. MiniMemory 与四个目标定位如何结合

## 4.1 与 Agent Gateway 结合

### 当前基础

项目已经有 OpenAI 兼容网关，具备：

- 统一入口
- 按模型选路
- 会话粘性
- 副本组调度
- Busy 重试与回退

这意味着 Agent Gateway 的“入口层”已经有雏形。

### MiniMemory 在这一层的作用

MiniMemory 可以成为 Gateway 的实时控制状态层，负责保存：

- Agent 会话到上游模型实例的路由映射
- 某个 Agent 的最近调用上下文摘要
- 请求级 trace / run 状态
- 限流计数器与配额状态
- 熔断、降级、重试窗口
- 幂等键与去重记录

### 建议新增的数据模型

- `agent:session:<sessionId>`：当前会话信息
- `agent:route:<agentId>:<model>`：最近路由决策
- `agent:run:<runId>`：一次完整调用或协作运行的元数据
- `agent:quota:<agentId>`：额度、并发、速率限制
- `agent:circuit:<target>`：熔断器状态

### 价值

这样做之后，网关就不再只是“请求转发层”，而会升级为：

- 可恢复
- 可观测
- 可限流
- 可审计
- 可协作继承上下文

## 4.2 与 Agent Registry 结合

### 当前基础

项目已经有服务注册机制，服务结构中也已有：

- `capabilities`
- `model`
- `supportsTools`
- `replicaGroup`
- `primaryReplica`
- `metadata`

这天然接近 Agent Registry 的雏形，只不过当前登记对象还是“模型服务实例”，还不是“Agent 实体”。

### MiniMemory 在这一层的作用

MiniMemory 可以从“服务注册库”升级为“Agent 注册中心”，除了保存基础元数据，还可以管理关系与索引。

适合存储的信息包括：

- Agent 标识、角色、职责
- 输入输出契约
- 支持的模型与工具
- 依赖哪些上游 Agent 或工具
- 拥有哪些记忆空间
- 最近成功率、平均延迟、成本表现

### 最适合用到的 MiniMemory 能力

- KV：保存 Agent 主档案
- Meta：保存结构化字段
- Tag：按能力、部门、场景打标签
- Graph：描述 Agent 与工具、任务、知识库之间的关系

### 建议图关系

- `agent:planner USES tool:web-search`
- `agent:reviewer DEPENDS_ON agent:planner`
- `agent:coder CAN_CALL model:qwen-coder`
- `agent:analyst OWNS memoryspace:research`

### 价值

当 Registry 建好后，系统就能做：

- 按能力找 Agent
- 按关系决定协作链
- 按历史表现做动态路由
- 按标签筛选可用执行单元

## 4.3 与 Task Dispatcher 结合

### 当前基础

当前项目已经有服务级 dispatch，但没有任务级 dispatch。

现有 dispatch 更像：

- 为一次请求选一个模型服务

而未来 Task Dispatcher 需要处理的是：

- 为一个任务选一组 Agent
- 维护任务状态机
- 处理依赖、重试、回滚、接管

### MiniMemory 在这一层的作用

MiniMemory 很适合做轻量任务控制面，尤其适合保存：

- 任务主状态
- 子任务拆分结果
- 执行权租约
- 优先级与重试次数
- 任务依赖边
- 事件日志

### 建议新增的数据模型

- `task:<taskId>`：任务定义与当前状态
- `task:children:<taskId>`：子任务列表
- `task:lease:<taskId>`：当前执行者与租约过期时间
- `task:event:<taskId>`：状态变化事件流
- `task:result:<taskId>`：任务输出

### 最适合用到的 MiniMemory 能力

- KV：任务状态
- List：事件流、审计记录
- Counter：重试次数、排队计数
- TTL：租约与超时控制
- Graph：任务依赖 DAG

### 价值

这会让项目从“服务调度器”升级为“任务编排器”。  
也是它能否真正成为多 Agent 协作中枢的分水岭。

## 4.4 与 Collaboration Memory Hub 结合

### 当前基础

当前项目还没有真正意义上的共享记忆中心，但 MiniMemory 已经提供了实现它的关键能力：

- Meta
- Tag
- Graph
- Embedding/Evidence Search

### MiniMemory 在这一层的作用

这是最值得投入的方向。MiniMemory 可以承担多 Agent 协作时的共享记忆枢纽，保存：

- 对话阶段摘要
- 任务事实清单
- 工具调用结果
- 中间工件
- 证据块与来源
- 评审意见与纠错记录

### 最典型的协作模式

1. Planner 将任务拆解并写入任务图
2. Research Agent 把证据块写入 chunk / tag / graph / embedding
3. Coder Agent 检索相关证据后执行
4. Reviewer Agent 基于同一批证据与工件做审查
5. 最终结果与执行轨迹归档，供后续复用

### 建议的记忆结构

- `memory:run:<runId>:summary`：本轮协作摘要
- `memory:artifact:<artifactId>`：中间工件
- `memory:fact:<factId>`：结构化事实
- `__chunk:<docId>:<idx>`：证据切片
- `__emb:<space>:<id>`：证据向量

### 推荐图关系

- `run:<runId> PRODUCED artifact:<artifactId>`
- `artifact:<artifactId> DERIVED_FROM __chunk:<docId>:<idx>`
- `agent:<agentId> VERIFIED fact:<factId>`
- `task:<taskId> USES_EVIDENCE __chunk:<docId>:<idx>`

### 价值

一旦这层建立起来，系统就不再依赖单个 Agent 的“瞬时上下文”，而是形成真正的可继承、可搜索、可复盘、可共享的协作记忆。

## 5. 对这个项目最现实的结合方式

不建议一上来把项目改造成一个庞大的“全功能 Agent 平台”，那样会让当前已有的网关和运维面价值被冲淡。

更合适的做法是保留现有定位，并逐层增强。

### 第一层：先把 MiniMemory 从“配置库”升级为“运行态控制库”

建议优先补齐：

- 请求 / 运行 trace 结构
- 活跃连接与真实并发计数
- 重试历史
- 熔断与限流状态
- 任务 / 运行事件日志

这一层改动最小，但对系统中枢能力提升最大。

### 第二层：引入 Agent Registry

在现有 `LlamaService` 旁边新增 `AgentProfile` 概念，但不要替代服务注册。  
服务仍然代表执行基础设施，Agent 则代表协作角色。

建议形成二层模型：

- Service：模型服务实例
- Agent：协作角色与能力单元

二者关系可以通过图或映射保存：

- `agent:<id> RUNS_ON service:<id>`
- `agent:<id> PREFERS model:<name>`

### 第三层：把 dispatch 从“选服务”扩展成“选 Agent + 选服务”

未来一次请求不应只决定发往哪个模型服务，而应经过两段式决策：

1. 先决定由哪个 Agent / 角色接手
2. 再决定这个 Agent 使用哪个服务实例执行

这样现有 orchestrator 就能继续保留，只是在它前面增加一个 Agent 调度层。

### 第四层：把共享记忆做成系统默认能力

建议规定所有 Agent 协作默认产出四类数据：

- 运行摘要
- 事实集合
- 工件集合
- 证据引用集合

这些数据统一写入 MiniMemory，后续任何 Agent 都可以基于同一份共享记忆工作。

## 6. 建议的键空间规划

下面是一份适合本项目后续扩展的键空间建议。

### 6.1 保留当前键空间

- `llama:service:<id>`
- `llama:metrics:<id>`
- `llama:health:<id>`
- `llama:dispatch:config`
- `llama:session-route:<session>:<model>`

### 6.2 新增 Agent Registry 键空间

- `agent:profile:<agentId>`
- `agent:status:<agentId>`
- `agent:capabilities:<agentId>`
- `agent:toolset:<agentId>`
- `agent:model-policy:<agentId>`

### 6.3 新增 Task Dispatcher 键空间

- `task:<taskId>`
- `task:event:<taskId>`
- `task:lease:<taskId>`
- `task:queue:<queueName>`
- `task:result:<taskId>`

### 6.4 新增共享记忆键空间

- `memory:run:<runId>:summary`
- `memory:fact:<factId>`
- `memory:artifact:<artifactId>`
- `memory:index:<space>:<id>`
- `__chunk:<docId>:<idx>`
- `__emb:<space>:<id>`

## 7. 近期落地优先级建议

### P1：最先做

- 为网关请求生成 `runId`
- 将路由结果、重试信息、上游选择记录写入 MiniMemory
- 记录真实活跃请求数，而不是只做递增计数
- 记录 Agent / 会话 / run 的统一关联键

### P2：接着做

- 增加 `AgentProfile` 数据模型
- 建立 Agent 与 Service 的映射
- 为 Agent 增加 capability、toolset、model policy
- 用 Graph 记录 Agent 间关系

### P3：第三阶段做

- 为任务拆分增加任务状态机
- 用 Graph 维护任务依赖
- 用 List 保存任务事件流
- 用 TTL + lease 实现抢占与超时恢复

### P4：第四阶段做

- 为知识块接入 chunk / embedding 存储
- 接入 Evidence Search
- 建立事实、工件、证据三类共享记忆结构
- 让 Planner / Executor / Reviewer 共用同一记忆空间

## 8. 最终判断

MiniMemory 对这个项目的价值，不只是“存服务配置”，而是可以成为整个系统向多 Agent 协作中枢演进时最关键的基础设施。

它与当前项目的结合点非常自然，因为项目已经有：

- 统一模型调用入口
- 统一服务注册模型
- 已经存在的调度逻辑
- 已经接好的状态存储层

所以最佳路线不是更换技术栈，而是升级使用方式：

- 短期把 MiniMemory 用成运行态控制平面
- 中期把 MiniMemory 用成 Agent Registry + Task Dispatcher 的状态底座
- 长期把 MiniMemory 用成 Collaboration Memory Hub 的共享记忆与证据检索底座

一句话概括：

MiniMemory 在这个项目里最有潜力扮演的角色，不是一个普通数据库，而是多 Agent 系统里的“状态总线 + 关系图谱 + 协作记忆中心”。
