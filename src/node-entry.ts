import { serve } from '@hono/node-server';
import app from './index';

import { logger } from './logger';

const port = 3000;
logger.info(`Server is running on port ${port}`);

serve({
    fetch: app.fetch,
    port,
});
