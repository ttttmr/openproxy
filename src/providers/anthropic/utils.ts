import type { Context } from 'hono';

export function parseAnthropicBaseUrl(path: string): string | null {
    const parts = path.split('/v1/messages');
    if (parts.length < 2) return null;

    let baseUrl = parts[0];
    if (baseUrl.startsWith('/')) baseUrl = baseUrl.substring(1);
    if (!baseUrl) return null;
    if (!baseUrl.startsWith('http')) {
        baseUrl = `https://${baseUrl}`;
    }
    return baseUrl;
}

export function extractAnthropicApiKey(c: Context): string | undefined {
    let apiKey = c.req.header('x-api-key');
    if (!apiKey) {
        const authHeader = c.req.header('authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            apiKey = authHeader.substring(7);
        }
    }
    if (!apiKey) {
        apiKey = c.req.query('key') ?? undefined;
    }
    return apiKey;
}

export function mapFinishReason(
    reason: string | null | undefined
): 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null {
    switch (reason) {
        case 'stop':
            return 'end_turn';
        case 'length':
            return 'max_tokens';
        case 'function_call':
        case 'tool_calls':
            return 'tool_use';
        case 'content_filter':
            return null;
        default:
            return null;
    }
}
