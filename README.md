# OpenProxy

[中文](README_zh.md) | [English](README.md)

> [!NOTE]
> Designed by humans, developed by Gemini 3, not widely tested.

OpenProxy is a lightweight, zero-config gateway designed for **Claude Code** and **Gemini CLI**, enabling them to use OpenAI-Compatible APIs.

## Features

- **Dual Client Support**: One service supports both Claude Code and Gemini CLI.
- **Zero Server-Side Config**: No server-side configuration required; all settings are controlled by the original client.
- **Multi-User Support**: Stateless design allows multiple users to use their own API Keys.
- **Worker Deployment**: Supports deployment to Cloudflare Workers and Vercel.

## Quick Start

### 1. Deploy/Run

**Local:**

```bash
npm install
npm run start
```

**Cloudflare Workers:**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fttttmr%2Fopenproxy)

**Vercel:**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fttttmr%2Fopenproxy)

### 2. Client Configuration

Point your client to the proxy. The target OpenAI Base URL is embedded directly in the path.

**Format:** `http://<proxy-host>/<target-openai-base-url>`

Example configuration:

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
