import { describe, it, expect } from 'vitest';
import { mapOpenAIStreamChunkToAnthropic } from './sse';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

describe('mapOpenAIStreamChunkToAnthropic', () => {
    it('should return empty array for role-only chunk', () => {
        const chunk: OpenAI.Chat.ChatCompletionChunk = {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: 1677652288,
            model: 'gpt-4',
            choices: [
                {
                    index: 0,
                    delta: { role: 'assistant' },
                    finish_reason: null,
                    logprobs: null,
                },
            ],
        };

        const result = mapOpenAIStreamChunkToAnthropic(chunk);
        expect(result).toHaveLength(0);
    });

    it('should create content_block_delta for text chunk', () => {
        const chunk: OpenAI.Chat.ChatCompletionChunk = {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: 1677652288,
            model: 'gpt-4',
            choices: [
                {
                    index: 0,
                    delta: { content: 'Hello' },
                    finish_reason: null,
                    logprobs: null,
                },
            ],
        };

        const result = mapOpenAIStreamChunkToAnthropic(chunk);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('content_block_delta');
        const deltaEvent = result[0] as Anthropic.ContentBlockDeltaEvent;
        expect(deltaEvent.delta.type).toBe('text_delta');
        if (deltaEvent.delta.type === 'text_delta') {
            expect(deltaEvent.delta.text).toBe('Hello');
        }
    });

    it('should create completion events when finished', () => {
        const chunk: OpenAI.Chat.ChatCompletionChunk = {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: 1677652288,
            model: 'gpt-4',
            choices: [
                {
                    index: 0,
                    delta: {},
                    finish_reason: 'stop',
                    logprobs: null,
                },
            ],
        };

        const result = mapOpenAIStreamChunkToAnthropic(chunk);
        expect(result).toHaveLength(3);
        expect(result[0].type).toBe('content_block_stop');
        expect(result[1].type).toBe('message_delta');
        expect(result[2].type).toBe('message_stop');
    });
});

