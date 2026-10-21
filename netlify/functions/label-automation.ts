import { labelAutomationService } from "../../src/services/labelAutomationService";
import { logger } from "../../src/utils/logger";

// Netlify Scheduled Function (lịch khai báo trong netlify.toml):
// đổi nhãn/giá, gỡ hàng quá giờ, gửi thông báo vàng/đỏ, chia hàng đỏ cho từ thiện.
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  try {
    const result = await labelAutomationService.run();
    logger.info("Label automation finished", result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    logger.error("Label automation failed", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Label automation failed" }) };
  }
};
