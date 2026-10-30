/**
 * Ghép đơn: tổ chức từ thiện đăng nhu cầu (ví dụ 50 phần bánh trước 18:00), hệ thống ghép các lô tặng
 * (`donations`) của nhiều cửa hàng gần đó cho đủ số lượng. Tính theo SỐ PHẦN (`donations.quantity`).
 *
 * Cần chạy trước: database/Charity/027_charity_needs_matching.sql
 */
import { proposePlans, type MatchPlan, type MatchResult } from "../core/matching";
import type { Perishability } from "../core/labels";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { buildCandidate, buildNeed, type CharityNeedForMatch, type DonationRowForMatch } from "./candidateBuilder";
import { categoryCodeOf } from "./matchingCategories";
import { createNotification } from "./notificationService";
import { handleSupabaseError, requireRecord, supabaseAdmin } from "./supabaseService";

const DEFAULT_RADIUS_KM = 5;

export interface CreateNeedInput {
  charity_id?: string | undefined;
  title: string;
  category_codes: string[];
  quantity: number;
  needed_by: string;
  note?: string | undefined;
}

export interface NeedRecord {
  id: string;
  charity_id: string;
  title: string;
  category_codes: string[];
  quantity: number;
  needed_by: string;
  status: string;
  note: string | null;
  matched_donation_ids: string[];
  created_at: string;
}

interface NeedRow extends NeedRecord {
  charity_profiles: {
    owner_id: string;
    latitude: number | null;
    longitude: number | null;
    service_radius_km: number | string | null;
  } | null;
}

interface StoreEmbed {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | string | null;
  status: string;
}

interface DonationEmbed {
  id: string;
  store_id: string;
  weight_kg: number | string;
  quantity: number | null;
  expires_at: string;
  pickup_start: string;
  pickup_end: string;
  products: { category: string | null; food_group: string | null } | null;
  stores: StoreEmbed | null;
}

export interface PlanView {
  rank: number;
  coveredQty: number;
  requestedQty: number;
  shortfallQty: number;
  stopCount: number;
  estDistanceKm: number;
  estMinutes: number;
  redLots: number;
  donationIds: string[];
  lines: Array<{ donationId: string; storeId: string; storeName: string; qty: number; label: string }>;
  stops: Array<{
    seq: number;
    storeId: string;
    storeName: string;
    address: string;
    location: { lat: number; lng: number } | null;
    arriveAt: string;
    qty: number;
  }>;
}

