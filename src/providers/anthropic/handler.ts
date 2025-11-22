import { Context } from 'hono';
import type Anthropic from '@anthropic-ai/sdk';
import { mapAnthropicRequestToOpenAI, mapOpenAIResponseToAnthropic, mapOpenAIStreamChunkToAnthropic } from './mapper';
import type OpenAI from 'openai';
import { ContentfulStatusCode } from 'hono/utils/http-status';
import { logger } from '../../logger';

export async function handleAnthropic(c: Context) {
    const path = c.req.path;
    // Expected format: /:baseUrl/v1/messages
    // We split by /v1/messages to get the base URL
    const parts = path.split('/v1/messages');
    if (parts.length < 2) {
        return c.json({ error: { message: 'Invalid path format. Usage: /:baseUrl/v1/messages' } }, 400);
    }

    let baseUrl = parts[0];
    if (baseUrl.startsWith('/')) {
        baseUrl = baseUrl.substring(1);
    }

    if (!baseUrl) {
        return c.json({ error: { message: 'Missing base URL' } }, 400);
    }

    if (!baseUrl.startsWith('http')) {
        baseUrl = `https://${baseUrl}`;
    }

    // Extract API Key (x-api-key is standard for Anthropic, but we might use x-goog-api-key or similar if we want to unify, 
    // but usually Anthropic clients send x-api-key. The user wants to use Anthropic client, so we should respect Anthropic headers)
    let apiKey = c.req.header('x-api-key');

    // Also check Authorization header just in case
    if (!apiKey) {
        const authHeader = c.req.header('authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            apiKey = authHeader.substring(7);
        }
    }

    if (!apiKey) {
        // Fallback to query param if needed, though less common for Anthropic
        apiKey = c.req.query('key');
    }

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

            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();

            (async () => {
                let buffer = '';
                try {
                    // Send message_start event
                    const startEvent: Anthropic.MessageStreamEvent = {
                        type: 'message_start',
                        message: {
                            id: 'msg_' + Date.now(), // Dummy ID
                            type: 'message',
                            role: 'assistant',
                            content: [],
                            model: openAIReq.model || '',
                            stop_reason: null,
                            stop_sequence: null,
                            usage: {
                                input_tokens: 0,
                                output_tokens: 0,
                                cache_creation_input_tokens: null,
                                cache_read_input_tokens: null,
                                cache_creation: null,
                                server_tool_use: null,
                                service_tier: null,
                            }
                        }
                    };
                    await writer.write(encoder.encode(`event: message_start\ndata: ${JSON.stringify(startEvent)}\n\n`));

                    // Send content_block_start
                    const blockStartEvent: Anthropic.MessageStreamEvent = {
                        type: 'content_block_start',
                        index: 0,
                        content_block: {
                            type: 'text',
                            text: '',
                            citations: null
                        }
                    };
                    await writer.write(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(blockStartEvent)}\n\n`));

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') continue;
                                if (!data) continue;

                                try {
                                    const chunk = JSON.parse(data);
                                    const anthropicEvents = mapOpenAIStreamChunkToAnthropic(chunk);

                                    for (const event of anthropicEvents) {
                                        try {
                                            const encoded = encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                                            await writer.write(encoded);
                                        } catch (writeError) {
                                            // Client disconnected or stream closed - this is normal, just exit gracefully
                                            return;
                                        }
                                    }
                                } catch (e) {
                                    logger.error('Error processing chunk', { chunk: data, error: e });
                                }
                            }
                        }
                    }

                    // Send message_stop if not already sent (though mapOpenAIStreamChunkToAnthropic handles finish_reason)
                    // But we might want to ensure it's closed properly.
                    // The loop ends when OpenAI stream ends.

                } catch (e) {
                    logger.error('Stream error', { error: e });
                    try {
                        const errorEvent = { type: 'error', error: { type: 'api_error', message: 'Stream error' } };
                        await writer.write(encoder.encode(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`));
                    } catch (writeError) {
                        logger.error('Failed to write error event', { error: writeError });
                    }
                } finally {
                    try {
                        // Only close if the writer is still open
                        if (writer) {
                            await writer.close();
                        }
                    } catch (closeError) {
                        // Ignore error if stream is already closed
                        // This can happen if the client disconnects early
                    }
                }
            })();

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
