import type { GenerateContentResponse, Part } from '@google/generative-ai';
import type OpenAI from 'openai';
import { logger } from '../../logger';
import { mapFinishReason } from './utils';

interface BufferedToolCall {
    id: string;
    name: string;
    arguments: string;
}

export function convertOpenAIStreamToGeminiSSE(response: Response): ReadableStream<Uint8Array> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    (async () => {
        let buffer = '';
        const toolCallBuffer: Record<number, BufferedToolCall> = {};
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]' || !data) continue;

                    try {
                        const chunk: OpenAI.Chat.ChatCompletionChunk = JSON.parse(data);
                        const geminiChunk = mapOpenAIStreamChunkToGemini(chunk);
                        if (geminiChunk.candidates && geminiChunk.candidates.length > 0 && geminiChunk.candidates[0].content.parts.length > 0) {
                            try {
                                const encoded = encoder.encode(`data: ${JSON.stringify(geminiChunk)}\n\n`);
                                await writer.write(encoded);
                            } catch {
                                return;
                            }
                        }

                        const choice = chunk.choices[0];
                        if (choice?.delta?.tool_calls) {
                            for (const toolCall of choice.delta.tool_calls) {
                                const index = (toolCall as any).index;
                                if (!toolCallBuffer[index]) {
                                    toolCallBuffer[index] = { id: toolCall.id || '', name: toolCall.function?.name || '', arguments: toolCall.function?.arguments || '' };
                                } else if (toolCall.function?.arguments) {
                                    toolCallBuffer[index].arguments += toolCall.function.arguments;
                                }
                            }
                        }

                        if (choice?.finish_reason) {
                            const parts: Part[] = [];
                            const indices = Object.keys(toolCallBuffer).map(Number).sort((a, b) => a - b);
                            for (const index of indices) {
                                const buffered = toolCallBuffer[index];
                                let argsObj: object = {};
                                try {
                                    argsObj = JSON.parse(buffered.arguments);
                                } catch (e) {
                                    const msg = e instanceof Error ? e.message : 'Unknown error';
                                    logger.error('Failed to parse buffered tool arguments', { error: msg, arguments: buffered.arguments });
                                }
                                parts.push({ functionCall: { id: buffered.id, name: buffered.name, args: argsObj } } as any);
                            }

                            if (parts.length > 0) {
                                const toolCallChunk: GenerateContentResponse = {
                                    candidates: [{ content: { role: 'model', parts } as any, finishReason: 'STOP' as any, index: choice.index }],
                                };
                                await writer.write(encoder.encode(`data: ${JSON.stringify(toolCallChunk)}\n\n`));
                            }
                        }

                    } catch (e) {
                        const errorMessage = e instanceof Error ? e.message : 'Unknown error';
                        logger.error('Error parsing chunk', { chunk: data, error: errorMessage });
                    }
                }
            }
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'Unknown error';
            logger.error('Stream error', { error: errorMessage });
        } finally {
            try { await writer.close(); } catch {}
        }
    })();

    return readable;
}

export function mapOpenAIStreamChunkToGemini(chunk: OpenAI.Chat.ChatCompletionChunk): GenerateContentResponse {
    const candidates = chunk.choices.map((choice) => {
        const parts: Part[] = [];
        if (choice.delta.content !== null && choice.delta.content !== undefined) {
            parts.push({ text: choice.delta.content } as any);
        }
        return {
            content: { role: 'model', parts } as any,
            finishReason: choice.finish_reason ? mapFinishReason(choice.finish_reason) : undefined,
            index: choice.index,
        };
    });
    return { candidates } as GenerateContentResponse;
}
