import { describe, it, expect } from 'vitest';
import {
    mapGeminiRequestToOpenAI,
    mapOpenAIResponseToGemini,
    mapOpenAIStreamChunkToGemini,
} from './mapper';
import { GenerateContentRequest, FinishReason, FunctionCallingMode } from '@google/generative-ai';
import OpenAI from 'openai';

describe('Gemini Mapper', () => {
    describe('mapGeminiRequestToOpenAI', () => {
        it('should convert basic Gemini request to OpenAI format', () => {
            const geminiReq: GenerateContentRequest = {
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: 'Hello, Gemini!' }],
                    },
                ],
            };

            const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');

            expect(result.model).toBe('gemini-pro');
            expect(result.messages).toHaveLength(1);
            expect(result.messages[0].role).toBe('user');
            expect(result.messages[0].content).toBe('Hello, Gemini!');
        });

        it('should convert model role to assistant', () => {
            const geminiReq: GenerateContentRequest = {
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: 'Hi' }],
                    },
                    {
                        role: 'model',
                        parts: [{ text: 'Hello!' }],
                    },
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
                    {
                        role: 'user',
                        parts: [
                            { text: 'Part 1' },
                            { text: 'Part 2' },
                        ],
                    },
                ],
            };

            const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');

            expect(result.messages[0].content).toBe('Part 1\nPart 2');
        });

        it('should map generation config parameters', () => {
            const geminiReq: GenerateContentRequest = {
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: 'test' }],
                    },
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
                generationConfig: {
                    maxOutputTokens: 10000,
                },
            };

            const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');

            expect(result.max_completion_tokens).toBe(10000);
        });

        it('should map system instruction', () => {
            const geminiReq: GenerateContentRequest = {
                contents: [],
                systemInstruction: {
                    role: 'system',
                    parts: [{ text: 'Be helpful.' }],
                },
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
                            {
                                inlineData: {
                                    mimeType: 'image/jpeg',
                                    data: 'base64data',
                                },
                            },
                        ],
                    },
                ],
            };

            const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');

            expect(result.messages[0].content).toHaveLength(2);
            const content = result.messages[0].content as OpenAI.Chat.ChatCompletionContentPart[];
            expect(content[0]).toEqual({ type: 'text', text: 'Look at this:' });
            expect(content[1]).toEqual({
                type: 'image_url',
                image_url: { url: 'data:image/jpeg;base64,base64data' },
            });
        });

        it('should map function calls and responses', () => {
            const geminiReq: GenerateContentRequest = {
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: 'What is the weather?' }],
                    },
                    {
                        role: 'model',
                        parts: [
                            {
                                functionCall: {
                                    name: 'get_weather',
                                    args: { location: 'London', __tool_call_id: 'call_123' },
                                },
                            },
                        ],
                    },
                    {
                        role: 'function',
                        parts: [
                            {
                                functionResponse: {
                                    name: 'get_weather',
                                    response: { temp: 20 },
                                },
                            },
                        ],
                    },
                ],
            };

            const result = mapGeminiRequestToOpenAI(geminiReq, 'gemini-pro');

            expect(result.messages).toHaveLength(3);

            // Check assistant message with tool call
            const assistantMsg = result.messages[1] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
            expect(assistantMsg.role).toBe('assistant');
            expect(assistantMsg.tool_calls).toHaveLength(1);
            expect(assistantMsg.tool_calls![0].id).toBe('call_123');
            expect((assistantMsg.tool_calls![0] as any).function.name).toBe('get_weather');
            expect(JSON.parse((assistantMsg.tool_calls![0] as any).function.arguments)).toEqual({ location: 'London' });

            // Check tool message
            const toolMsg = result.messages[2] as OpenAI.Chat.ChatCompletionToolMessageParam;
            expect(toolMsg.role).toBe('tool');
            expect(toolMsg.tool_call_id).toBe('call_123'); // Should match the ID from previous message
            expect(toolMsg.content).toBe(JSON.stringify({ temp: 20 }));
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
                                    properties: {
                                        location: { type: 'STRING' as any },
                                    },
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

    describe('mapOpenAIResponseToGemini', () => {
        it('should convert OpenAI response to Gemini format', () => {
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
                            content: 'This is a response.',
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

            const result = mapOpenAIResponseToGemini(openAIResp);

            expect(result.candidates).toHaveLength(1);
            expect(result.candidates).toBeDefined();
            expect(result.candidates![0].content.role).toBe('model');
            expect(result.candidates![0].content.parts[0].text).toBe('This is a response.');
            expect(result.candidates![0].finishReason).toBe(FinishReason.STOP);
            expect(result.candidates![0].index).toBe(0);
        });

        it('should handle null content (default to empty string)', () => {
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

            const result = mapOpenAIResponseToGemini(openAIResp);

            expect(result.candidates).toBeDefined();
            expect(result.candidates![0].content.parts[0].text).toBe('');
        });

        it('should map tool calls in response', () => {
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
                            tool_calls: [
                                {
                                    id: 'call_123',
                                    type: 'function',
                                    function: {
                                        name: 'get_weather',
                                        arguments: '{"location": "London"}',
                                    },
                                },
                            ],
                            refusal: null,
                        },
                        finish_reason: 'tool_calls',
                        logprobs: null,
                    },
                ],
            };

            const result = mapOpenAIResponseToGemini(openAIResp);

            const part = result.candidates![0].content.parts[0];
            expect(part.functionCall).toBeDefined();
            expect(part.functionCall!.name).toBe('get_weather');
            expect((part.functionCall!.args as any).location).toBe('London');
            expect((part.functionCall!.args as any).__tool_call_id).toBe('call_123');
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
                    id: 'chatcmpl-123',
                    object: 'chat.completion',
                    created: 1677652288,
                    model: 'gpt-4',
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: 'assistant',
                                content: 'test',
                                refusal: null,
                            },
                            finish_reason: openAIReason as any,
                            logprobs: null,
                        },
                    ],
                };

                const result = mapOpenAIResponseToGemini(openAIResp);
                expect(result.candidates).toBeDefined();
                expect(result.candidates![0].finishReason).toBe(expectedGeminiReason);
            });
        });
    });

    describe('mapOpenAIStreamChunkToGemini', () => {
        it('should convert stream chunk with content', () => {
            const chunk: OpenAI.Chat.ChatCompletionChunk = {
                id: 'chatcmpl-123',
                object: 'chat.completion.chunk',
                created: 1677652288,
                model: 'gpt-4',
                choices: [
                    {
                        index: 0,
                        delta: {
                            content: 'Hello',
                        },
                        finish_reason: null,
                        logprobs: null,
                    },
                ],
            };

            const result = mapOpenAIStreamChunkToGemini(chunk);

            expect(result.candidates).toHaveLength(1);
            expect(result.candidates).toBeDefined();
            expect(result.candidates![0].content.parts[0].text).toBe('Hello');
            expect(result.candidates![0].finishReason).toBeUndefined();
        });

        it('should handle chunk with finish_reason', () => {
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

            const result = mapOpenAIStreamChunkToGemini(chunk);

            expect(result.candidates).toBeDefined();
            expect(result.candidates![0].finishReason).toBe(FinishReason.STOP);
        });

        it('should handle empty delta content as empty parts', () => {
            const chunk: OpenAI.Chat.ChatCompletionChunk = {
                id: 'chatcmpl-123',
                object: 'chat.completion.chunk',
                created: 1677652288,
                model: 'gpt-4',
                choices: [
                    {
                        index: 0,
                        delta: {
                            role: 'assistant',
                        },
                        finish_reason: null,
                        logprobs: null,
                    },
                ],
            };

            const result = mapOpenAIStreamChunkToGemini(chunk);

            expect(result.candidates).toBeDefined();
            expect(result.candidates![0].content.parts).toHaveLength(0);
        });
    });
});
