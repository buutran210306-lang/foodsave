import { createServer } from "http";
import { app } from "./app";
import { env } from "./config/env";
import { postgresPool } from "./config/postgres";
import { initializeSocketServer } from "./realtime/socketServer";
import { logger } from "./utils/logger";

const server = createServer(app);

initializeSocketServer(server);

server.listen(env.PORT, () => {
  logger.info(`FoodSave API listening on port ${env.PORT}`);
});

const shutdown = (signal: string): void => {
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
