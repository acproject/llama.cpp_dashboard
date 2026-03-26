# llama.cpp Orchestrator Dashboard

一个用于管理和调度多个 llama.cpp 服务实例的 Web 管理平台。

[![Next.js](https://img.shields.io/badge/Next.js-16.2.1-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.4-blue)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0.2-blue)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.2.2-38B2AC)](https://tailwindcss.com/)

## 功能特性

- **服务管理**: 注册、编辑、删除 llama.cpp 服务实例
- **负载均衡**: 支持轮询、加权、最少连接、基于能力等多种调度策略
- **健康检查**: 自动检测服务健康状态，支持自定义检查间隔
- **Nginx 集成**: 自动生成和管理 Nginx 反向代理配置
- **监控面板**: 实时查看系统状态、服务指标和性能数据
- **调度配置**: 灵活配置请求分发策略和健康检查参数

## 安全与部署建议

- 本系统默认面向内网/受控环境使用，Web UI 可能会索要 `sudo` 密码以便写入 `/etc/nginx/...` 并执行 `nginx -t` / `nginx -s reload`
- 如果需要部署到外网，建议优先使用 VPN + 堡垒机（或零信任网关）进行访问控制，不建议直接暴露管理界面

## 快速开始

### 环境要求

- Node.js 18+
- MiniMemory Server (端口 6379)
- Nginx (可选，用于反向代理)

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd llama.cpp_dashboard

# 安装依赖
npm install
```

### 开发运行

```bash
# 确保 MiniMemory Server 在端口 6379 运行
# 启动开发服务器
npm run dev
```

访问 http://localhost:3000

### 生产部署

```bash
# 构建项目
npm run build

# 启动生产服务器
npm start
```

## 项目结构

```
llama.cpp_dashboard/
├── app/                    # Next.js App Router
│   ├── api/               # API 路由
│   │   ├── dispatch/      # 调度配置 API
│   │   ├── monitor/       # 监控数据 API
│   │   ├── nginx/         # Nginx 配置 API
│   │   ├── services/      # 服务管理 API
│   │   └── status/        # 系统状态 API
│   ├── config/            # 调度配置页面
│   ├── debug/             # 调试页面
│   ├── monitor/           # 监控面板页面
│   ├── nginx/             # Nginx 配置页面
│   ├── services/          # 服务管理页面
│   ├── globals.css        # 全局样式
│   ├── layout.tsx         # 根布局
│   └── page.tsx           # 首页/系统总览
├── components/            # React 组件
│   ├── ui/               # UI 组件库 (基于 Radix UI)
│   └── sidebar.tsx       # 侧边栏导航
├── lib/                   # 工具库和业务逻辑
│   ├── health-check.ts   # 健康检查逻辑
│   ├── minimemory.ts     # MiniMemory 客户端
│   ├── nginx-manager.ts  # Nginx 配置管理
│   ├── orchestrator.ts   # 负载均衡调度器
│   └── utils.ts          # 通用工具函数
├── nginx/                 # Nginx 配置文件
│   ├── llama-orchestrator.conf
│   ├── nginx.conf
│   └── usage.md
├── types/                 # TypeScript 类型定义
│   └── index.ts
├── docs/                  # 文档
│   └── user-guide.md     # 用户使用手册
└── workspace/             # 本地依赖包
    └── minimemort-nodejs/ # MiniMemory Node.js 客户端
```

## 核心模块

### 1. 服务管理

管理服务实例的生命周期，包括：
- 服务注册与发现
- 状态监控
- 权重配置
- 能力标签管理

### 2. 负载均衡调度

支持多种调度策略：
- **Round Robin**: 轮询调度
- **Weighted**: 加权随机
- **Least Connections**: 最少连接优先
- **Capability-based**: 基于能力匹配

### 3. 健康检查

自动健康检查机制：
- 定期检查服务健康状态
- 检测 llama.cpp `/props` 端点
- 支持自定义检查间隔和超时

### 4. Nginx 配置管理

自动生成 Nginx 配置：
- Upstream 配置生成
- 负载均衡算法配置
- 代理参数设置
- 配置文件语法验证

## API 文档

### 服务管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/services` | 获取所有服务 |
| POST | `/api/services` | 创建服务 |
| PUT | `/api/services/:id` | 更新服务 |
| DELETE | `/api/services/:id` | 删除服务 |

### 调度配置

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/dispatch` | 获取调度配置 |
| POST | `/api/dispatch` | 更新调度配置 |

### Nginx 配置

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/nginx` | 获取 Nginx 配置 |
| POST | `/api/nginx` | 更新 Nginx 配置 |

### 系统状态

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/status` | 获取系统状态 |
| GET | `/api/monitor` | 获取监控数据 |

详细 API 文档请参考 [使用手册](docs/user-guide.md#api-接口文档)。

## 配置说明

### 调度配置

```typescript
interface DispatchConfig {
  strategy: 'round-robin' | 'least-connections' | 'weighted' | 'capability-based'
  defaultWeight: number        // 默认权重
  healthCheckInterval: number  // 健康检查间隔 (ms)
  healthCheckTimeout: number   // 健康检查超时 (ms)
  maxRetries: number          // 最大重试次数
  retryDelay: number          // 重试延迟 (ms)
}
```

### Nginx 配置

```typescript
interface NginxConfig {
  upstreams: NginxUpstream[]
  serverPort: number          // 监听端口
  proxyTimeout: number        // 代理超时 (秒)
  proxyBufferSize: string     // 缓冲区大小
}
```

## 技术栈

- **框架**: Next.js 16.2.1 (App Router)
- **前端**: React 19.2.4, TypeScript 6.0.2
- **样式**: Tailwind CSS 4.2.2
- **UI 组件**: Radix UI
- **图标**: Lucide React
- **数据存储**: MiniMemory (Redis 兼容)
- **反向代理**: Nginx

## 开发指南

### 代码规范

- 使用 TypeScript 进行类型检查
- 遵循 ESLint 配置
- 使用函数式组件和 Hooks

### 添加新页面

1. 在 `app/` 目录下创建新文件夹
2. 添加 `page.tsx` 文件
3. 在 `components/sidebar.tsx` 中添加导航项

### 添加 API 路由

1. 在 `app/api/` 下创建新文件夹
2. 添加 `route.ts` 文件
3. 实现相应的 HTTP 方法处理器

## 部署

### Docker 部署 (可选)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Nginx 部署

参考 [nginx/usage.md](nginx/usage.md) 进行 Nginx 配置部署。

## 故障排除

常见问题及解决方案请参考 [使用手册 - 故障排除](docs/user-guide.md#故障排除)。

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 许可证

[ISC](LICENSE)

## 相关链接

- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Next.js 文档](https://nextjs.org/docs)
- [使用手册](docs/user-guide.md)

---

**注意**: 本项目需要配合 llama.cpp 服务实例和 MiniMemory 数据存储服务使用。
