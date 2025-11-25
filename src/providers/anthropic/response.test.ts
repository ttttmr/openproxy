import { describe, it, expect } from 'vitest';
import { mapOpenAIResponseToAnthropic } from './response';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

describe('mapOpenAIResponseToAnthropic', () => {
    it('should convert OpenAI response to Anthropic format', () => {
        const openAIResp: OpenAI.Chat.ChatCompletion = {
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1677652288,
            model: 'gpt-4',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'Hello! How can I help you?',
                        refusal: null,
                    },
                    finish_reason: 'stop',
                    logprobs: null,
                },
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 20,
                total_tokens: 30,
            },
        };

        const result = mapOpenAIResponseToAnthropic(openAIResp);
        expect(result.id).toBe('chatcmpl-123');
        expect(result.type).toBe('message');
        expect(result.role).toBe('assistant');
        expect(result.content[0].type).toBe('text');
        expect((result.content[0] as Anthropic.TextBlock).text).toBe('Hello! How can I help you?');
        expect(result.stop_reason).toBe('end_turn');
        expect(result.model).toBe('gpt-4');
        expect(result.usage?.input_tokens).toBe(10);
        expect(result.usage?.output_tokens).toBe(20);
    });

    it('should handle null content', () => {
        const openAIResp: OpenAI.Chat.ChatCompletion = {
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1677652288,
            model: 'gpt-4',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: null,
                        refusal: null,
                    },
                    finish_reason: 'stop',
                    logprobs: null,
                },
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 0,
                total_tokens: 10,
            },
        };

        const result = mapOpenAIResponseToAnthropic(openAIResp);
        expect((result.content[0] as Anthropic.TextBlock).text).toBe('');
    });
});

