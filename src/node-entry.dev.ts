import { serve } from '@hono/node-server';
import app from './index';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { logger } from './logger';

// 本地开发环境：配置出站 HTTP(S) 代理，并关闭 TLS 校验
const proxyUrl = process.env.OPENPROXY_HTTP_PROXY ?? 'http://127.0.0.1:9090';
try {
    const dispatcher = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(dispatcher);
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    logger.info(`Using outbound proxy: ${proxyUrl} (TLS verification disabled)`);
} catch (e) {
    logger.error('Failed to configure proxy', { error: e });
}

const port = Number(process.env.PORT ?? 3000);
logger.info(`Dev server is running on port ${port}`);

serve({
    fetch: app.fetch,
    port,
});

