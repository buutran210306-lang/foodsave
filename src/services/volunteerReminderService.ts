/**
 * Nhắc nhiệm vụ cho TÌNH NGUYỆN VIÊN bằng Web Push: khi nhiệm vụ LẤY HÀNG còn chưa xong và còn <= 30 phút tới hạn
 * (donations.pickup_end). Mỗi nhiệm vụ nhắc đúng MỘT lần (cột donation_assignments.reminder_sent_at, SQL 032).
 * Chạy trong order-automation (mỗi 5 phút).
 */
import { MINUTE_MS } from "../constants/orderPolicy";
import { logger } from "../utils/logger";
import { vnTimeOnDate } from "./candidateBuilder";
import { pushService } from "./pushService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export const VOLUNTEER_REMINDER_MINUTES = 30;

interface AssignmentRow { id: string; donation_id: string; volunteer_id: string }
interface DonationRow { id: string; donation_code: string; status: string; pickup_end: string }

export const volunteerReminderService = {
  async run(): Promise<number> {
    const now = new Date();
    const { data, error } = await supabaseAdmin
      .from("donation_assignments")
      .select("id,donation_id,volunteer_id")
      .eq("stage", "pickup")
      .is("done_at", null)
      .is("reminder_sent_at", null)
      .limit(200);
    if (error) handleSupabaseError(error, "Failed to load volunteer assignments");
    const assignments = (data ?? []) as AssignmentRow[];
    if (assignments.length === 0) return 0;

    const donationIds = [...new Set(assignments.map((row) => row.donation_id))];
    const { data: donations, error: donationError } = await supabaseAdmin
      .from("donations")
      .select("id,donation_code,status,pickup_end")
      .in("id", donationIds)
      .in("status", ["accepted", "in_route"]);
    if (donationError) handleSupabaseError(donationError, "Failed to load donations for reminders");
    const byId = new Map(((donations ?? []) as DonationRow[]).map((row) => [row.id, row]));

    let sent = 0;
    for (const assignment of assignments) {
      const donation = byId.get(assignment.donation_id);
      if (!donation) continue;
      const deadline = vnTimeOnDate(donation.pickup_end, now);
      if (!deadline) continue;
      const remaining = deadline.getTime() - now.getTime();
      if (remaining <= 0 || remaining > VOLUNTEER_REMINDER_MINUTES * MINUTE_MS) continue;

      // Chiếm cờ trước khi gửi: hai lần chạy song song không nhắc trùng
      const { data: claimed } = await supabaseAdmin
        .from("donation_assignments")
        .update({ reminder_sent_at: now.toISOString() })
        .eq("id", assignment.id)
        .is("reminder_sent_at", null)
        .select("id");
      if (!claimed || claimed.length === 0) continue;

      await pushService.sendToVolunteer(assignment.volunteer_id, {
        title: "Nhắc nhiệm vụ lấy hàng",
        body: `Lô ${donation.donation_code} còn khoảng ${Math.max(1, Math.round(remaining / MINUTE_MS))} phút tới hạn lấy hàng.`,
        url: `/FOODSAVE_VOLUNTEER.html#task=${donation.id}`,
        tag: `task-${donation.id}`,
        type: "volunteer-task-reminder"
      });
      sent += 1;
    }
    if (sent > 0) logger.info("Đã nhắc nhiệm vụ cho tình nguyện viên", { sent });
    return sent;
  }
};
