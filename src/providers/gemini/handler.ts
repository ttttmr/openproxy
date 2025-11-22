import { Context } from 'hono';
import { mapGeminiRequestToOpenAI, mapOpenAIResponseToGemini, mapOpenAIStreamChunkToGemini } from './mapper';
import { GenerateContentRequest, GenerateContentResponse, Part, FinishReason } from '@google/generative-ai';
import OpenAI from 'openai';
import { extractBaseUrlAndModel } from './url';
import { ContentfulStatusCode } from 'hono/utils/http-status';
import { logger } from '../../logger';

interface BufferedToolCall {
    id: string;
    name: string;
    arguments: string;
}

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
    } catch (error: any) {
        logger.error('Proxy Error', { error });
        return c.json({ error: { message: 'Internal Server Error', details: error.message } }, 500);
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

        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();

        (async () => {
            let buffer = '';
            // Buffer for tool calls: index -> BufferedToolCall
            const toolCallBuffer: Record<number, BufferedToolCall> = {};

            try {
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
                                const chunk = JSON.parse(data) as OpenAI.Chat.ChatCompletionChunk;
                                if (!chunk) continue;

                                // 1. Handle Text Content (Stream immediately)
                                const geminiChunk = mapOpenAIStreamChunkToGemini(chunk);
                                // Only send if there are candidates with content
                                if (geminiChunk.candidates && geminiChunk.candidates.length > 0 && geminiChunk.candidates[0].content.parts.length > 0) {
                                    const sseMessage = `data: ${JSON.stringify(geminiChunk)}\n\n`;
                                    await writer.write(encoder.encode(sseMessage));
                                }

                                // 2. Handle Tool Calls (Buffer)
                                const choice = chunk.choices[0];
                                if (choice.delta.tool_calls) {
                                    for (const toolCall of choice.delta.tool_calls) {
                                        const index = toolCall.index;
                                        if (!toolCallBuffer[index]) {
                                            toolCallBuffer[index] = {
                                                id: toolCall.id || '',
                                                name: toolCall.function?.name || '',
                                                arguments: toolCall.function?.arguments || '',
                                            };
                                        } else {
                                            if (toolCall.function?.arguments) {
                                                toolCallBuffer[index].arguments += toolCall.function.arguments;
                                            }
                                        }
                                    }
                                }

                                // 3. Handle Finish Reason (Flush Tool Calls)
                                if (choice.finish_reason) {
                                    const parts: Part[] = [];
                                    const indices = Object.keys(toolCallBuffer).map(Number).sort((a, b) => a - b);

                                    for (const index of indices) {
                                        const buffered = toolCallBuffer[index];
                                        let args = {};
                                        try {
                                            args = JSON.parse(buffered.arguments);
                                        } catch (e) {
                                            logger.error('Failed to parse buffered tool arguments', { error: e, arguments: buffered.arguments });
                                        }

                                        // Inject ID
                                        (args as any).__tool_call_id = buffered.id;

                                        parts.push({
                                            functionCall: {
                                                name: buffered.name,
                                                args: args,
                                            },
                                        });
                                    }

                                    if (parts.length > 0) {
                                        const toolCallChunk: GenerateContentResponse = {
                                            candidates: [{
                                                content: {
                                                    role: 'model',
                                                    parts: parts,
                                                },
                                                finishReason: FinishReason.STOP,
                                                index: choice.index,
                                            }],
                                        };
                                        const sseMessage = `data: ${JSON.stringify(toolCallChunk)}\n\n`;
                                        await writer.write(encoder.encode(sseMessage));
                                    }
                                }

                            } catch (e) {
                                logger.error('Error parsing chunk', { chunk: data, error: e });
                            }
                        }
                    }
                }
            } catch (e) {
                logger.error('Stream error', { error: e });
            } finally {
                await writer.close();
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
        return c.json({ error: { message: 'Internal Server Error', details: error.message } }, 500);
    }
}
