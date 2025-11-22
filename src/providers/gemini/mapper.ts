import {
    Content,
    GenerateContentRequest,
    GenerateContentResponse,
    Part,
    GenerateContentCandidate,
    FinishReason,
    Tool,
    ToolConfig,
    FunctionDeclaration,
    FunctionCallingMode
} from '@google/generative-ai';
import OpenAI from 'openai';
import { logger } from '../../logger';

// Helper to track tool call IDs across the request
// We use a simple map of function name to a queue of IDs
// This assumes that function calls and responses are processed in order
type ToolCallIdMap = Map<string, string[]>;

export function mapGeminiRequestToOpenAI(geminiReq: GenerateContentRequest, model: string): OpenAI.Chat.ChatCompletionCreateParams {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const toolCallIds: ToolCallIdMap = new Map();

    // 1. Handle System Instruction
    if (geminiReq.systemInstruction) {
        if (typeof geminiReq.systemInstruction === 'string') {
            messages.push({
                role: 'system',
                content: geminiReq.systemInstruction,
            });
        } else if ((geminiReq.systemInstruction as any).parts) {
            const parts = (geminiReq.systemInstruction as any).parts;
            const systemParts = Array.isArray(parts) ? parts : [parts];

            const systemContent = systemParts
                .filter((p: Part) => p.text)
                .map((p: Part) => p.text)
                .join('\n');

            if (systemContent) {
                messages.push({
                    role: 'system',
                    content: systemContent,
                });
            }
        }
    }

    // 2. Handle Contents
    if (geminiReq.contents) {
        for (const content of geminiReq.contents) {
            const openAIMessages = convertGeminiContentToOpenAI(content, toolCallIds);
            messages.push(...openAIMessages);
        }
    }

    const openAIReq: OpenAI.Chat.ChatCompletionCreateParams = {
        model: model,
        messages,
    };

    // 3. Handle Tools
    if (geminiReq.tools && geminiReq.tools.length > 0) {
        openAIReq.tools = geminiReq.tools.flatMap(tool => {
            if ('functionDeclarations' in tool && tool.functionDeclarations) {
                return tool.functionDeclarations.map(mapGeminiFunctionToOpenAI);
            }
            return [];
        });
    }

    // 4. Handle Tool Config
    if (geminiReq.toolConfig && geminiReq.toolConfig.functionCallingConfig) {
        const mode = geminiReq.toolConfig.functionCallingConfig.mode;
        if (mode === FunctionCallingMode.ANY) {
            openAIReq.tool_choice = 'required'; // Closest approximation
        } else if (mode === FunctionCallingMode.NONE) {
            openAIReq.tool_choice = 'none';
        } else {
            openAIReq.tool_choice = 'auto';
        }
    }

    // 5. Handle Generation Config
    if (geminiReq.generationConfig) {
        if (geminiReq.generationConfig.temperature !== undefined) {
            openAIReq.temperature = geminiReq.generationConfig.temperature;
        }
        if (geminiReq.generationConfig.topP !== undefined) {
            openAIReq.top_p = geminiReq.generationConfig.topP;
        }
        if (geminiReq.generationConfig.maxOutputTokens !== undefined) {
            openAIReq.max_completion_tokens = geminiReq.generationConfig.maxOutputTokens;
        }
        if (geminiReq.generationConfig.stopSequences !== undefined) {
            openAIReq.stop = geminiReq.generationConfig.stopSequences;
        }
        if (geminiReq.generationConfig.candidateCount !== undefined) {
            openAIReq.n = geminiReq.generationConfig.candidateCount;
        }
    }

    return openAIReq;
}

