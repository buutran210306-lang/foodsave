import { logger } from "../utils/logger";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export interface AuditActor { userId: string; name?: string | null }

export const adminAuditService = {
  /** Ghi nhật ký thao tác Admin. Không bao giờ làm hỏng thao tác chính: lỗi ghi chỉ được cảnh báo. */
  async log(actor: AuditActor | null, action: string, targetType: string | null, targetId: string | null, detail: Record<string, unknown> = {}): Promise<void> {
    try {
      const { error } = await supabaseAdmin.from("admin_audit_log").insert({
        actor_id: actor?.userId ?? null,
        actor_name: actor?.name ?? null,
        action,
        target_type: targetType,
        target_id: targetId,
        detail
      });
      if (error) logger.warn("Không ghi được nhật ký Admin", { action, error });
    } catch (error) {
      logger.warn("Không ghi được nhật ký Admin", { action, error });
    }
  },

  async list(limit = 100): Promise<Array<Record<string, unknown>>> {
    const { data, error } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id,actor_id,actor_name,action,target_type,target_id,detail,created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 300));
    if (error) handleSupabaseError(error, "Failed to load audit log");
    return (data ?? []) as Array<Record<string, unknown>>;
  }
};
