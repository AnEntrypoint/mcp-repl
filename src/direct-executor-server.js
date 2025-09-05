#!/usr/bin/env node
// Minimal delegate entrypoint — start the consolidated main server
import { startServer } from './server-core.js';

startServer().catch((err) => {
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) console.error('[START ERROR]', err);
  process.exit(1);
});
