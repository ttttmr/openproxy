import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleGenerate, handleStream } from './providers/gemini/handler';
import { handleAnthropic } from './providers/anthropic/handler';

const app = new Hono();

app.use('*', cors());

app.post('*', async (c) => {
    // Check for Anthropic
    if (c.req.path.endsWith('/v1/messages')) {
        return handleAnthropic(c);
    }
    // Check if it is stream or normal
    if (c.req.path.endsWith(':streamGenerateContent')) {
        return handleStream(c);
    }
    if (c.req.path.endsWith(':generateContent')) {
        return handleGenerate(c);
    }
    return c.notFound();
});

app.get('/', (c) => c.text('OpenProxy is running!'));

export default app;
