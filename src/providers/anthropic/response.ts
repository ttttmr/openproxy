import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { mapFinishReason } from './utils';

export function mapOpenAIResponseToAnthropic(
    openAIResp: OpenAI.Chat.ChatCompletion
): Anthropic.Message {
    const choice = openAIResp.choices[0];
    const content: Anthropic.ContentBlock[] = [];

    if (choice.message.content !== undefined) {
        const textBlock: Anthropic.TextBlock = {
            type: 'text',
            text: choice.message.content || '',
            citations: null,
        };
        content.push(textBlock);
    }

    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        for (const toolCall of choice.message.tool_calls) {
            if (toolCall.type === 'function' && 'function' in toolCall) {
                const toolUseBlock: Anthropic.ToolUseBlock = {
                    type: 'tool_use',
                    id: toolCall.id,
                    name: toolCall.function.name,
                    input: JSON.parse(toolCall.function.arguments || '{}'),
                };
                content.push(toolUseBlock);
            }
        }
    }

    if (content.length === 0) {
        const emptyTextBlock: Anthropic.TextBlock = {
            type: 'text',
            text: '',
            citations: null,
        };
        content.push(emptyTextBlock);
    }

    return {
        id: openAIResp.id,
        type: 'message',
        role: 'assistant',
        content,
        model: openAIResp.model,
        stop_reason: mapFinishReason(choice.finish_reason),
        stop_sequence: null,
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
