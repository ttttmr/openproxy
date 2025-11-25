import { Context } from 'hono';
import type Anthropic from '@anthropic-ai/sdk';
import { mapAnthropicRequestToOpenAI } from './request';
import { mapOpenAIResponseToAnthropic } from './response';
import type OpenAI from 'openai';
import { ContentfulStatusCode } from 'hono/utils/http-status';
import { logger } from '../../logger';
import { parseAnthropicBaseUrl, extractAnthropicApiKey } from './utils';
import { convertOpenAIStreamToAnthropicSSE } from './sse';

export async function handleAnthropic(c: Context) {
    const path = c.req.path;
    const baseUrl = parseAnthropicBaseUrl(path);
    if (!baseUrl) {
        return c.json({ error: { message: 'Invalid path format. Usage: /:baseUrl/v1/messages' } }, 400);
    }

    const apiKey = extractAnthropicApiKey(c);
    if (!apiKey) {
        return c.json({ error: { type: 'authentication_error', message: 'missing api key' } }, 401);
    }

    let anthropicReq: Anthropic.MessageCreateParams;
    try {
        anthropicReq = await c.req.json();
    } catch (e) {
        return c.json({ error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400);
    }

    const openAIReq = mapAnthropicRequestToOpenAI(anthropicReq);

    // Handle streaming
    if (anthropicReq.stream) {
        openAIReq.stream = true;
        try {
            logger.info('Forwarding stream request', { provider: 'anthropic', method: 'stream', baseUrl, model: openAIReq.model });
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
                return c.json({ error: { type: 'api_error', message: `OpenAI API Error: ${response.statusText}`, details: errorText } }, response.status as ContentfulStatusCode);
            }

            if (!response.body) {
                return c.json({ error: { type: 'api_error', message: 'No response body from OpenAI' } }, 500);
            }

            const readable = convertOpenAIStreamToAnthropicSSE(response, openAIReq.model || '');
            return c.newResponse(readable, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
            });

        } catch (error: any) {
            logger.error('Proxy Error', { error });
            return c.json({ error: { type: 'api_error', message: 'Internal Server Error', details: error.message } }, 500);
        }
    }

    // Normal request
    try {
        logger.info('Forwarding request', { provider: 'anthropic', method: 'generate', baseUrl, model: openAIReq.model });
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
            return c.json({ error: { type: 'api_error', message: `OpenAI API Error: ${response.statusText}`, details: errorText } }, response.status as ContentfulStatusCode);
        }

        const openAIResp: OpenAI.Chat.ChatCompletion = await response.json();
        const anthropicResp = mapOpenAIResponseToAnthropic(openAIResp);

        return c.json(anthropicResp);
    } catch (error: any) {
        logger.error('Proxy Error', { error });
        return c.json({ error: { type: 'api_error', message: 'Internal Server Error', details: error.message } }, 500);
    }
}
