import { describe, it, expect } from 'vitest';
import { mapOpenAIStreamChunkToGemini } from './sse';
import { FinishReason } from '@google/generative-ai';
import OpenAI from 'openai';

describe('mapOpenAIStreamChunkToGemini', () => {
    it('should convert stream chunk with content', () => {
        const chunk: OpenAI.Chat.ChatCompletionChunk = {
            id: 'chatcmpl-123', object: 'chat.completion.chunk', created: 1677652288, model: 'gpt-4',
            choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null, logprobs: null }],
        };
        const result = mapOpenAIStreamChunkToGemini(chunk);
        expect(result.candidates![0].content.parts[0].text).toBe('Hello');
        expect(result.candidates![0].finishReason).toBeUndefined();
    });

    it('should handle chunk with finish_reason', () => {
        const chunk: OpenAI.Chat.ChatCompletionChunk = {
            id: 'chatcmpl-123', object: 'chat.completion.chunk', created: 1677652288, model: 'gpt-4',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop', logprobs: null }],
        };
        const result = mapOpenAIStreamChunkToGemini(chunk);
        expect(result.candidates![0].finishReason).toBe(FinishReason.STOP);
    });

    it('should handle empty delta content as empty parts', () => {
        const chunk: OpenAI.Chat.ChatCompletionChunk = {
            id: 'chatcmpl-123', object: 'chat.completion.chunk', created: 1677652288, model: 'gpt-4',
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null, logprobs: null }],
        };
        const result = mapOpenAIStreamChunkToGemini(chunk);
        expect(result.candidates![0].content.parts).toHaveLength(0);
    });
});
