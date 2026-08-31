# Bifrost AI Gateway 项目概览

## 项目简介

Bifrost 是一个高性能 AI 网关，统一 20+ LLM 提供商背后单一的 OpenAI 兼容 API，具有 ~11µs 开销，在 5,000 RPS 下运行。同时也作为 MCP (Model Context Protocol) 网关，将静态聊天模型转变为工具调用代理。

## 核心架构

### 1. 核心组件

- **核心库 (core/)**: Go 实现的网关引擎，包含 30+ 方法的 Provider 接口
- **框架 (framework/)**: 数据持久化、流处理、生态系统工具
- **传输层 (transports/)**: HTTP 网关传输，支持多种 SDK 集成
- **插件系统 (plugins/)**: 治理、遥测、日志等可扩展插件
- **UI**: React + Vite Web 界面
- **测试套件**: 核心测试、MCP 测试、E2E 测试

### 2. 关键特性

#### 高性能设计
- 使用 `fasthttp` 而非 `net/http` 进行提供商 HTTP 调用
- `sonic` JSON 库替代 `encoding/json`
- 处处使用对象池 (`sync.Pool`) 减少 GC 压力
- 通道模式而非互斥锁

#### 设计原则
- **Provider 隔离**: 每个提供商有自己工作池和队列
- **通道异步**: 使用 Go 通道进行请求路由
- **对象池化**: `sync.Pool` 包装器减少 GC 压力
- **插件管道对称**: Pre-hooks 按注册顺序，Post-hooks 按 LIFO 顺序
- **流式处理**: SSE 块流经 `chan chan *BifrostStreamChunk`

### 3. 请求流程

```
Client HTTP Request
  → FastHTTP Transport (解析、验证 ~2µs)
    → SDK 集成层 (格式转换)
      → 中间件链 (lib.ChainMiddlewares)
        → HTTPTransportPreHook (HTTP 级别插件)
          → PreLLMHook 管道 (认证、限流、缓存检查)
            → MCP 工具发现与注入
              → Provider 队列 (基于通道)
                → Worker 处理请求
                  → 密钥选择 (~10ns 权重随机)
                    → Provider API 调用
                      → 响应 / SSE 流
                → PostLLMHook 管道 (反向顺序)
              → 工具执行循环 (如果响应包含 tool_calls)
            → HTTPTransportPostHook (反向顺序)
          → 响应序列化
        → HTTP 响应给客户端
```

### 4. Provider 实现

有两种类型的提供商：

#### 类别 1: 非 OpenAI 兼容
- Anthropic, Bedrock, Gemini, Cohere 等
- 完整实现 (~8-10 个文件)
- 需要特定的 API 转换逻辑

#### 类别 2: OpenAI 兼容
- Groq, Cerebras, Ollama, Perplexity 等
- 最小实现，委托给 openai.HandleOpenAI* 函数
- 仅需构造函数

### 5. 插件系统

四种插件接口：

| 接口 | 钩子方法 | 调用时机 |
|------|---------|---------|
| `LLMPlugin` | `PreLLMHook`, `PostLLMHook` | 每个 LLM 请求 |
| `MCPPlugin` | `PreMCPHook`, `PostMCPHook` | 每个 MCP 工具执行 |
| `HTTPTransportPlugin` | `HTTPTransportPreHook`, `HTTPTransportPostHook` | HTTP 网关 |
| `ObservabilityPlugin` | `Inject(ctx, trace)` | 异步，响应写入后 |

### 6. 关键技术细节

#### BifrostContext
自定义 context.Context，具有线程安全的可变值：
- 保留键：由 Bifrost 内部设置 (auth、retry 状态等)
- 用户可设置键：虚拟密钥、API 密钥、请求 ID 等

#### 对象池
`Pool[T]` 支持两种模式：
- 生产：零开销 sync.Pool 包装器 (默认)
- 调试：跟踪双重释放、使用后释放、内存泄漏

#### 错误处理
每个提供商都有 ErrorConverter 函数：
```go
type ErrorConverter func(resp *fasthttp.Response, requestType schemas.RequestType, providerName schemas.ModelProvider, model string) *schemas.BifrostError
```

### 7. 开发工作流

#### 构建和测试
```bash
# 开发
make dev                                 # 全局本地开发 (UI + API 热重载)
make build                               # 构建 bifrost-http 二进制文件

# 核心测试 (提供商集成测试)
make test-core                           # 所有提供商
make test-core PROVIDER=openai          # 特定提供商
make test-core DEBUG=1                  # 使用 Delve 调试器

# 框架测试 (需要本地后端服务)
docker compose -f tests/docker-compose.yml up -d
make test-framework

# 代码质量
make lint                                # Lint 检查
make fmt                                 # 代码格式化
```

### 8. 项目结构亮点

- **多模块 Go 工作区**: 每个模块有自己的 go.mod
- **要求 Go 1.26.1**
- **配置模式**: `transports/config.schema.json` 是配置的唯一真实来源
- **E2E 测试**: Playwright 测试依赖于 `data-testid` 属性
- **文档**: Mintlify MDX 文档系统

### 9. 性能指标

- **延迟**: ~11µs 开销
- **吞吐量**: 5,000 RPS
- **内存**: 使用对象池减少 GC 压力
- **并发**: 基于通道的异步处理

### 10. 扩展性

添加新提供商的完整检查清单：
1. 创建 provider 目录和文件
2. 添加 ModelProvider 常量
3. 注册到 Bifrost
4. UI 集成 (图标、配置、文档等)
5. CI/CD 配置
6. 测试验证

这个项目设计精良，具有高性能、可扩展性和强大的插件系统，是构建统一 LLM 网关的理想选择。