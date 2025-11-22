# Project Context for Agents

## Overview
This project is a proxy service written in TypeScript using Hono. It translates API calls from Gemini and Anthropic clients to OpenAI API calls.

## Key Components
- `src/index.ts`: Main application logic and routing.
- `src/node-entry.ts`: Node.js server entry point.
- `src/logger.ts`: Structured logging utility.
- `src/providers/`: Contains provider-specific logic.
    - `gemini/`: Gemini request/response mapping and handling.
    - `anthropic/`: Anthropic request/response mapping and handling.

## Architecture
- **Request**: Client -> Proxy -> (Provider Handler) -> (Mapper) -> OpenAI Provider
- **Response**: OpenAI Provider -> (Mapper) -> (Provider Handler) -> Proxy -> Client
- **Streaming**: Uses `TransformStream` to map SSE chunks on the fly.

## Configuration
The service is stateless and configuration-less. All necessary connection info (Base URL, API Key) is extracted from the incoming request.
