import { Context } from 'hono';
import { mapGeminiRequestToOpenAI } from './request';
import { mapOpenAIResponseToGemini } from './response';
import type { GenerateContentRequest } from '@google/generative-ai';
import type OpenAI from 'openai';
import { extractBaseUrlAndModel } from './utils';
import { ContentfulStatusCode } from 'hono/utils/http-status';
import { logger } from '../../logger';
import { convertOpenAIStreamToGeminiSSE } from './sse';

export async function handleGenerate(c: Context) {
    const extracted = extractBaseUrlAndModel(c.req.path, 'generate');
    if (!extracted || !extracted.baseUrl) {
        return c.json({ error: { message: 'Invalid path format or missing base URL. Usage: /:baseUrl/v1beta/models/:model:generateContent' } }, 400);
    }
    const { baseUrl, model } = extracted;

    // Extract API Key
    let apiKey = c.req.header('x-goog-api-key');
    if (!apiKey) {
        apiKey = c.req.query('key');
    }

    if (!apiKey) {
        return c.json({ error: { message: 'API key is missing. Please provide it via x-goog-api-key header or key query parameter.' } }, 401);
    }

    let geminiReq: GenerateContentRequest;
    try {
        geminiReq = await c.req.json();
    } catch (e) {
        return c.json({ error: { message: 'Invalid JSON body' } }, 400);
    }

    const openAIReq = mapGeminiRequestToOpenAI(geminiReq, model);

    try {
        logger.info('Forwarding request', { provider: 'gemini', method: 'generate', baseUrl, model });
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(openAIReq),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('OpenAI API Error', { status: response.status, errorText });
            return c.json({ error: { message: `OpenAI API Error: ${response.statusText}`, details: errorText } }, response.status as ContentfulStatusCode);
        }

        const openAIResp: OpenAI.Chat.ChatCompletion = await response.json();
        const geminiResp = mapOpenAIResponseToGemini(openAIResp);

        return c.json(geminiResp);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Proxy Error', { error: errorMessage });
        return c.json({ error: { message: 'Internal Server Error', details: errorMessage } }, 500);
    }
}

export async function handleStream(c: Context) {
    const extracted = extractBaseUrlAndModel(c.req.path, 'stream');
    if (!extracted || !extracted.baseUrl) {
        return c.json({ error: { message: 'Invalid path format or missing base URL. Usage: /:baseUrl/v1beta/models/:model:streamGenerateContent' } }, 400);
    }
    const { baseUrl, model } = extracted;

    // Extract API Key
    let apiKey = c.req.header('x-goog-api-key');
    if (!apiKey) {
        apiKey = c.req.query('key');
    }

    if (!apiKey) {
        return c.json({ error: { message: 'API key is missing. Please provide it via x-goog-api-key header or key query parameter.' } }, 401);
    }

    let geminiReq: GenerateContentRequest;
    try {
        geminiReq = await c.req.json();
    } catch (e) {
        return c.json({ error: { message: 'Invalid JSON body' } }, 400);
    }

    const openAIReq = mapGeminiRequestToOpenAI(geminiReq, model);
    openAIReq.stream = true;

    try {
        logger.info('Forwarding stream request', { provider: 'gemini', method: 'stream', baseUrl, model });
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(openAIReq),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('OpenAI API Error', { status: response.status, errorText });
            return c.json({ error: { message: `OpenAI API Error: ${response.statusText}`, details: errorText } }, response.status as ContentfulStatusCode);
        }

        if (!response.body) {
            return c.json({ error: { message: 'No response body from OpenAI' } }, 500);
        }

        const readable = convertOpenAIStreamToGeminiSSE(response);
        return c.newResponse(readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Proxy Error', { error: errorMessage });
        return c.json({ error: { message: 'Internal Server Error', details: errorMessage } }, 500);
    }
}
