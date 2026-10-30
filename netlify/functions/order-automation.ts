import { orderAutomationService } from "../../src/services/orderAutomationService";
import { automationRunService } from "../../src/services/automationRunService";
import { logger } from "../../src/utils/logger";

// Netlify Scheduled Function (lịch khai báo trong netlify.toml):
// hủy đơn quá hạn thanh toán, đánh dấu vắng mặt, nhắc lấy hàng, dọn chat cũ.
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
  try {
    const result = await automationRunService.track("order-automation", "schedule", () => orderAutomationService.run());
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    logger.error("Order automation failed", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Order automation failed" }) };
  }
};
