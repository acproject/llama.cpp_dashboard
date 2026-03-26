# llama.cpp Orchestrator Dashboard 使用手册

## 目录

1. [系统概述](#系统概述)
2. [快速开始](#快速开始)
3. [功能模块详解](#功能模块详解)
4. [API 接口文档](#api-接口文档)
5. [故障排除](#故障排除)

---

## 系统概述

llama.cpp Orchestrator Dashboard 是一个用于管理和调度多个 llama.cpp 服务实例的 Web 管理平台。它提供了服务管理、负载均衡调度、健康检查、Nginx 配置管理和实时监控等功能。

### 核心特性

- **服务管理**: 注册、编辑、删除 llama.cpp 服务实例
- **负载均衡**: 支持多种调度策略（轮询、加权、最少连接、基于能力）
- **健康检查**: 自动检测服务健康状态
- **Nginx 集成**: 自动生成和管理 Nginx 反向代理配置
- **监控面板**: 实时查看系统状态和服务指标

### 系统架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Dashboard  │────▶│ Orchestrator│────▶│ MiniMemory  │
│  (Next.js)  │     │ (调度层)     │     │  (数据存储)  │
└─────────────┘     └─────────────┘     └─────────────┘
                            │
                            ▼
                    ┌─────────────┐
                    │llama.cpp    │
                    │Services     │
                    └─────────────┘
```

---

## 快速开始

### 环境要求

- Node.js 18+
- MiniMemory Server (端口 6379)
- Nginx (可选，用于反向代理)

### 安装步骤

1. **克隆项目**

```bash
git clone <repository-url>
cd llama.cpp_dashboard
```

2. **安装依赖**

```bash
npm install
```

3. **启动 MiniMemory Server**

确保 MiniMemory Server 在端口 6379 上运行。

4. **启动开发服务器**

```bash
npm run dev
```

5. **访问 Dashboard**

打开浏览器访问 http://localhost:3000

### 生产部署

```bash
# 构建项目
npm run build

# 启动生产服务器
npm start
```

---

## 功能模块详解

### 1. 系统总览

系统总览页面展示整体运行状态，包括：

- **MiniMemory 连接状态**: 显示数据存储服务连接情况
- **服务总数**: 已注册的 llama.cpp 服务数量
- **在线服务**: 当前健康运行的服务数量
- **系统运行时间**: Dashboard 进程运行时长

**快速操作按钮**:
- 管理服务: 跳转到服务管理页面
- 查看监控: 跳转到监控页面
- Nginx 配置: 跳转到 Nginx 配置页面
- 刷新状态: 手动刷新系统状态

### 2. 服务管理

服务管理模块用于管理 llama.cpp 服务实例。

#### 添加服务

1. 点击"添加服务"按钮
2. 填写服务信息:
   - **名称**: 服务标识名称
   - **描述**: 服务用途说明
   - **主机**: 服务主机地址
   - **端口**: 服务端口号
   - **模型**: 加载的模型名称
   - **权重**: 负载均衡权重 (1-10)
   - **能力标签**: 服务支持的能力列表
3. 点击保存

#### 服务状态

- **online**: 服务正常运行
- **offline**: 服务离线
- **starting**: 服务启动中
- **stopping**: 服务停止中
- **error**: 服务错误

#### 编辑和删除

- 点击服务卡片上的编辑按钮修改服务信息
- 点击删除按钮移除服务（不可恢复）

### 3. 负载均衡调度

Dashboard 支持多种调度策略：

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| **round-robin** | 轮询调度，依次分配请求 | 服务性能相近 |
| **weighted** | 加权随机，按权重分配 | 服务性能差异大 |
| **least-connections** | 最少连接优先 | 长连接场景 |
| **capability-based** | 基于能力匹配 | 多模型场景 |

#### 配置调度策略

1. 进入"调度配置"页面
2. 选择调度策略
3. 设置默认权重
4. 配置健康检查间隔和超时时间
5. 保存配置

### 4. 健康检查

系统自动对服务进行健康检查：

- **检查间隔**: 默认 10 秒
- **检查超时**: 默认 5 秒
- **检查端点**: `/props` (llama.cpp 内置端点)

健康检查结果包括：
- 健康状态 (healthy/unhealthy)
- 响应时间
- 错误信息（如有）

### 5. Nginx 配置管理

Dashboard 可以自动生成 Nginx 反向代理配置。

#### 功能特性

- 自动生成 upstream 配置
- 支持多种负载均衡算法
- 自动同步在线服务
- 配置文件语法验证

#### 配置参数

- **监听端口**: Nginx 服务端口（默认 8080）
- **代理超时**: 请求超时时间（默认 300 秒）
- **缓冲区大小**: 代理缓冲区大小（默认 128k）

#### 部署配置

1. 在 Nginx 配置页面生成配置
2. 复制配置内容或下载配置文件
3. 部署到 Nginx 服务器:

```bash
# 测试配置文件语法
sudo nginx -t -c /path/to/nginx.conf

# 复制到 Nginx 配置目录
sudo cp /path/to/nginx.conf /etc/nginx/sites-available/llama-orchestrator

# 创建软链接启用配置
sudo ln -s /etc/nginx/sites-available/llama-orchestrator /etc/nginx/sites-enabled/

# 测试并重载
sudo nginx -t && sudo systemctl reload nginx
```

### 6. 监控面板

监控面板提供实时性能指标：

- **请求速率**: 每秒请求数 (RPS)
- **响应时间**: 平均响应时间
- **错误率**: 请求失败比例
- **资源使用**: GPU/CPU/内存使用率（如可用）
- **队列长度**: 待处理请求数量

---

## API 接口文档

### 服务管理 API

#### 获取所有服务

```http
GET /api/services
```

响应:
```json
{
  "success": true,
  "data": [
    {
      "id": "service-1",
      "name": "Llama Server 1",
      "host": "localhost",
      "port": 8081,
      "model": "llama-2-7b",
      "status": "online",
      "weight": 5,
      "capabilities": ["chat", "completion"]
    }
  ]
}
```

#### 创建服务

```http
POST /api/services
Content-Type: application/json

{
  "name": "New Service",
  "host": "localhost",
  "port": 8082,
  "model": "llama-2-13b",
  "weight": 3,
  "capabilities": ["chat"]
}
```

#### 更新服务

```http
PUT /api/services/:id
Content-Type: application/json

{
  "weight": 5,
  "status": "online"
}
```

#### 删除服务

```http
DELETE /api/services/:id
```

### 调度配置 API

#### 获取调度配置

```http
GET /api/dispatch
```

#### 更新调度配置

```http
POST /api/dispatch
Content-Type: application/json

{
  "strategy": "weighted",
  "defaultWeight": 1,
  "healthCheckInterval": 10000,
  "healthCheckTimeout": 5000
}
```

### Nginx 配置 API

#### 获取 Nginx 配置

```http
GET /api/nginx
```

#### 更新 Nginx 配置

```http
POST /api/nginx
Content-Type: application/json

{
  "serverPort": 8080,
  "proxyTimeout": 300,
  "proxyBufferSize": "128k"
}
```

### 系统状态 API

#### 获取系统状态

```http
GET /api/status
```

响应:
```json
{
  "success": true,
  "data": {
    "minimemory": {
      "connected": true
    },
    "services": {
      "total": 5,
      "online": 3,
      "offline": 2
    },
    "uptime": 3600
  }
}
```

### 监控数据 API

#### 获取监控数据

```http
GET /api/monitor
```

响应:
```json
{
  "success": true,
  "data": {
    "metrics": [
      {
        "serviceId": "service-1",
        "requestsPerSecond": 10.5,
        "avgResponseTime": 150,
        "errorRate": 0.01
      }
    ]
  }
}
```

---

## 故障排除

### 常见问题

#### 1. MiniMemory 连接失败

**症状**: 系统总览显示 MiniMemory 未连接

**解决方案**:
```bash
# 检查 MiniMemory 服务是否运行
netstat -tlnp | grep 6379

# 重启 MiniMemory 服务
# 根据你的安装方式执行相应命令
```

#### 2. 服务显示离线但实际运行正常

**症状**: Dashboard 显示服务离线，但直接访问服务正常

**可能原因**:
- 健康检查端点配置错误
- 网络连接问题
- API Key 配置错误

**解决方案**:
1. 检查服务配置中的主机和端口
2. 确认服务 `/props` 端点可访问
3. 检查 API Key 配置（如启用）

#### 3. Nginx 配置生成失败

**症状**: 无法生成或应用 Nginx 配置

**解决方案**:
1. 检查是否有在线服务
2. 验证配置语法
3. 检查 Nginx 服务状态

#### 4. 调度策略不生效

**症状**: 请求分配不符合预期

**解决方案**:
1. 检查调度配置是否保存成功
2. 确认服务权重设置
3. 查看服务健康状态

### 日志查看

Dashboard 日志输出到控制台。生产环境建议配置日志收集：

```bash
# 使用 pm2 运行并查看日志
pm2 start npm --name "llama-dashboard" -- start
pm2 logs llama-dashboard
```

### 性能优化建议

1. **健康检查间隔**: 根据服务数量调整，避免过于频繁的检查
2. **连接池**: 配置适当的 keepalive 连接数
3. **超时设置**: 根据模型推理时间调整代理超时
4. **缓存**: 对静态资源启用浏览器缓存

---

## 附录

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `MINIMEMORY_HOST` | MiniMemory 主机地址 | localhost |
| `MINIMEMORY_PORT` | MiniMemory 端口 | 6379 |
| `PORT` | Dashboard 服务端口 | 3000 |

### 技术支持

如有问题或建议，请通过以下方式联系：
- 提交 Issue: [项目仓库]
- 邮件支持: [支持邮箱]