function convertGeminiContentToOpenAI(content: Content, toolCallIds: ToolCallIdMap): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const parts = content.parts || [];

    // Check for function calls (Model -> Assistant)
    const functionCalls = parts.filter(p => 'functionCall' in p);
    if (functionCalls.length > 0) {
        const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = functionCalls.map((p, index) => {
            const fc = p.functionCall!;
            // Extract ID from args if present (injected by us previously)
            let id = `call_${Math.random().toString(36).substring(2, 11)}`;
            const args = { ...fc.args } as any;

            if (args.__tool_call_id) {
                id = args.__tool_call_id;
                delete args.__tool_call_id;
            }

            // Store ID for future matching
            const ids = toolCallIds.get(fc.name) || [];
            ids.push(id);
            toolCallIds.set(fc.name, ids);

            return {
                id: id,
                type: 'function',
                function: {
                    name: fc.name,
                    arguments: JSON.stringify(args),
                },
            };
        });

        messages.push({
            role: 'assistant',
            content: null, // Tool calls usually have null content
            tool_calls: toolCalls,
        });

        const otherParts = parts.filter(p => !('functionCall' in p));
        if (otherParts.length > 0) {
            (messages[messages.length - 1] as any).content = convertPartsToOpenAIContent(otherParts);
        }
        return messages;
    }

    // Check for function responses (Function -> Tool)
    const functionResponses = parts.filter(p => 'functionResponse' in p);
    if (functionResponses.length > 0) {
        for (const p of functionResponses) {
            const fr = p.functionResponse!;
            // Retrieve ID
            const ids = toolCallIds.get(fr.name) || [];
            const id = ids.shift() || 'call_unknown'; // Fallback if ID lost

            messages.push({
                role: 'tool',
                tool_call_id: id,
                content: JSON.stringify(fr.response),
            });
        }
        return messages;
    }

    // Standard User/Model content (Text/Images)
    let role: 'user' | 'assistant' | 'system' = 'user';
    if (content.role === 'model') role = 'assistant';
    else if (content.role === 'user') role = 'user';

    const contentParam = convertPartsToOpenAIContent(parts);

    messages.push({
        role: role,
        content: contentParam as any, // Cast to avoid complex union type issues
    });

    return messages;
}

function convertPartsToOpenAIContent(parts: Part[]): string | Array<OpenAI.Chat.ChatCompletionContentPart> {
    // If only text parts, return string
    const isAllText = parts.every(p => 'text' in p && !('inlineData' in p));
    if (isAllText) {
        return parts.map(p => p.text).join('\n');
    }

    // Mixed content
    return parts.map(p => {
        if ('text' in p && p.text) {
            return { type: 'text', text: p.text };
        }
        if ('inlineData' in p && p.inlineData) {
            return {
                type: 'image_url',
                image_url: {
                    url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,
                },
            };
        }
        // Fallback for unsupported parts
        return { type: 'text', text: '[Unsupported Content Part]' };
    });
}

function mapGeminiFunctionToOpenAI(fn: FunctionDeclaration): OpenAI.Chat.ChatCompletionTool {
    return {
        type: 'function',
        function: {
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters as any, // Schema compatibility assumed
        },
    };
}

export function mapOpenAIResponseToGemini(openAIResp: OpenAI.Chat.ChatCompletion): GenerateContentResponse {
    const candidates: GenerateContentCandidate[] = openAIResp.choices.map((choice) => {
        const parts: Part[] = [];

        // 1. Handle Content (Text)
        if (choice.message.content !== null && choice.message.content !== undefined) {
            parts.push({ text: choice.message.content });
        }

        // 2. Handle Tool Calls
        if (choice.message.tool_calls) {
            for (const toolCall of choice.message.tool_calls) {
                if (toolCall.type === 'function') {
                    let args = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        logger.error('Failed to parse tool arguments', { error: e });
                    }

                    // Inject ID for state preservation
                    (args as any).__tool_call_id = toolCall.id;

                    parts.push({
                        functionCall: {
                            name: toolCall.function.name,
                            args: args,
                        },
                    });
                }
            }
        }

        // Ensure at least one part (Gemini requirement)
        if (parts.length === 0) {
            parts.push({ text: '' });
        }

        return {
            content: {
                role: 'model',
                parts: parts,
            },
            finishReason: mapFinishReason(choice.finish_reason),
            index: choice.index,
        };
    });

    return {
        candidates,
    } as GenerateContentResponse;
}

export function mapOpenAIStreamChunkToGemini(chunk: OpenAI.Chat.ChatCompletionChunk): GenerateContentResponse {
    const candidates: GenerateContentCandidate[] = chunk.choices.map((choice) => {
        const parts: Part[] = [];

        if (choice.delta.content !== null && choice.delta.content !== undefined) {
            parts.push({ text: choice.delta.content });
        }

        // We don't map partial tool calls here because Gemini expects full objects.
        // The handler is responsible for buffering tool calls.

        return {
            content: {
                role: 'model',
                parts: parts,
            },
            finishReason: choice.finish_reason ? mapFinishReason(choice.finish_reason) : undefined,
            index: choice.index,
        };
    });

    return {
        candidates,
    } as GenerateContentResponse;
}

function mapFinishReason(reason: string | null | undefined): FinishReason {
    switch (reason) {
        case 'stop':
            return FinishReason.STOP;
        case 'length':
            return FinishReason.MAX_TOKENS;
        case 'content_filter':
            return FinishReason.SAFETY;
        case 'tool_calls':
        case 'function_call':
            return FinishReason.STOP;
        default:
            return FinishReason.OTHER;
    }
}