const notFound = (message: string): AppError => new AppError(message, HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
const badRequest = (message: string): AppError => new AppError(message, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
const conflict = (message: string): AppError => new AppError(message, HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);

const NEED_SELECT =
  "id, charity_id, title, category_codes, quantity, needed_by, status, note, matched_donation_ids, created_at";

const loadNeed = async (needId: string, actorId: string, actorRole: UserRole): Promise<NeedRow> => {
  const { data, error } = await supabaseAdmin
    .from("charity_needs")
    .select(`${NEED_SELECT}, charity_profiles(owner_id, latitude, longitude, service_radius_km)`)
    .eq("id", needId)
    .maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load need");
  const need = requireRecord(data as unknown as NeedRow | null, "Không tìm thấy nhu cầu");
  if (actorRole !== "admin" && need.charity_profiles?.owner_id !== actorId) {
    throw new AppError("Bạn không phải chủ của nhu cầu này", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
  return need;
};

const toNeedInput = (need: NeedRow): CharityNeedForMatch => {
  const charity = need.charity_profiles;
  if (charity?.latitude == null || charity.longitude == null) {
    throw badRequest("Tổ chức chưa có vị trí trên bản đồ nên chưa thể ghép đơn");
  }
  return {
    quantity: Number(need.quantity),
    unit: "portion",
    categoryCodes: need.category_codes,
    neededBy: need.needed_by,
    charityLat: charity.latitude,
    charityLng: charity.longitude,
    radiusKm: Number(charity.service_radius_km ?? DEFAULT_RADIUS_KM),
  };
};

const asPerishability = (value: string | null | undefined): Perishability =>
  value === "fresh" || value === "packaged" ? value : "cooked";

interface ProposeOutput {
  result: MatchResult;
  storeById: Map<string, StoreEmbed>;
  donationQty: Map<string, number>;
}

const propose = async (need: NeedRow): Promise<ProposeOutput> => {
  const needInput = toNeedInput(need);
  const at = new Date();
  const nowIso = at.toISOString();

  // Lô còn mở, chưa ai nhận, còn hạn nhận lời. Loại hàng/bán kính/giờ do engine lọc và giải thích lý do.
  const { data, error } = await supabaseAdmin
    .from("donations")
    .select(
      "id, store_id, weight_kg, quantity, expires_at, pickup_start, pickup_end, products(category, food_group), stores!inner(id, name, address, latitude, longitude, rating, status)",
    )
    .eq("status", "open")
    .is("charity_id", null)
    .not("quantity", "is", null)
    .gt("expires_at", nowIso)
    .or(`offer_expires_at.is.null,offer_expires_at.gt.${nowIso}`)
    .eq("stores.status", "active")
    .limit(300);
  if (error) handleSupabaseError(error, "Failed to load donations");

  const rows = (data ?? []) as unknown as DonationEmbed[];
  const storeById = new Map<string, StoreEmbed>();
  const donationQty = new Map<string, number>();
  const candidates = rows.flatMap((row) => {
    if (!row.stores || row.quantity == null || row.quantity <= 0) return [];
    storeById.set(row.stores.id, row.stores);
    donationQty.set(row.id, row.quantity);
    const donation: DonationRowForMatch = {
      id: row.id,
      store_id: row.store_id,
      weight_kg: row.weight_kg,
      expires_at: row.expires_at,
      pickup_start: row.pickup_start,
      pickup_end: row.pickup_end,
      category_code: categoryCodeOf(row.products?.category),
      perishability: asPerishability(row.products?.food_group),
      qty: row.quantity,
      unit: "portion",
    };
    const candidate = buildCandidate(donation, row.stores, needInput, at);
    return candidate ? [candidate] : [];
  });

  return { result: proposePlans(buildNeed(needInput, at), candidates), storeById, donationQty };
};

const toPlanView = (plan: MatchPlan, storeById: Map<string, StoreEmbed>): PlanView => {
  const storeName = (siteId: string): string => storeById.get(siteId)?.name ?? "Cửa hàng";
  return {
    rank: plan.rank,
    coveredQty: plan.coveredQty,
    requestedQty: plan.requestedQty,
    shortfallQty: plan.shortfall,
    stopCount: plan.stopCount,
    estDistanceKm: Math.round(plan.estDistanceM / 100) / 10,
    estMinutes: Math.round(plan.estDurationS / 60),
    redLots: plan.redLots,
    donationIds: plan.lines.map((line) => line.offerId),
    lines: plan.lines.map((line) => ({
      donationId: line.offerId,
      storeId: line.siteId,
      storeName: storeName(line.siteId),
      qty: line.qty,
      label: line.label,
    })),
    stops: plan.stops.map((stop) => ({
      seq: stop.seq,
      storeId: stop.siteId,
      storeName: storeName(stop.siteId),
      address: storeById.get(stop.siteId)?.address ?? "",
      location: stop.location,
      arriveAt: stop.arriveAt,
      qty: plan.lines.filter((line) => line.siteId === stop.siteId).reduce((sum, line) => sum + line.qty, 0),
    })),
  };
};

const sameSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return setA.size === a.length && b.every((id) => setA.has(id));
};

export const matchingService = {
  /** Tạo nhu cầu. Tổ chức tự lấy theo tài khoản đăng nhập; admin phải truyền charity_id. */
  async createNeed(actorId: string, actorRole: UserRole, input: CreateNeedInput): Promise<NeedRecord> {
    let query = supabaseAdmin.from("charity_profiles").select("id, status, latitude, longitude, owner_id");
    if (input.charity_id) query = query.eq("id", input.charity_id);
    else if (actorRole === "admin") throw badRequest("Admin cần chọn tổ chức (charity_id)");
    else query = query.eq("owner_id", actorId);
    const { data: charities, error: charityError } = await query.limit(1);
    if (charityError) handleSupabaseError(charityError, "Failed to load charity");
    const charity = (charities as Array<{ id: string; status: string; latitude: number | null; longitude: number | null; owner_id: string }> | null)?.[0];
    if (!charity) throw notFound("Không tìm thấy hồ sơ tổ chức");
    if (actorRole !== "admin" && charity.owner_id !== actorId) {
      throw new AppError("Bạn không phải chủ của tổ chức này", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }
    if (charity.status !== "active") throw conflict("Tổ chức chưa được duyệt nên chưa thể đăng nhu cầu");
    if (charity.latitude == null || charity.longitude == null) {
      throw badRequest("Tổ chức chưa có vị trí trên bản đồ, hãy cập nhật vị trí trước");
    }
    if (new Date(input.needed_by).getTime() <= Date.now()) throw badRequest("Thời hạn cần hàng phải ở tương lai");

    const { data, error } = await supabaseAdmin
      .from("charity_needs")
      .insert({
        charity_id: charity.id,
        title: input.title,
        category_codes: input.category_codes,
        quantity: input.quantity,
        needed_by: input.needed_by,
        note: input.note ?? null,
      })
      .select(NEED_SELECT)
      .single();
    if (error) handleSupabaseError(error, "Failed to create need");
    return data as unknown as NeedRecord;
  },

  async listNeeds(actorId: string, actorRole: UserRole): Promise<NeedRecord[]> {
    let query = supabaseAdmin
      .from("charity_needs")
      .select(`${NEED_SELECT}, charity_profiles!inner(owner_id)`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (actorRole !== "admin") query = query.eq("charity_profiles.owner_id", actorId);
    const { data, error } = await query;
    if (error) handleSupabaseError(error, "Failed to list needs");
    // Bỏ trường nối charity_profiles (chỉ dùng để lọc theo chủ sở hữu), trả đúng NeedRecord
    return ((data ?? []) as unknown as NeedRow[]).map(({ charity_profiles: _owner, ...record }) => record);
  },

  async cancelNeed(needId: string, actorId: string, actorRole: UserRole): Promise<void> {
    const need = await loadNeed(needId, actorId, actorRole);
    if (need.status !== "open") throw conflict("Chỉ hủy được nhu cầu đang mở");
    const { error } = await supabaseAdmin
      .from("charity_needs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", needId)
      .eq("status", "open");
    if (error) handleSupabaseError(error, "Failed to cancel need");
  },

  /** Đề xuất tối đa 3 phương án. Chỉ đọc, không giữ hàng. */
  async proposeForNeed(
    needId: string,
    actorId: string,
    actorRole: UserRole,
  ): Promise<{ plans: PlanView[]; dropped: MatchResult["candidates"]["dropped"]; need: NeedRecord }> {
    const need = await loadNeed(needId, actorId, actorRole);
    if (need.status !== "open") throw conflict("Nhu cầu này không còn mở");
    const { result, storeById } = await propose(need);
    const { charity_profiles: _charity, ...needRecord } = need;
    return { plans: result.plans.map((plan) => toPlanView(plan, storeById)), dropped: result.candidates.dropped, need: needRecord };
  },

  /**
   * Giữ hàng theo phương án đã chọn. Server tính lại phương án rồi so với các lô được gửi lên
   * (không tin số lượng từ trình duyệt). Hàm SQL khóa và nhận tất cả lô trong MỘT giao dịch.
   */
  async reservePlan(needId: string, donationIds: string[], actorId: string, actorRole: UserRole): Promise<{ reserved: number; portions: number }> {
    const need = await loadNeed(needId, actorId, actorRole);
    if (need.status !== "open") throw conflict("Nhu cầu này không còn mở");

    const { result } = await propose(need);
    const plan = result.plans.find((p) => sameSet(p.lines.map((line) => line.offerId), donationIds));
    if (!plan) throw conflict("Phương án đã thay đổi. Hãy tính lại phương án.");

    const lines = plan.lines.map((line) => ({ id: line.offerId, qty: line.qty }));
    const { error } = await supabaseAdmin.rpc("reserve_donations_for_need", { p_need_id: needId, p_lines: lines });
    if (error) {
      if (error.message.includes("not_available") || error.message.includes("need_not_open")) {
        throw conflict("Một lô vừa được nơi khác nhận. Hãy tính lại phương án.");
      }
      handleSupabaseError(error, "Failed to reserve plan");
    }

    // Báo cho từng cửa hàng, giống khi tổ chức nhận một lô riêng lẻ
    const { data: reserved } = await supabaseAdmin
      .from("donations")
      .select("id, donation_code, quantity, stores!inner(owner_id)")
      .in("id", donationIds);
    const rows = (reserved ?? []) as unknown as Array<{ id: string; donation_code: string; quantity: number | null; stores: { owner_id: string } }>;
    if (rows.length > 0) {
      for (const row of rows) {
        await createNotification({
          recipientId: row.stores.owner_id,
          roleTarget: "partner",
          type: "donation-claimed",
          title: "Có tổ chức muốn nhận lô tặng",
          body: `Lô ${row.donation_code} (${row.quantity ?? ""} phần) đã được một tổ chức từ thiện chọn trong đơn ghép "${need.title}". Vào mục Tặng thực phẩm để chấp nhận hoặc từ chối.`,
          relatedType: "donation",
          relatedId: row.id,
        });
      }
    }
    return { reserved: lines.length, portions: lines.reduce((sum, line) => sum + line.qty, 0) };
  },
};
