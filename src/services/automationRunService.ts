/**
 * Nhật ký chạy tác vụ tự động (bảng automation_runs, SQL 036). Ghi lỗi nhật ký KHÔNG làm hỏng tác vụ.
 * Các tác vụ: label-automation, order-automation, complaint-escalation, push-reminders.
 */
import { logger } from "../utils/logger";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export const AUTOMATION_JOBS = ["label-automation", "order-automation", "complaint-escalation", "push-reminders"] as const;
export type AutomationJob = (typeof AUTOMATION_JOBS)[number];
export type AutomationTrigger = "schedule" | "manual";

const JOB_LABEL: Record<AutomationJob, { name: string; every: string }> = {
  "label-automation": { name: "Đổi nhãn / giá / chia hàng đỏ", every: "mỗi 5 phút" },
  "order-automation": { name: "Đơn hàng: quá hạn thanh toán, vắng mặt, nhắc lấy hàng", every: "mỗi 5 phút" },
  "complaint-escalation": { name: "Khiếu nại: tự chuyển Admin sau 12 giờ, hoàn tất hoàn tiền dang dở", every: "chạy cùng tác vụ đơn hàng (5 phút)" },
  "push-reminders": { name: "Thông báo đẩy: nhắc nhiệm vụ tình nguyện viên", every: "chạy cùng tác vụ đơn hàng (5 phút)" }
};

export const automationRunService = {
  async record(job: AutomationJob, trigger: AutomationTrigger, startedAt: Date, summary: Record<string, unknown>, error: string | null): Promise<void> {
    try {
      const { error: dbError } = await supabaseAdmin.from("automation_runs").insert({
        job,
        trigger,
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        ok: error === null,
        summary,
        error
      });
      if (dbError) logger.warn("Không ghi được nhật ký tác vụ tự động", { job, error: dbError });
    } catch (dbError) {
      logger.warn("Không ghi được nhật ký tác vụ tự động", { job, error: dbError });
    }
  },

  /** Chạy một việc, ghi kết quả (thành công hoặc lỗi) rồi trả lại / ném lại kết quả gốc */
  async track<T extends object>(job: AutomationJob, trigger: AutomationTrigger, work: () => Promise<T>): Promise<T> {
    const startedAt = new Date();
    try {
      const result = await work();
      const errors = (result as { errors?: unknown }).errors;
      const firstErrors = Array.isArray(errors) && errors.length > 0 ? errors.map(String).join("; ").slice(0, 500) : null;
      await this.record(job, trigger, startedAt, result as Record<string, unknown>, firstErrors);
      return result;
    } catch (error) {
      await this.record(job, trigger, startedAt, {}, (error instanceof Error ? error.message : String(error)).slice(0, 500));
      throw error;
    }
  },

  /** Mỗi tác vụ: lần chạy gần nhất + lần lỗi gần nhất + 5 lần chạy cuối (7 ngày) */
  async overview(): Promise<Array<Record<string, unknown>>> {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("automation_runs")
      .select("id,job,trigger,started_at,finished_at,ok,summary,error")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(400);
    if (error) handleSupabaseError(error, "Failed to load automation runs");
    const rows = (data ?? []) as Array<{ job: string; trigger: string; started_at: string; finished_at: string | null; ok: boolean; summary: unknown; error: string | null }>;
    return AUTOMATION_JOBS.map((job) => {
      const runs = rows.filter((row) => row.job === job);
      const last = runs[0] ?? null;
      const lastFail = runs.find((row) => !row.ok) ?? null;
      return {
        job,
        name: JOB_LABEL[job].name,
        schedule: JOB_LABEL[job].every,
        last_run: last,
        last_failure: lastFail ? { started_at: lastFail.started_at, error: lastFail.error } : null,
        runs_7d: runs.length,
        failures_7d: runs.filter((row) => !row.ok).length,
        recent: runs.slice(0, 5)
      };
    });
  }
};
