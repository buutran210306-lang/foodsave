import { createServer } from "http";
import { app } from "./app";
import { env } from "./config/env";
import { isPostgresAvailable, postgresPool } from "./config/postgres";
import { initializeSocketServer } from "./realtime/socketServer";
import { labelAutomationService } from "./services/labelAutomationService";
import { logger } from "./utils/logger";

const server = createServer(app);

initializeSocketServer(server);

// Kiểm tra sớm kết nối PostgreSQL để các yêu cầu đầu tiên không phải chờ
void isPostgresAvailable();

server.listen(env.PORT, () => {
  logger.info(`FoodSave API listening on port ${env.PORT}`);
});

const runLabelAutomation = (): void => {
  labelAutomationService
    .run()
    .then((result) => logger.info("Label automation finished", result))
    .catch((error: unknown) => logger.error("Label automation failed", error));
};

const labelAutomationTimer = env.LABEL_AUTOMATION_INTERVAL_MS > 0
  ? setInterval(runLabelAutomation, env.LABEL_AUTOMATION_INTERVAL_MS)
  : null;
if (labelAutomationTimer) runLabelAutomation();

const shutdown = (signal: string): void => {
  if (labelAutomationTimer) clearInterval(labelAutomationTimer);
  logger.info(`Received ${signal}. Closing HTTP server.`);
  server.close((error) => {
    if (error) {
      logger.error("Failed to close HTTP server", error);
      process.exit(1);
    }

    postgresPool
      .end()
      .then(() => {
        process.exit(0);
      })
      .catch((poolError: unknown) => {
        logger.error("Failed to close PostgreSQL pool", poolError);
        process.exit(1);
      });
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
