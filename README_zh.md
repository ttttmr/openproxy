# OpenProxy

[中文](README_zh.md) | [English](README.md)

> [!NOTE]
> 本项目由人类设计，Gemini 3 开发，未经过广泛测试

OpenProxy 是一个轻量级、零配置的网关，为 Claude Code 和 Gemini CLI 设计，让它们可以使用 OpenAI-Compatible API。

## 特性

- **双客户端支持**: 一个服务同时支持 Claude Code 和 Gemini CLI。
- **零服务端配置**: 服务器端无需配置，所有配置均由原始客户端控制。
- **支持多用户**: 无状态设计，支持多用户使用各自的 API Key。
- **Worker 部署**: 支持 Cloudflare Workers 和 Vercel 部署。

## 快速开始

### 1. 部署运行

**Docker:**

```bash
docker run -d -p 3000:3000 ttttmr/openproxy
```

**本地:**

```bash
npm install
npm run start
```

**Cloudflare Workers:**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fttttmr%2Fopenproxy)

**Vercel:**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fttttmr%2Fopenproxy)

### 2. 客户端配置

将你的客户端指向代理。目标 OpenAI Base URL 直接嵌入在路径中。

**格式:** `http://<proxy-host>/<target-openai-base-url>`

示例配置如下

#### Claude Code

```bash
export ANTHROPIC_BASE_URL="http://localhost:3000/https://openrouter.ai/api/v1"
export ANTHROPIC_AUTH_TOKEN="sk-..."
export ANTHROPIC_MODEL="gpt-6"
export ANTHROPIC_DEFAULT_OPUS_MODEL=$ANTHROPIC_MODEL
export ANTHROPIC_DEFAULT_SONNET_MODEL=$ANTHROPIC_MODEL
export ANTHROPIC_DEFAULT_HAIKU_MODEL=$ANTHROPIC_MODEL
export CLAUDE_CODE_SUBAGENT_MODEL=$ANTHROPIC_MODEL
```

#### Gemini CLI

```bash
export GOOGLE_GEMINI_BASE_URL="http://localhost:3000/https://openrouter.ai/api/v1"
export GEMINI_API_KEY="sk-..."
export GEMINI_MODEL="gpt-6"
```