import app from "./app";
import { logger } from "./lib/logger";
import { startScoreSync } from "./lib/scoreSync.js";
import { startUserWatcher } from "./lib/userWatcher.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start the automated Masters score sync
  startScoreSync();

  // Start email notifications for signups and approvals
  startUserWatcher().catch(err => logger.error({ err }, 'User watcher failed to start'));
});
