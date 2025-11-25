import type { Content, GenerateContentRequest, Part, FunctionDeclaration } from '@google/generative-ai';
import type OpenAI from 'openai';
import { logger } from '../../logger';
import {
    isTextPart,
    isInlineDataPart,
    isFunctionCallPart,
    isFunctionResponsePart,
    isFileDataPart,
    isExecutableCodePart,
    isCodeExecutionResultPart,
    isContentObject,
    isPartObject,
    generateToolCallId,
} from './utils';

export function mapGeminiRequestToOpenAI(
    geminiReq: GenerateContentRequest,
    model: string
): OpenAI.Chat.ChatCompletionCreateParams {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (geminiReq.systemInstruction) {
        const systemMessage = convertSystemInstructionToOpenAI(geminiReq.systemInstruction);
        if (systemMessage) messages.push(systemMessage);
    }

    if (geminiReq.contents) {
        for (const content of geminiReq.contents) {
            const openAIMessages = convertGeminiContentToOpenAI(content);
            messages.push(...openAIMessages);
        }
    }

    const openAIReq: OpenAI.Chat.ChatCompletionCreateParams = { model, messages };

    if (geminiReq.tools && geminiReq.tools.length > 0) {
        openAIReq.tools = geminiReq.tools.flatMap(tool => {
            if ('functionDeclarations' in tool && tool.functionDeclarations) {
                return tool.functionDeclarations.map(mapGeminiFunctionToOpenAI);
            }
            return [];
        });
    }

    if (geminiReq.toolConfig && geminiReq.toolConfig.functionCallingConfig) {
        const mode = geminiReq.toolConfig.functionCallingConfig.mode;
        if (mode === 'ANY') openAIReq.tool_choice = 'required';
        else if (mode === 'NONE') openAIReq.tool_choice = 'none';
        else if (mode === 'AUTO') openAIReq.tool_choice = 'auto';

        const allowed = geminiReq.toolConfig.functionCallingConfig.allowedFunctionNames;
        if (allowed && allowed.length > 0) {
            openAIReq.tool_choice = { type: 'function', function: { name: allowed[0] } };
            if (allowed.length > 1) {
                logger.warn('OpenAI does not support multiple allowed functions; using first only', { allowed });
            }
        }
    }

    if (geminiReq.generationConfig) {
        const g = geminiReq.generationConfig;
        if (g.temperature !== undefined) openAIReq.temperature = g.temperature;
        if (g.topP !== undefined) openAIReq.top_p = g.topP;
        if (g.maxOutputTokens !== undefined) openAIReq.max_completion_tokens = g.maxOutputTokens;
        if (g.stopSequences !== undefined) openAIReq.stop = g.stopSequences;
        if (g.candidateCount !== undefined) openAIReq.n = g.candidateCount;
        if (g.presencePenalty !== undefined) openAIReq.presence_penalty = g.presencePenalty;
        if (g.frequencyPenalty !== undefined) openAIReq.frequency_penalty = g.frequencyPenalty;
        if (g.responseLogprobs !== undefined) openAIReq.logprobs = g.responseLogprobs;
        if (g.logprobs !== undefined) openAIReq.top_logprobs = g.logprobs;
        if (g.responseMimeType === 'application/json') {
            openAIReq.response_format = { type: 'json_object' } as any;
        }
    }

    if (geminiReq.safetySettings && geminiReq.safetySettings.length > 0) {
        logger.warn('OpenAI does not support Gemini safety settings; ignored', { safetySettingsCount: geminiReq.safetySettings.length });
    }
    if (geminiReq.cachedContent) {
        logger.warn('OpenAI does not support cached content; ignored', { cachedContent: geminiReq.cachedContent });
    }

    return openAIReq;
}

function convertSystemInstructionToOpenAI(
    systemInstruction: string | Part | Content
): OpenAI.Chat.ChatCompletionSystemMessageParam | null {
    if (typeof systemInstruction === 'string') {
        return { role: 'system', content: systemInstruction };
    }
    if (isContentObject(systemInstruction)) {
        const systemContent = systemInstruction.parts.filter(isTextPart).map(p => p.text).join('\n');
        if (systemContent) return { role: 'system', content: systemContent };
    }
    if (isPartObject(systemInstruction) && isTextPart(systemInstruction)) {
        return { role: 'system', content: systemInstruction.text };
    }
    return null;
}

function convertGeminiContentToOpenAI(content: Content): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const parts = content.parts || [];

    const functionCalls = parts.filter(isFunctionCallPart);
    if (functionCalls.length > 0) {
        const assistantMessage = convertFunctionCallsToAssistantMessage(parts, functionCalls);
        if (assistantMessage) messages.push(assistantMessage);
        return messages;
    }

    const functionResponses = parts.filter(isFunctionResponsePart);
    if (functionResponses.length > 0) {
        const toolMessages = convertFunctionResponsesToToolMessages(functionResponses);
        messages.push(...toolMessages);
        return messages;
    }

    const standardMessage = convertStandardContentToMessage(content, parts);
    if (standardMessage) messages.push(standardMessage);
    return messages;
}

