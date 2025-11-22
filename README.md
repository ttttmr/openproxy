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

```bash
npx wrangler deploy
```

**Vercel:**

```bash
vercel
```

### 2. Client Configuration

Point your client to the proxy. The target OpenAI Base URL is embedded directly in the path.

**Format:** `http://<proxy-host>/<target-openai-base-url>`

Example configuration:

#### Claude Code

```bash
export ANTHROPIC_BASE_URL="http://localhost:3000/https://openrouter.ai/api/v1"
export ANTHROPIC_AUTH_TOKEN="sk-..."
export ANTHROPIC_MODEL="gpt-6"
export ANTHROPIC_SMALL_FAST_MODEL="gpt-6-mini"
```

#### Gemini CLI

```bash
export GOOGLE_GEMINI_BASE_URL="http://localhost:3000/https://openrouter.ai/api/v1"
export GEMINI_API_KEY="sk-..."
export GEMINI_MODEL="gpt-6"
```
