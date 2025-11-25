import type Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../logger';
import type OpenAI from 'openai';
import { mapFinishReason } from './utils';

export function convertOpenAIStreamToAnthropicSSE(
    response: Response,
    model: string
): ReadableStream<Uint8Array> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    (async () => {
        let buffer = '';
        try {
            const startEvent: Anthropic.MessageStreamEvent = {
                type: 'message_start',
                message: {
                    id: 'msg_' + Date.now(),
                    type: 'message',
                    role: 'assistant',
                    content: [],
                    model: model || '',
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
                    },
                },
            };
            await writer.write(encoder.encode(`event: message_start\ndata: ${JSON.stringify(startEvent)}\n\n`));

            const blockStartEvent: Anthropic.MessageStreamEvent = {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '', citations: null },
            };
            await writer.write(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(blockStartEvent)}\n\n`));

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
                        const anthropicEvents = mapOpenAIStreamChunkToAnthropic(chunk);
                        for (const event of anthropicEvents) {
                            try {
                                const encoded = encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                                await writer.write(encoded);
                            } catch {
                                return;
                            }
                        }
                    } catch (e) {
                        logger.error('Error processing chunk', { chunk: data, error: e });
                    }
                }
            }
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
                await writer.close();
            } catch {}
        }
    })();

    return readable;
}

export function mapOpenAIStreamChunkToAnthropic(
    chunk: OpenAI.Chat.ChatCompletionChunk
): Anthropic.MessageStreamEvent[] {
    const events: Anthropic.MessageStreamEvent[] = [];
    if (!chunk.choices || chunk.choices.length === 0) return events;

    const choice = chunk.choices[0];
    if (!choice) return events;
    if (!(choice as any).delta) {
        return events;
    }

    const delta = (choice as any).delta;
    if (delta.content) {
        events.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta.content } });
    }
    if (delta.tool_calls && delta.tool_calls.length > 0) {
        for (const toolCall of delta.tool_calls) {
            if (toolCall.function?.name) {
                const toolUseBlock: Anthropic.ToolUseBlock = { type: 'tool_use', id: toolCall.id || '', name: toolCall.function.name, input: {} };
                events.push({ type: 'content_block_start', index: toolCall.index || 0, content_block: toolUseBlock });
            }
            if (toolCall.function?.arguments) {
                events.push({ type: 'content_block_delta', index: toolCall.index || 0, delta: { type: 'input_json_delta', partial_json: toolCall.function.arguments } });
            }
        }
    }
    if (choice.finish_reason) {
        events.push({ type: 'content_block_stop', index: 0 });
        events.push({ type: 'message_delta', delta: { stop_reason: mapFinishReason(choice.finish_reason), stop_sequence: null }, usage: { output_tokens: 0, input_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null } });
        events.push({ type: 'message_stop' });
    }
    return events;
}
