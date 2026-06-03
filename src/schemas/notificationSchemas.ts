import { z } from "zod";

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread_only: z.coerce.boolean().default(false)
}).strict();

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
