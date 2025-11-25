import { describe, it, expect } from 'vitest';
import { mapOpenAIResponseToGemini } from './response';
import { FinishReason } from '@google/generative-ai';
import OpenAI from 'openai';

describe('mapOpenAIResponseToGemini', () => {
    it('should convert OpenAI response to Gemini format', () => {
        const openAIResp: OpenAI.Chat.ChatCompletion = {
            id: 'chatcmpl-123', object: 'chat.completion', created: 1677652288, model: 'gpt-4',
            choices: [{ index: 0, message: { role: 'assistant', content: 'This is a response.', refusal: null }, finish_reason: 'stop', logprobs: null }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        };
        const result = mapOpenAIResponseToGemini(openAIResp);
        expect(result.candidates![0].content.parts[0].text).toBe('This is a response.');
        expect(result.candidates![0].finishReason).toBe(FinishReason.STOP);
    });

    it('should handle null content (default to empty string)', () => {
        const openAIResp: OpenAI.Chat.ChatCompletion = {
            id: 'chatcmpl-123', object: 'chat.completion', created: 1677652288, model: 'gpt-4',
            choices: [{ index: 0, message: { role: 'assistant', content: null, refusal: null }, finish_reason: 'stop', logprobs: null }],
            usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        };
        const result = mapOpenAIResponseToGemini(openAIResp);
        expect(result.candidates![0].content.parts[0].text).toBe('');
    });

    it('should map tool calls in response', () => {
        const openAIResp: OpenAI.Chat.ChatCompletion = {
            id: 'chatcmpl-123', object: 'chat.completion', created: 1677652288, model: 'gpt-4',
            choices: [{
                index: 0,
                message: {
                    role: 'assistant', content: null,
                    tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'get_weather', arguments: '{"location": "London"}' } }],
                    refusal: null,
                },
                finish_reason: 'tool_calls', logprobs: null,
            }],
        };
        const result = mapOpenAIResponseToGemini(openAIResp);
        const part = result.candidates![0].content.parts[0];
        expect(part.functionCall).toBeDefined();
        expect(part.functionCall!.name).toBe('get_weather');
        expect((part.functionCall!.args as any).location).toBe('London');
        expect((part.functionCall as any).id).toBe('call_123');
    });

    it('should map finish reasons correctly', () => {
        const testCases: Array<[string, FinishReason]> = [
            ['stop', FinishReason.STOP],
            ['length', FinishReason.MAX_TOKENS],
            ['content_filter', FinishReason.SAFETY],
            ['tool_calls', FinishReason.STOP],
        ];
        testCases.forEach(([openAIReason, expectedGeminiReason]) => {
            const openAIResp: OpenAI.Chat.ChatCompletion = {
                id: 'chatcmpl-123', object: 'chat.completion', created: 1677652288, model: 'gpt-4',
                choices: [{ index: 0, message: { role: 'assistant', content: 'test', refusal: null }, finish_reason: openAIReason as any, logprobs: null }],
            };
            const result = mapOpenAIResponseToGemini(openAIResp);
            expect(result.candidates![0].finishReason).toBe(expectedGeminiReason);
        });
    });
});
