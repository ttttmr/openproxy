import { describe, it, expect } from 'vitest';
import { mapAnthropicRequestToOpenAI } from './request';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

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
        expect(result.max_completion_tokens).toBe(1024);
    });

    it('should map max_tokens to max_completion_tokens', () => {
        const anthropicReq: Anthropic.MessageCreateParams = {
            model: 'claude-3-opus-20240229',
            max_tokens: 10000,
            messages: [{ role: 'user', content: 'test' }],
        };

        const result = mapAnthropicRequestToOpenAI(anthropicReq);

        expect(result.max_completion_tokens).toBe(10000);
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

        expect(Array.isArray(result.messages[0].content)).toBe(true);
        const content = result.messages[0].content as any[];
        expect(content[0]).toEqual({ type: 'text', text: 'Hello' });
        expect(content[1]).toEqual({ type: 'text', text: 'World' });
    });

    it('should NOT map metadata.user_id to user', () => {
        const anthropicReq: Anthropic.MessageCreateParams = {
            model: 'claude-3-opus-20240229',
            max_tokens: 1024,
            metadata: { user_id: 'user-123' },
            messages: [{ role: 'user', content: 'test' }],
        };

        const result = mapAnthropicRequestToOpenAI(anthropicReq);
        expect((result as any).user).toBeUndefined();
    });

    it('should handle mixed content in User message (text + tool_result)', () => {
        const anthropicReq: Anthropic.MessageCreateParams = {
            model: 'claude-3-opus-20240229',
            max_tokens: 1024,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Result is:' },
                        { type: 'tool_result', tool_use_id: 'tool-1', content: '42' },
                        { type: 'text', text: 'Cool.' }
                    ],
                },
            ],
        };

        const result = mapAnthropicRequestToOpenAI(anthropicReq);
        expect(result.messages).toHaveLength(3);
        expect(result.messages[0].role).toBe('user');
        expect(result.messages[0].content).toBe('Result is:');
        expect(result.messages[1].role).toBe('tool');
        expect((result.messages[1] as any).tool_call_id).toBe('tool-1');
        expect(result.messages[2].role).toBe('user');
        expect(result.messages[2].content).toBe('Cool.');
    });

    it('should handle Assistant message with text and tool_use', () => {
        const anthropicReq: Anthropic.MessageCreateParams = {
            model: 'claude-3-opus-20240229',
            max_tokens: 1024,
            messages: [
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Thinking...' },
                        { type: 'tool_use', id: 'tool-1', name: 'calc', input: { x: 1 } }
                    ],
                },
            ],
        };

        const result = mapAnthropicRequestToOpenAI(anthropicReq);
        expect(result.messages).toHaveLength(1);
        const msg = result.messages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
        expect(msg.role).toBe('assistant');
        expect(msg.content).toBe('Thinking...');
        expect(msg.tool_calls).toHaveLength(1);
        expect((msg.tool_calls?.[0] as any).function.name).toBe('calc');
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
        const content = result.messages[0].content as any[];
        expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' });
        expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,base64data' } });
    });

    it('should skip thinking blocks', () => {
        const anthropicReq: Anthropic.MessageCreateParams = {
            model: 'claude-3-opus-20240229',
            max_tokens: 1024,
            messages: [
                {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', signature: 'sig', thinking: 'hmm' } as any,
                        { type: 'text', text: 'Hello' }
                    ],
                },
            ],
        };

        const result = mapAnthropicRequestToOpenAI(anthropicReq);
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0].content).toBe('Hello');
    });

    it('should handle image content block with url source', () => {
        const anthropicReq: Anthropic.MessageCreateParams = {
            model: 'claude-3-opus-20240229',
            max_tokens: 1024,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'url',
                                url: 'https://example.com/image.jpg',
                            },
                        },
                    ],
                },
            ],
        };

        const result = mapAnthropicRequestToOpenAI(anthropicReq);
        const content = result.messages[0].content as any[];
        expect(content).toHaveLength(1);
        expect(content[0]).toEqual({ type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } });
    });
});

