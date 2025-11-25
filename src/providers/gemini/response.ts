import type { GenerateContentResponse, GenerateContentCandidate, Part } from '@google/generative-ai';
import type OpenAI from 'openai';
import { logger } from '../../logger';
import { mapFinishReason } from './utils';

export function mapOpenAIResponseToGemini(openAIResp: OpenAI.Chat.ChatCompletion): GenerateContentResponse {
    const candidates: GenerateContentCandidate[] = openAIResp.choices.map((choice) => {
        const parts: Part[] = [];

        if (choice.message.content !== null && choice.message.content !== undefined) {
            parts.push({ text: choice.message.content } as any);
        }

        if (choice.message.tool_calls) {
            for (const toolCall of choice.message.tool_calls) {
                if (toolCall.type === 'function') {
                    let args: object = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        logger.error('Failed to parse tool arguments', { error: e });
                    }
                    // gemini api定义没有id属性，但gemini cli会自动带上
                    parts.push({ functionCall: { id: toolCall.id, name: toolCall.function.name, args } } as any);
                }
            }
        }

        if (parts.length === 0) {
            parts.push({ text: '' } as any);
        }

        return {
            content: { role: 'model', parts } as any,
            finishReason: mapFinishReason(choice.finish_reason),
            index: choice.index,
        };
    });

    return { candidates };
}
