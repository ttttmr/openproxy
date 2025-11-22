import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { logger } from '../../logger';

export function mapAnthropicRequestToOpenAI(anthropicReq: Anthropic.MessageCreateParams): OpenAI.Chat.ChatCompletionCreateParams {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    // Handle system prompt if present
    if (anthropicReq.system) {
        const systemContent = typeof anthropicReq.system === 'string'
            ? anthropicReq.system
            : anthropicReq.system.map(b => b.text).join('\n');

        messages.push({
            role: 'system',
            content: systemContent,
        });
    }

    // Map messages
    for (const msg of anthropicReq.messages) {
        if (typeof msg.content === 'string') {
            // Simple text message
            messages.push({
                role: msg.role,
                content: msg.content,
            });
        } else {
            // Handle array of content blocks
            const textBlocks: Anthropic.TextBlock[] = [];
            const imageBlocks: Anthropic.ImageBlockParam[] = [];
            const toolUseBlocks: Anthropic.ToolUseBlock[] = [];
            const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

            for (const block of msg.content) {
                if (block.type === 'text') {
                    textBlocks.push(block as Anthropic.TextBlock);
                } else if (block.type === 'image') {
                    imageBlocks.push(block as Anthropic.ImageBlockParam);
                } else if (block.type === 'tool_use') {
                    toolUseBlocks.push(block as Anthropic.ToolUseBlock);
                } else if (block.type === 'tool_result') {
                    toolResultBlocks.push(block as Anthropic.ToolResultBlockParam);
                }
            }

            // If we have tool results, this is a tool response message
            if (toolResultBlocks.length > 0) {
                for (const toolResult of toolResultBlocks) {
                    let content = '';
                    if (typeof toolResult.content === 'string') {
                        content = toolResult.content;
                    } else if (Array.isArray(toolResult.content)) {
                        // Extract text from content blocks
                        content = toolResult.content
                            .filter((b: any) => b.type === 'text')
                            .map((b: any) => b.text)
                            .join('\n');
                    }

                    messages.push({
                        role: 'tool',
                        content: content,
                        tool_call_id: toolResult.tool_use_id,
                    });
                }
            } else if (toolUseBlocks.length > 0) {
                // Assistant message with tool calls
                const textContent = textBlocks.map(b => b.text).join('\n');
                const tool_calls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolUseBlocks.map(toolUse => ({
                    id: toolUse.id,
                    type: 'function' as const,
                    function: {
                        name: toolUse.name,
                        arguments: JSON.stringify(toolUse.input),
                    },
                }));

                messages.push({
                    role: 'assistant',
                    content: textContent || null,
                    tool_calls: tool_calls,
                });
            } else {
                // Text and/or Image blocks
                if (imageBlocks.length > 0 && msg.role === 'user') {
                    // Mixed content (text + image) for user messages
                    const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [];

                    for (const block of msg.content) {
                        if (block.type === 'text') {
                            contentParts.push({
                                type: 'text',
                                text: block.text
                            });
                        } else if (block.type === 'image') {
                            if (block.source.type === 'base64') {
                                contentParts.push({
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:${block.source.media_type};base64,${block.source.data}`
                                    }
                                });
                            }
                        }
                    }

                    messages.push({
                        role: 'user',
                        content: contentParts,
                    });
                } else {
                    // Just text blocks (or assistant with images which we can't handle fully in OpenAI)
                    const content = textBlocks.map(b => b.text).join('\n');
                    messages.push({
                        role: msg.role,
                        content: content,
                    });
                }
            }
        }
    }

    const openAIReq: OpenAI.Chat.ChatCompletionCreateParams = {
        model: anthropicReq.model, // Pass through model name
        messages: messages,
        stream: anthropicReq.stream as boolean | undefined,
    };

    if (anthropicReq.max_tokens !== undefined) {
        openAIReq.max_completion_tokens = anthropicReq.max_tokens
    }

    if (anthropicReq.temperature !== undefined) {
        openAIReq.temperature = anthropicReq.temperature;
    }

    if (anthropicReq.top_p !== undefined) {
        openAIReq.top_p = anthropicReq.top_p;
    }

    if (anthropicReq.stop_sequences !== undefined) {
        openAIReq.stop = anthropicReq.stop_sequences;
    }

    // Map tools if present
    if (anthropicReq.tools && anthropicReq.tools.length > 0) {
        openAIReq.tools = anthropicReq.tools.map(tool => {
            if ('input_schema' in tool) {
                // Custom tool with input_schema
                return {
                    type: 'function' as const,
                    function: {
                        name: tool.name,
                        description: 'description' in tool ? tool.description : undefined,
                        parameters: tool.input_schema,
                    },
                };
            } else {
                // Other tool types (bash, etc.) - best effort mapping
                return {
                    type: 'function' as const,
                    function: {
                        name: tool.name,
                        description: undefined,
                        parameters: {},
                    },
                };
            }
        });
    }

    // Map tool_choice if present
    if (anthropicReq.tool_choice) {
        if (typeof anthropicReq.tool_choice === 'object' && 'type' in anthropicReq.tool_choice) {
            if (anthropicReq.tool_choice.type === 'any') {
                openAIReq.tool_choice = 'required';
            } else if (anthropicReq.tool_choice.type === 'auto') {
                openAIReq.tool_choice = 'auto';
            } else if (anthropicReq.tool_choice.type === 'tool') {
                openAIReq.tool_choice = {
                    type: 'function',
                    function: { name: anthropicReq.tool_choice.name },
                };
            }
        }
    }

    return openAIReq;
}

export function mapOpenAIResponseToAnthropic(openAIResp: OpenAI.Chat.ChatCompletion): Anthropic.Message {
    const choice = openAIResp.choices[0];
    const content: Anthropic.ContentBlock[] = [];

    // Add text content (even if null, add empty text block for compatibility)
    if (choice.message.content !== undefined) {
        content.push({
            type: 'text',
            text: choice.message.content || '',
        } as Anthropic.TextBlock);
    }

    // Add tool calls if present
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        for (const toolCall of choice.message.tool_calls) {
            // Type guard to check if this is a function tool call
            if (toolCall.type === 'function' && 'function' in toolCall) {
                content.push({
                    type: 'tool_use',
                    id: toolCall.id,
                    name: toolCall.function.name,
                    input: JSON.parse(toolCall.function.arguments || '{}'),
                } as Anthropic.ToolUseBlock);
            }
        }
    }

    // Ensure we always have at least one content block
    if (content.length === 0) {
        content.push({
            type: 'text',
            text: '',
        } as Anthropic.TextBlock);
    }

    return {
        id: openAIResp.id,
        type: 'message',
        role: 'assistant',
        content: content,
        model: openAIResp.model,
        stop_reason: mapFinishReason(choice.finish_reason),
        stop_sequence: null, // OpenAI doesn't always provide the specific sequence in the same way
        usage: {
            input_tokens: openAIResp.usage?.prompt_tokens || 0,
            output_tokens: openAIResp.usage?.completion_tokens || 0,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
        },
    };
}

export function mapOpenAIStreamChunkToAnthropic(chunk: OpenAI.Chat.ChatCompletionChunk): Anthropic.MessageStreamEvent[] {
    const events: Anthropic.MessageStreamEvent[] = [];

    if (!chunk.choices || chunk.choices.length === 0) {
        return events;
    }

    const choice = chunk.choices[0];
    if (!choice) return events;

    // Add defensive check for delta
    if (!choice.delta) {
        logger.warn('Choice has no delta property', { choice });
        return events;
    }

    // Skip chunks that only have role information (first chunk from OpenAI often just has role: "assistant")
    // We already sent message_start with role in the handler, so we can ignore these

    // 1. content_block_delta for text
    if (choice.delta.content) {
        events.push({
            type: 'content_block_delta',
            index: 0,
            delta: {
                type: 'text_delta',
                text: choice.delta.content,
            },
        });
    }

    // 2. Handle tool_calls in streaming
    if (choice.delta.tool_calls && choice.delta.tool_calls.length > 0) {
        for (const toolCall of choice.delta.tool_calls) {
            // For tool calls in streaming, we get incremental updates
            // First chunk has id and function name, subsequent chunks have arguments
            if (toolCall.function?.name) {
                // Start of a new tool use block
                events.push({
                    type: 'content_block_start',
                    index: toolCall.index || 0,
                    content_block: {
                        type: 'tool_use',
                        id: toolCall.id || '',
                        name: toolCall.function.name,
                        input: {},
                    } as Anthropic.ToolUseBlock,
                });
            }

            if (toolCall.function?.arguments) {
                // Delta update for tool arguments
                events.push({
                    type: 'content_block_delta',
                    index: toolCall.index || 0,
                    delta: {
                        type: 'input_json_delta',
                        partial_json: toolCall.function.arguments,
                    },
                });
            }
        }
    }

    // 3. message_stop / message_delta if finished
    if (choice.finish_reason) {
        events.push({
            type: 'content_block_stop',
            index: 0,
        });
        events.push({
            type: 'message_delta',
            delta: {
                stop_reason: mapFinishReason(choice.finish_reason),
                stop_sequence: null, // Difficult to map exactly without more info
            },
            usage: {
                output_tokens: 0,
                input_tokens: 0,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                server_tool_use: null,
            }
        });
        events.push({
            type: 'message_stop',
        });
    }

    return events;
}

function mapFinishReason(reason: string | null | undefined): 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null {
    switch (reason) {
        case 'stop':
            return 'end_turn';
        case 'length':
            return 'max_tokens';
        case 'function_call': // Legacy
        case 'tool_calls':
            return 'tool_use'; // Corrected: tool_calls should map to tool_use
        case 'content_filter':
            return null; // or 'end_turn' with error?
        default:
            return null;
    }
}
