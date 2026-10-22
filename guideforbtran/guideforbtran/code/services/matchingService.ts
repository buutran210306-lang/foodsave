/**
 * Service ghép đơn cho dự án FoodSave bản cũ (Express + Supabase).
 * Đặt file này vào src/services/ và thư mục core/ vào src/core/.
 *
 * Cần chạy trước: sql/015_charity_needs_matching.sql (bảng charity_needs, cột category_code/perishability
 * cho donations, hàm reserve_donations_for_need).
 */
import { proposePlans, type MatchResult } from "../core/matching";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import {
  buildCandidate,
  buildNeed,
  type CharityNeedForMatch,
  type DonationRowForMatch,
  type StoreRowForMatch,
} from "./candidateBuilder";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

interface NeedRow {
  id: string;
  charity_id: string;
  quantity_kg: number | string;
  category_codes: string[];
  needed_by: string;
  status: string;
  charity_profiles: {
    owner_id: string;
    latitude: number | null;
    longitude: number | null;
    service_radius_km: number | string | null;
  } | null;
}

type DonationWithStore = DonationRowForMatch & {
  stores: (StoreRowForMatch & { name: string; address: string | null }) | null;
};

const DEFAULT_RADIUS_KM = 5;

const loadNeed = async (needId: string, actorId: string, actorRole: UserRole): Promise<NeedRow> => {
  const { data, error } = await supabaseAdmin
    .from("charity_needs")
    .select(
      "id, charity_id, quantity_kg, category_codes, needed_by, status, charity_profiles(owner_id, latitude, longitude, service_radius_km)",
    )
    .eq("id", needId)
    .maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load need");
  const need = data as unknown as NeedRow | null;
  if (!need) throw new AppError("Need not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  if (actorRole !== "admin" && need.charity_profiles?.owner_id !== actorId) {
    throw new AppError("You do not own this need", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
  return need;
};

export const matchingService = {
  /** Đề xuất tối đa 3 phương án ghép cho một nhu cầu. Chỉ đọc, không giữ hàng. */
  async proposeForNeed(
    needId: string,
    actorId: string,
    actorRole: UserRole,
  ): Promise<{ result: MatchResult; storeNames: Record<string, string> }> {
    const need = await loadNeed(needId, actorId, actorRole);
    const charity = need.charity_profiles;
    if (charity?.latitude == null || charity.longitude == null) {
      throw new AppError(
        "Charity location is missing",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    const at = new Date();
    const needInput: CharityNeedForMatch = {
      quantity: Number(need.quantity_kg),
      unit: "kg",
      categoryCodes: need.category_codes,
      neededBy: need.needed_by,
      charityLat: charity.latitude,
      charityLng: charity.longitude,
      radiusKm: Number(charity.service_radius_km ?? DEFAULT_RADIUS_KM),
    };

    // Lô còn mở, chưa hết hạn, cùng danh mục. Engine tự loại phần còn lại (bán kính, giờ, hạn).
    const { data, error } = await supabaseAdmin
      .from("donations")
      .select(
        "id, store_id, weight_kg, expires_at, pickup_start, pickup_end, category_code, perishability, stores!inner(id, name, address, latitude, longitude, rating)",
      )
      .eq("status", "open")
      .is("charity_id", null)
      .gt("expires_at", at.toISOString())
      .in("category_code", need.category_codes)
      .limit(200);
    if (error) handleSupabaseError(error, "Failed to load donations");

    const rows = (data ?? []) as unknown as DonationWithStore[];
    const storeNames: Record<string, string> = {};
    const candidates = rows.flatMap((row) => {
      if (!row.stores) return [];
      storeNames[row.stores.id] = row.stores.name;
      const c = buildCandidate(row, row.stores, needInput, at);
      return c ? [c] : [];
    });

    return { result: proposePlans(buildNeed(needInput, at), candidates), storeNames };
  },

  /**
   * Giữ hàng cho một phương án: gọi hàm SQL để khóa và nhận các lô trong MỘT giao dịch
   * (hoặc nhận đủ, hoặc không nhận lô nào). Bản cũ nhận nguyên lô, không chia nhỏ.
   */
  async reservePlan(needId: string, donationIds: string[], actorId: string, actorRole: UserRole): Promise<void> {
    await loadNeed(needId, actorId, actorRole);
    if (donationIds.length === 0) {
      throw new AppError("Plan has no donations", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }
    const { error } = await supabaseAdmin.rpc("reserve_donations_for_need", {
      p_need_id: needId,
      p_donation_ids: donationIds,
    });
    if (error) {
      if (error.message.includes("not_available")) {
        throw new AppError(
          "Một lô vừa được nơi khác nhận. Hãy tính lại phương án.",
          HTTP_STATUS.CONFLICT,
          ERROR_CODES.RESOURCE_CONFLICT,
        );
      }
      handleSupabaseError(error, "Failed to reserve plan");
    }
  },
};
