import type {
    Content,
    Part,
    TextPart,
    InlineDataPart,
    FunctionCallPart,
    FunctionResponsePart,
    FileDataPart,
    ExecutableCodePart,
    CodeExecutionResultPart,
    FinishReason,
} from '@google/generative-ai';

// finish reason
export function mapFinishReason(reason: string | null | undefined): FinishReason {
    switch (reason) {
        case 'stop':
            return 'STOP' as FinishReason;
        case 'length':
            return 'MAX_TOKENS' as FinishReason;
        case 'content_filter':
            return 'SAFETY' as FinishReason;
        case 'tool_calls':
        case 'function_call':
            return 'STOP' as FinishReason;
        default:
            return 'OTHER' as FinishReason;
    }
}

// url helpers
export function extractBaseUrlAndModel(path: string, type: 'generate' | 'stream') {
    const suffix = type === 'generate' ? ':generateContent' : ':streamGenerateContent';
    const parts = path.split('/v1beta/models/');

    if (parts.length < 2) return null;

    let baseUrl = parts[0];
    if (baseUrl.startsWith('/')) baseUrl = baseUrl.substring(1);
    if (!baseUrl) return null;
    if (!baseUrl.startsWith('http')) {
        if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
            baseUrl = `https://${baseUrl}`;
        }
    }

    const modelPart = parts[1];
    const model = modelPart.replace(suffix, '');
    return { baseUrl, model };
}

// type guards & helpers
export function isTextPart(part: Part): part is TextPart {
    return 'text' in part && part.text !== undefined;
}
export function isInlineDataPart(part: Part): part is InlineDataPart {
    return 'inlineData' in part && part.inlineData !== undefined;
}
export function isFunctionCallPart(part: Part): part is FunctionCallPart {
    return 'functionCall' in part && part.functionCall !== undefined;
}
export function isFunctionResponsePart(part: Part): part is FunctionResponsePart {
    return 'functionResponse' in part && part.functionResponse !== undefined;
}
export function isFileDataPart(part: Part): part is FileDataPart {
    return 'fileData' in part && part.fileData !== undefined;
}
export function isExecutableCodePart(part: Part): part is ExecutableCodePart {
    return 'executableCode' in part && part.executableCode !== undefined;
}
export function isCodeExecutionResultPart(part: Part): part is CodeExecutionResultPart {
    return 'codeExecutionResult' in part && part.codeExecutionResult !== undefined;
}
export function isContentObject(value: string | Part | Content): value is Content {
    return typeof value === 'object' && 'parts' in value && 'role' in value;
}
export function isPartObject(value: string | Part | Content): value is Part {
    return typeof value === 'object' && !('role' in value);
}
export function generateToolCallId(functionName: string): string {
    return `call_${functionName}_${Date.now()}`;
}
