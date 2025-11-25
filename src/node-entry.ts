import { serve } from '@hono/node-server';
import app from './index';
import { logger } from './logger';

const port = 3000;
logger.info(`Server is running on port ${port}`);

const server = serve({
    fetch: app.fetch,
    port,
});

const GRACEFUL_TIMEOUT_MS = Number(process.env.GRACEFUL_TIMEOUT_MS ?? 10000);

function gracefulShutdown(signal: 'SIGTERM' | 'SIGINT') {
    logger.info(`Received ${signal}, shutting down`);
    try { server.close(); } catch (e) { logger.error('Close server failed', { error: e }); }
    const t = setTimeout(() => { process.exit(0); }, GRACEFUL_TIMEOUT_MS);
    t.unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
