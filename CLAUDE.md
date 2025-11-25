# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenProxy is a lightweight, zero-config gateway designed for **Claude Code** and **Gemini CLI** that enables them to use OpenAI-Compatible APIs. It translates API calls from Gemini and Anthropic clients to OpenAI API calls.

## Development Commands

### Core Development
- `npm run dev` - Start development server with hot reload (tsx watch)
- `npm run build` - Compile TypeScript to JavaScript
- `npm run start` - Start production server from compiled code
- `npm test` - Run test suite with Vitest

### Testing
- Tests are located in `src/**/*.test.ts` files
- Uses Vitest with Node.js environment
- Run specific tests: `npm test -- src/path/to/test.ts`

## Architecture

### Core Components
- **Main Application** (`src/index.ts`): Hono-based web server with routing logic
- **Server Entry** (`src/node-entry.ts`): Node.js server with graceful shutdown handling
- **Provider Handlers** (`src/providers/`): Gemini and Anthropic-specific request/response mapping

### Request Flow
1. Client request → Proxy server
2. Route matching based on path patterns:
   - Anthropic: `/v1/messages` endpoint
   - Gemini: `:generateContent` and `:streamGenerateContent` endpoints
3. Provider handler extracts base URL and API key from request
4. Request mapping to OpenAI-compatible format
5. Forward to target OpenAI API
6. Response mapping back to provider format
7. Return to client

### Provider Structure
- **Anthropic** (`src/providers/anthropic/`):
  - `handler.ts` - Main request routing and error handling
  - `request.ts` - Map Anthropic → OpenAI request format
  - `response.ts` - Map OpenAI → Anthropic response format
  - `sse.ts` - Stream conversion for server-sent events
  - `utils.ts` - URL parsing and API key extraction

- **Gemini** (`src/providers/gemini/`):
  - Similar structure to Anthropic with Gemini-specific mappings

### Key Technologies
- **Hono**: Web framework for routing and middleware
- **TypeScript**: Type-safe development with strict mode
- **Vitest**: Testing framework with Node.js environment
- **tsx**: TypeScript execution for development

## Configuration

The service is stateless and requires no server-side configuration. All connection information is extracted from incoming requests:
- **Base URL**: Embedded in request path (e.g., `/https://api.openrouter.ai/v1/...`)
- **API Keys**: Extracted from headers or query parameters

## Deployment

### Supported Platforms
- **Local**: `npm run start` (port 3000)
- **Docker**: Pre-built image available
- **Cloudflare Workers**: Worker deployment supported
- **Vercel**: Serverless deployment supported

### Environment Variables
- `GRACEFUL_TIMEOUT_MS`: Graceful shutdown timeout (default: 10000ms)

## Development Notes

- The proxy handles both streaming and non-streaming requests
- CORS is enabled for all routes
- Structured logging is implemented via `src/logger.ts`
- Error handling follows provider-specific error formats
- Streaming uses `TransformStream` for real-time SSE conversion