
export function extractBaseUrlAndModel(path: string, type: 'generate' | 'stream') {
    const suffix = type === 'generate' ? ':generateContent' : ':streamGenerateContent';
    const parts = path.split('/v1beta/models/');

    if (parts.length < 2) {
        return null;
    }

    let baseUrl = parts[0];
    // Remove leading slash if present
    if (baseUrl.startsWith('/')) {
        baseUrl = baseUrl.substring(1);
    }

    // If baseUrl is empty, error out (handled by caller checking null/empty or subsequent logic)
    if (!baseUrl) {
        return null;
    } else {
        if (!baseUrl.startsWith('http')) {
            if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
                baseUrl = `https://${baseUrl}`;
            }
        }
    }

    const modelPart = parts[1];
    const model = modelPart.replace(suffix, '');

    return { baseUrl, model };
}
