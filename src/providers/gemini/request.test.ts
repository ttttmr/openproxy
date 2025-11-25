import { describe, it, expect } from 'vitest';
import { mapGeminiRequestToOpenAI } from './request';
import { GenerateContentRequest } from '@google/generative-ai';
import OpenAI from 'openai';

describe('mapGeminiRequestToOpenAI', () => {
    it('should convert basic Gemini request to OpenAI format', () => {
        const geminiReq: GenerateContentRequest = {
            contents: [
                { role: 'user', parts: [{ text: 'Hello, Gemini!' }] },
            ],
        };
        const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');
        expect(result.model).toBe('gemini-pro');
        expect(result.messages[0].role).toBe('user');
        expect(result.messages[0].content).toBe('Hello, Gemini!');
    });

    it('should convert model role to assistant', () => {
        const geminiReq: GenerateContentRequest = {
            contents: [
                { role: 'user', parts: [{ text: 'Hi' }] },
                { role: 'model', parts: [{ text: 'Hello!' }] },
            ],
        };
        const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');
        expect(result.messages).toHaveLength(2);
        expect(result.messages[1].role).toBe('assistant');
        expect(result.messages[1].content).toBe('Hello!');
    });

    it('should handle multiple text parts', () => {
        const geminiReq: GenerateContentRequest = {
            contents: [
                { role: 'user', parts: [{ text: 'Part 1' }, { text: 'Part 2' }] },
            ],
        };
        const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');
        expect(result.messages[0].content).toBe('Part 1\nPart 2');
    });

    it('should map generation config parameters', () => {
        const geminiReq: GenerateContentRequest = {
            contents: [
                { role: 'user', parts: [{ text: 'test' }] },
            ],
            generationConfig: {
                temperature: 0.8,
                topP: 0.95,
                maxOutputTokens: 2048,
                stopSequences: ['END'],
                candidateCount: 2,
            },
        };
        const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');
        expect(result.temperature).toBe(0.8);
        expect(result.top_p).toBe(0.95);
        expect(result.max_completion_tokens).toBe(2048);
        expect(result.stop).toEqual(['END']);
        expect(result.n).toBe(2);
    });

    it('should map maxOutputTokens to max_completion_tokens', () => {
        const geminiReq: GenerateContentRequest = {
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
            generationConfig: { maxOutputTokens: 10000 },
        };
        const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');
        expect(result.max_completion_tokens).toBe(10000);
    });

    it('should map system instruction', () => {
        const geminiReq: GenerateContentRequest = {
            contents: [],
            systemInstruction: { role: 'system', parts: [{ text: 'Be helpful.' }] },
        };
        const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0].role).toBe('system');
        expect(result.messages[0].content).toBe('Be helpful.');
    });

    it('should map inline data (image)', () => {
        const geminiReq: GenerateContentRequest = {
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: 'Look at this:' },
                        { inlineData: { mimeType: 'image/jpeg', data: 'base64data' } },
                    ],
                },
            ],
        };
        const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');
        const content = result.messages[0].content as OpenAI.Chat.ChatCompletionContentPart[];
        expect(content).toHaveLength(2);
        expect(content[0]).toEqual({ type: 'text', text: 'Look at this:' });
        expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,base64data' } });
    });

    it('should map function calls and responses', () => {
        const geminiReq: GenerateContentRequest = {
            contents: [
                { role: 'user', parts: [{ text: 'What is the weather?' }] },
                { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { location: 'London', __tool_call_id: 'call_123' } } }] },
                { role: 'function', parts: [{ functionResponse: { name: 'get_weather', response: { temp: 20, __tool_call_id: 'call_123' } } }] },
            ],
        };
        const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');
        const assistantMsg = result.messages[1] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
        expect(assistantMsg.role).toBe('assistant');
        expect(assistantMsg.tool_calls).toHaveLength(1);
        expect(assistantMsg.tool_calls![0].id.startsWith('call_get_weather_')).toBe(true);
        expect((assistantMsg.tool_calls![0] as any).function.name).toBe('get_weather');
        const funcArgs = (assistantMsg.tool_calls![0] as any).function.arguments as any;
        const parsedArgs = typeof funcArgs === 'string' ? JSON.parse(funcArgs) : funcArgs;
        expect(parsedArgs).toEqual({ location: 'London', __tool_call_id: 'call_123' });
        const toolMsg = result.messages[2] as OpenAI.Chat.ChatCompletionToolMessageParam;
        expect(toolMsg.role).toBe('tool');
        expect(toolMsg.tool_call_id.startsWith('call_get_weather_')).toBe(true);
    });

    it('should map tools definition', () => {
        const geminiReq: GenerateContentRequest = {
            contents: [],
            tools: [
                {
                    functionDeclarations: [
                        {
                            name: 'get_weather',
                            description: 'Get weather',
                            parameters: {
                                type: 'OBJECT' as any,
                                properties: { location: { type: 'STRING' as any } },
                            },
                        },
                    ],
                },
            ],
        };
        const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');
        expect(result.tools).toHaveLength(1);
        expect((result.tools![0] as any).function.name).toBe('get_weather');
    });
});