function convertFunctionCallsToAssistantMessage(
    allParts: Part[],
    functionCalls: any[]
): OpenAI.Chat.ChatCompletionAssistantMessageParam | null {
    const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = functionCalls.map((part: any) => {
        const fc = part.functionCall;
        const args = fc.args;

        let id: string;
        // 优先使用函数调用对象上的 id（来自客户端或上游的 tool_call.id）
        if ((fc as any).id && typeof (fc as any).id === 'string') {
            id = (fc as any).id;
        } else {
            id = generateToolCallId(fc.name);
        }

        return {
            id,
            type: 'function',
            function: { name: fc.name, arguments: args },
        };
    });

    const otherParts = allParts.filter(p => !isFunctionCallPart(p));
    const textContent = otherParts.length > 0 ? convertPartsToOpenAIContent(otherParts) : null;

    return { role: 'assistant', content: typeof textContent === 'string' ? textContent : null, tool_calls: toolCalls };
}

function convertFunctionResponsesToToolMessages(functionResponses: any[]): OpenAI.Chat.ChatCompletionToolMessageParam[] {
    return functionResponses.map((part: any) => {
        const fr = part.functionResponse;
        let id: string | undefined;
        let responseContent: object;

        const response = fr.response;
        // 1) 优先使用 functionResponse.id（期望来自客户端回传的调用id）
        if ((fr as any).id && typeof (fr as any).id === 'string') {
            id = (fr as any).id;
            responseContent = response;
        } else {
            // 3) 兜底：根据响应内容生成一个稳定 id（可能无法与调用对齐）
            responseContent = response;
        }

        // 若仍未找到id，最后兜底为函数名+响应生成一个稳定id（可能无法匹配之前的调用）
        if (!id) {
            id = generateToolCallId(fr.name);
        }

        return { role: 'tool', tool_call_id: id, content: JSON.stringify(responseContent) } as OpenAI.Chat.ChatCompletionToolMessageParam;
    });
}

function convertStandardContentToMessage(content: Content, parts: Part[]): OpenAI.Chat.ChatCompletionMessageParam | null {
    const contentParam = convertPartsToOpenAIContent(parts);
    if (!contentParam || (typeof contentParam === 'string' && contentParam.trim() === '') || (Array.isArray(contentParam) && contentParam.length === 0)) {
        logger.warn('Skipping empty content message', { role: content.role, partsCount: parts.length });
        return null;
    }

    if (content.role === 'model') {
        const textContent = typeof contentParam === 'string' ? contentParam : contentParam.filter(p => p.type === 'text').map(p => 'text' in p ? (p as any).text : '').join('\n');
        if (!textContent || textContent.trim() === '') {
            logger.warn('Skipping model message with no text content (only non-text parts)', { role: content.role, partsCount: parts.length });
            return null;
        }
        return { role: 'assistant', content: textContent };
    } else {
        return { role: 'user', content: contentParam };
    }
}

function convertPartsToOpenAIContent(parts: Part[]): string | Array<OpenAI.Chat.ChatCompletionContentPart> {
    if (!parts || parts.length === 0) return '';
    const textParts = parts.filter(isTextPart);
    const hasOnlyText = textParts.length === parts.length;
    if (hasOnlyText) {
        const text = textParts.map(p => p.text).filter(t => t !== undefined && t !== null).join('\n');
        return text;
    }

    const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [];
    for (const part of parts) {
        const converted = convertPartToOpenAIContentPart(part);
        if (converted) contentParts.push(converted);
    }
    return contentParts;
}

function convertPartToOpenAIContentPart(part: Part): OpenAI.Chat.ChatCompletionContentPart | null {
    if (isTextPart(part)) return { type: 'text', text: part.text } as any;
    if (isInlineDataPart(part)) {
        return { type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } } as any;
    }
    if (isFileDataPart(part)) {
        logger.warn('FileData parts are not supported in OpenAI, skipping', { fileUri: part.fileData.fileUri, mimeType: part.fileData.mimeType });
        return null;
    }
    if (isExecutableCodePart(part)) {
        logger.warn('ExecutableCode parts are not supported in OpenAI, skipping', { language: part.executableCode.language });
        return null;
    }
    if (isCodeExecutionResultPart(part)) {
        logger.warn('CodeExecutionResult parts are not supported in OpenAI, skipping', { outcome: part.codeExecutionResult.outcome });
        return null;
    }
    if (isFunctionCallPart(part) || isFunctionResponsePart(part)) return null;
    return null;
}

function mapGeminiFunctionToOpenAI(fn: FunctionDeclaration): OpenAI.Chat.ChatCompletionTool {
    const parameters = fn.parameters as Record<string, unknown> | undefined;
    return { type: 'function', function: { name: fn.name, description: fn.description, parameters: parameters ?? {} } } as any;
}
