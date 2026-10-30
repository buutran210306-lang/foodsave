/**
 * Khiếu nại ĐÚNG: trừ 15 điểm uy tín cửa hàng và ghi seller_violations (loại COMPLAINT_UPHELD).
 * Dùng Supabase client (không cần kết nối PostgreSQL trực tiếp) nên chạy được cả khi chưa đặt DATABASE_URL.
 * Sau khi trừ điểm gọi checkAndApplyPenalties (cơ chế ngưỡng sẵn có: < 85 hạn chế 48 giờ, < 40 cấm) nếu có PostgreSQL.
 */
import { logger } from "../utils/logger";
import { sellerReputationService } from "./sellerReputationService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export const COMPLAINT_UPHELD_PENALTY_POINTS = 15;

interface ReputationRow { seller_id: string; trust_score: number; rating_avg: number | string; status: string }

const loadReputation = async (sellerId: string): Promise<ReputationRow> => {
  const { data, error } = await supabaseAdmin.from("seller_reputation").select("seller_id,trust_score,rating_avg,status").eq("seller_id", sellerId).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load seller reputation");
  if (data) return data as ReputationRow;
  // Chưa có hồ sơ uy tín: tạo từ bảng stores (điểm mặc định 100)
  const { data: store } = await supabaseAdmin.from("stores").select("rating").eq("id", sellerId).maybeSingle();
  const rating = Number((store as { rating?: number | string } | null)?.rating ?? 5);
  await supabaseAdmin.from("seller_reputation").insert({ seller_id: sellerId, rating_avg: rating });
  const { data: created, error: createdError } = await supabaseAdmin.from("seller_reputation").select("seller_id,trust_score,rating_avg,status").eq("seller_id", sellerId).single();
  if (createdError) handleSupabaseError(createdError, "Failed to create seller reputation");
  return created as ReputationRow;
};

export const applyComplaintUpheldPenalty = async (sellerId: string, orderId: string, complaintId: string): Promise<{ before: number; after: number }> => {
  let current = await loadReputation(sellerId);
  let before = Number(current.trust_score);
  let after = Math.max(0, before - COMPLAINT_UPHELD_PENALTY_POINTS);

  // Cập nhật có điều kiện theo điểm đã đọc; nếu có người sửa xen giữa thì đọc lại một lần rồi thử tiếp
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabaseAdmin.from("seller_reputation").update({ trust_score: after }).eq("seller_id", sellerId).eq("trust_score", before).select("seller_id");
    if (error) handleSupabaseError(error, "Failed to update seller reputation");
    if (data && data.length > 0) break;
    current = await loadReputation(sellerId);
    before = Number(current.trust_score);
    after = Math.max(0, before - COMPLAINT_UPHELD_PENALTY_POINTS);
  }

  const { error: violationError } = await supabaseAdmin.from("seller_violations").insert({
    seller_id: sellerId,
    order_id: orderId,
    violation_type: "COMPLAINT_UPHELD",
    reason: "Khiếu nại của người mua được chấp nhận",
    point_delta: after - before,
    trust_score_before: before,
    trust_score_after: after,
    rating_avg_snapshot: Number(current.rating_avg),
    status_after: current.status,
    metadata: { complaint_id: complaintId }
  });
  if (violationError) logger.warn("Không ghi được seller_violations (đã chạy SQL 028 chưa?)", violationError);

  try {
    await sellerReputationService.checkAndApplyPenalties(sellerId);
  } catch (error) {
    logger.warn("Không áp được ngưỡng hạn chế sau khi trừ điểm khiếu nại", { sellerId, error });
  }
  return { before, after };
};
