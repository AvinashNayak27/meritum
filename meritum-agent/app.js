import 'dotenv/config';

import { App, LogLevel } from '@slack/bolt';

import { migrateDatabase } from './db/migrate.js';
import { registerListeners } from './listeners/index.js';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
  ignoreSelf: false,
});

registerListeners(app);

(async () => {
  await migrateDatabase();
  await app.start();
  app.logger.info('MERITUM is running!');
})();
