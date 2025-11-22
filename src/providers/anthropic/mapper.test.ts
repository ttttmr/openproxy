import { describe, it, expect } from 'vitest';
import {
    mapAnthropicRequestToOpenAI,
    mapOpenAIResponseToAnthropic,
    mapOpenAIStreamChunkToAnthropic,
} from './mapper';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

describe('Anthropic Mapper', () => {
    describe('mapAnthropicRequestToOpenAI', () => {
        it('should convert basic Anthropic request to OpenAI format', () => {
            const anthropicReq: Anthropic.MessageCreateParams = {
                model: 'claude-3-opus-20240229',
                max_tokens: 1024,
                messages: [
                    {
                        role: 'user',
                        content: 'Hello, Claude!',
                    },
                ],
            };

            const result = mapAnthropicRequestToOpenAI(anthropicReq);

            expect(result.model).toBe('claude-3-opus-20240229');
            expect(result.messages).toHaveLength(1);
            expect(result.messages[0].role).toBe('user');
            expect(result.messages[0].content).toBe('Hello, Claude!');
            expect(result.max_tokens).toBe(1024);
        });

        it('should handle system prompt correctly', () => {
            const anthropicReq: Anthropic.MessageCreateParams = {
                model: 'claude-3-opus-20240229',
                max_tokens: 1024,
                system: 'You are a helpful assistant.',
                messages: [
                    {
                        role: 'user',
                        content: 'Hello!',
                    },
                ],
            };

            const result = mapAnthropicRequestToOpenAI(anthropicReq);

            expect(result.messages).toHaveLength(2);
            expect(result.messages[0].role).toBe('system');
            expect(result.messages[0].content).toBe('You are a helpful assistant.');
        });

        it('should handle array content blocks', () => {
            const anthropicReq: Anthropic.MessageCreateParams = {
                model: 'claude-3-opus-20240229',
                max_tokens: 1024,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Hello' },
                            { type: 'text', text: 'World' },
                        ],
                    },
                ],
            };

            const result = mapAnthropicRequestToOpenAI(anthropicReq);

            expect(result.messages[0].content).toBe('Hello\nWorld');
        });

        it('should map temperature and top_p', () => {
            const anthropicReq: Anthropic.MessageCreateParams = {
                model: 'claude-3-opus-20240229',
                max_tokens: 1024,
                temperature: 0.7,
                top_p: 0.9,
                messages: [{ role: 'user', content: 'test' }],
            };

            const result = mapAnthropicRequestToOpenAI(anthropicReq);

            expect(result.top_p).toBe(0.9);
        });

        it('should convert image content block to OpenAI format', () => {
            const anthropicReq: Anthropic.MessageCreateParams = {
                model: 'claude-3-opus-20240229',
                max_tokens: 1024,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'What is in this image?' },
                            {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: 'image/jpeg',
                                    data: 'base64data',
                                },
                            },
                        ],
                    },
                ],
            };

            const result = mapAnthropicRequestToOpenAI(anthropicReq);

            expect(result.messages).toHaveLength(1);
            const content = result.messages[0].content;
            expect(Array.isArray(content)).toBe(true);
            if (Array.isArray(content)) {
                expect(content).toHaveLength(2);
                expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' });
                expect(content[1]).toEqual({
                    type: 'image_url',
                    image_url: {
                        url: 'data:image/jpeg;base64,base64data',
                    },
                });
            }
        });
    });

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
            expect(result.content).toHaveLength(1);
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
                        delta: {
                            role: 'assistant',
                        },
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
                        delta: {
                            content: 'Hello',
                        },
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
});
