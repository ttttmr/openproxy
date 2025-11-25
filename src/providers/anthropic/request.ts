import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { logger } from '../../logger';

function isAssistantContentPart(
    part: OpenAI.Chat.ChatCompletionContentPart
): part is OpenAI.Chat.ChatCompletionContentPartText {
    return part.type === 'text';
}

export function mapAnthropicRequestToOpenAI(
    anthropicReq: Anthropic.MessageCreateParams
): OpenAI.Chat.ChatCompletionCreateParams {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (anthropicReq.system) {
        const systemContent = typeof anthropicReq.system === 'string'
            ? anthropicReq.system
            : anthropicReq.system.map(b => b.text).join('\n');

        messages.push({
            role: 'system',
            content: systemContent,
        });
    }

    for (const message of anthropicReq.messages) {
        if (typeof message.content === 'string') {
            messages.push({ role: message.role, content: message.content });
            continue;
        }

        let currentContent: Array<OpenAI.Chat.ChatCompletionContentPart> = [];
        let currentToolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];

        const flushCurrentMessage = () => {
            if (currentContent.length > 0 || currentToolCalls.length > 0) {
                let content: string | Array<OpenAI.Chat.ChatCompletionContentPart> | null = null;
                if (currentContent.length > 0) {
                    if (currentContent.length === 1 && currentContent[0].type === 'text') {
                        content = currentContent[0].text;
                    } else {
                        content = currentContent;
                    }
                }

                if (currentToolCalls.length > 0) {
                    const assistantContent = Array.isArray(content)
                        ? content.filter(isAssistantContentPart)
                        : content;

                    messages.push({
                        role: 'assistant',
                        content: assistantContent,
                        tool_calls: currentToolCalls,
                    });
                } else if (message.role === 'user' && content !== null) {
                    messages.push({ role: 'user', content });
                } else if (message.role === 'assistant' && content !== null) {
                    const assistantContent = Array.isArray(content)
                        ? content.filter(isAssistantContentPart)
                        : content;

                    messages.push({ role: 'assistant', content: assistantContent });
                }

                currentContent = [];
                currentToolCalls = [];
            }
        };

        for (const block of message.content) {
            if (!block || typeof block !== 'object') continue;
            switch (block.type) {
                case 'text':
                    currentContent.push({ type: 'text', text: block.text });
                    break;
                case 'image':
                    if (block.source.type === 'base64') {
                        currentContent.push({
                            type: 'image_url',
                            image_url: {
                                url: `data:${block.source.media_type};base64,${block.source.data}`,
                            },
                        });
                    } else if (block.source.type === 'url') {
                        currentContent.push({
                            type: 'image_url',
                            image_url: { url: block.source.url },
                        });
                    }
                    break;
                case 'tool_use':
                    {
                        const args = typeof block.input === 'string' ? block.input : JSON.stringify(block.input);
                        currentToolCalls.push({
                            id: block.id,
                            type: 'function',
                            function: { name: block.name, arguments: args },
                        });
                    }
                    break;
                case 'tool_result':
                    flushCurrentMessage();
                    {
                        const contentStr = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
                        messages.push({
                            role: 'tool',
                            content: contentStr,
                            tool_call_id: block.tool_use_id,
                        });
                    }
                    break;
                case 'thinking':
                    break;
                default:
                    logger.error(`unsupported ${block.type}`);
                    break;
            }
        }
        flushCurrentMessage();
    }

    const openAIReq: OpenAI.Chat.ChatCompletionCreateParams = {
        model: anthropicReq.model,
        messages,
        stream: anthropicReq.stream,
    };

    if (anthropicReq.max_tokens !== undefined) {
        openAIReq.max_completion_tokens = anthropicReq.max_tokens;
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

    if (anthropicReq.tools && anthropicReq.tools.length > 0) {
        openAIReq.tools = anthropicReq.tools.map(tool => {
            if ('input_schema' in tool) {
                return {
                    type: 'function' as const,
                    function: {
                        name: tool.name,
                        description: 'description' in tool ? tool.description : undefined,
                        parameters: tool.input_schema,
                    },
                };
            } else {
                return {
                    type: 'function' as const,
                    function: { name: tool.name, description: undefined, parameters: {} },
                };
            }
        });
    }

    if (anthropicReq.tool_choice) {
        if (typeof anthropicReq.tool_choice === 'object' && 'type' in anthropicReq.tool_choice) {
            if (anthropicReq.tool_choice.type === 'any') {
                openAIReq.tool_choice = 'required';
            } else if (anthropicReq.tool_choice.type === 'auto') {
                openAIReq.tool_choice = 'auto';
            } else if (anthropicReq.tool_choice.type === 'tool') {
                openAIReq.tool_choice = { type: 'function', function: { name: anthropicReq.tool_choice.name } };
            }
        }
    }

    return openAIReq;
}
