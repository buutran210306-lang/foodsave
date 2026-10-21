import { randomInt, randomUUID } from "crypto";
import { env } from "../config/env";
import type { AcceptDonationBody, AssignDistributionBody, AssignVolunteerBody, CreateDonationBody, CreateProductDonationBody, DonationListQuery, HandoverBody, ProofUploadBody, StoreResponseBody, SubmitProofBody, UpdateDonationStatusBody } from "../schemas/donationSchemas";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { Donation, UserRole } from "../types/domain";
import type { PaginatedResponse } from "../types/api";
import { AppError } from "../utils/appError";
import { generateCode, getRange, handleSupabaseError, requireRecord, supabaseAdmin, toPagination } from "./supabaseService";
import { ecoImpactService } from "./ecoImpactService";
import { logger } from "../utils/logger";
import { distanceKmBetween, formatDistanceText, isValidCoordinates } from "../utils/geoDistance";
import { CHARITY_OFFER_MINUTES } from "./labelAutomationService";
import { teamService } from "./teamService";

interface OwnedCharityLocation {
  id: string;
  latitude: number | null;
  longitude: number | null;
  service_radius_km: number | null;
}

const getOwnedCharityLocations = async (ownerId: string): Promise<OwnedCharityLocation[]> => {
  const { data, error } = await supabaseAdmin
    .from("charity_profiles")
    .select("id,latitude,longitude,service_radius_km")
    .eq("owner_id", ownerId);
  if (error) handleSupabaseError(error, "Failed to load charity locations");
  return (data ?? []) as OwnedCharityLocation[];
};

const getOwnedStoreIds = async (ownerId: string): Promise<string[]> => {
  const { data, error } = await supabaseAdmin.from("stores").select("id").eq("owner_id", ownerId);
  if (error) handleSupabaseError(error, "Failed to load stores");
  return (data ?? []).map((store) => (store as { id: string }).id);
};

const getOwnedCharityIds = async (ownerId: string): Promise<string[]> => {
  const { data, error } = await supabaseAdmin.from("charity_profiles").select("id").eq("owner_id", ownerId);
  if (error) handleSupabaseError(error, "Failed to load charity profiles");
  return (data ?? []).map((charity) => (charity as { id: string }).id);
};

const assertStoreOwner = async (storeId: string, actorId: string, actorRole: UserRole): Promise<void> => {
  if (actorRole === "admin") return;
  const ownedStoreIds = await getOwnedStoreIds(actorId);
  if (!ownedStoreIds.includes(storeId)) {
    throw new AppError("You do not own this store", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
};

const assertCharityOwner = async (charityId: string, actorId: string, actorRole: UserRole): Promise<void> => {
  if (actorRole === "admin") return;
  const ownedCharityIds = await getOwnedCharityIds(actorId);
  if (!ownedCharityIds.includes(charityId)) {
    throw new AppError("You do not own this charity profile", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
};

interface FlowDonation {
  id: string;
  donation_code: string;
  store_id: string;
  charity_id: string | null;
  assigned_volunteer_id: string | null;
  status: string;
  items: string;
  weight_kg: number;
  expires_at: string;
  offer_expires_at: string | null;
  store_confirmed_at: string | null;
  packed_at: string | null;
  pickup_code: string | null;
  stores: { name: string; owner_id: string };
  charity_profiles: { name: string; owner_id: string } | null;
}

const FLOW_SELECT = "id,donation_code,store_id,charity_id,assigned_volunteer_id,status,items,weight_kg,expires_at,offer_expires_at,store_confirmed_at,packed_at,pickup_code,stores!inner(name,owner_id),charity_profiles(name,owner_id)";

const loadFlowDonation = async (donationId: string): Promise<FlowDonation> => {
  const { data, error } = await supabaseAdmin.from("donations").select(FLOW_SELECT).eq("id", donationId).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load donation");
  return requireRecord(data as unknown as FlowDonation | null, "Không tìm thấy lô quyên góp");
};

interface LoadedVolunteer { id: string; charity_id: string; full_name: string; phone: string; status: string }

const loadCharityVolunteer = async (volunteerId: string, charityId: string): Promise<LoadedVolunteer> => {
  const { data, error } = await supabaseAdmin.from("volunteers").select("id,charity_id,full_name,phone,status").eq("id", volunteerId).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load volunteer");
  const volunteer = requireRecord(data as LoadedVolunteer | null, "Không tìm thấy tình nguyện viên");
  if (volunteer.charity_id !== charityId) {
    throw new AppError("Tình nguyện viên không thuộc tổ chức này", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
  if (volunteer.status !== "active") throw new AppError("Tình nguyện viên này chưa được kích hoạt hoặc đang tạm ngưng", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  return volunteer;
};

const conflict = (message: string): AppError => new AppError(message, HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);

const notifyUser = async (
  recipientId: string | null | undefined,
  role: UserRole,
  notification: { type: string; title: string; body: string; donationId: string }
): Promise<void> => {
  if (!recipientId) return;
  await supabaseAdmin.from("notifications").insert({
    recipient_id: recipientId,
    role_target: role,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    related_type: "donation",
    related_id: notification.donationId
  });
};

// Mã TNV đưa cho cửa hàng: bỏ ký tự dễ nhầm (0/O, 1/I)
const PICKUP_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generatePickupCode = (): string => {
  let code = "";
  for (let index = 0; index < 6; index += 1) code += PICKUP_CODE_CHARS[randomInt(PICKUP_CODE_CHARS.length)];
  return code;
};

const PROOF_BUCKET = "donation-proofs";
const PROOF_IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const proofPublicPrefix = (donationId: string): string => env.SUPABASE_URL.replace(/\/+$/, "") + "/storage/v1/object/public/" + PROOF_BUCKET + "/proofs/" + donationId + "/";

export const donationService = {
  async listDonations(actorId: string, actorRole: UserRole, query: DonationListQuery): Promise<PaginatedResponse<Donation>> {
    const { from, to } = getRange(query);
    await teamService.autoApprovePending();
    let request = supabaseAdmin
      .from("donations")
      .select("*, stores(id,name,owner_id,emoji,address,district,latitude,longitude), charity_profiles(id,name), volunteers!assigned_volunteer_id(id,full_name,phone), distributor:volunteers!distribute_volunteer_id(id,full_name,phone), donation_assignments(volunteer_id,stage,share,done_at,volunteers(id,full_name,phone,vehicle)), donation_photos(id,volunteer_id,stage,photo_url,status,taken_at,gps_flag,review_note,review_deadline_at,is_demo,volunteers(full_name))", { count: "exact" })
      .range(from, to)
      .order("created_at", { ascending: false });

    if (query.status) request = request.eq("status", query.status);
    if (query.urgency) request = request.eq("urgency", query.urgency);
    if (query.store_id) request = request.eq("store_id", query.store_id);
    if (query.charity_id) request = request.eq("charity_id", query.charity_id);

    if (actorRole === "partner") {
      const storeIds = await getOwnedStoreIds(actorId);
      request = request.in("store_id", storeIds.length > 0 ? storeIds : ["00000000-0000-0000-0000-000000000000"]);
    }

    if (actorRole === "charity") {
      const charityIds = await getOwnedCharityIds(actorId);
      request = request.or(`status.eq.open,charity_id.in.(${charityIds.join(",") || "00000000-0000-0000-0000-000000000000"})`);
    }

    const { data, error, count } = await request;
    if (error) handleSupabaseError(error, "Failed to list donations");

    let items = (data ?? []) as Donation[];

    if (actorRole === "charity") {
      const charities = await getOwnedCharityLocations(actorId);
      const ownedIds = new Set(charities.map((charity) => charity.id));
      const now = Date.now();
      const located = charities.filter((charity) => isValidCoordinates({
        latitude: charity.latitude ?? undefined,
        longitude: charity.longitude ?? undefined
      }));

      items = items.filter((donation) => {
        // Lô đã nhận (của mình) thì luôn hiện
        if (donation.charity_id && ownedIds.has(donation.charity_id)) return true;
        if (donation.status !== "open") return false;
        // Quá hạn nhận lời thì không còn hiện trong hộp thư
        if (donation.offer_expires_at && new Date(donation.offer_expires_at).getTime() < now) return false;

        const store = (donation as unknown as { stores?: { latitude?: number | null; longitude?: number | null } }).stores;
        const storePoint = { latitude: store?.latitude ?? undefined, longitude: store?.longitude ?? undefined };
        // Thiếu toạ độ (tổ chức hoặc cửa hàng) thì không lọc được: vẫn cho hiện
        if (located.length === 0 || !isValidCoordinates(storePoint)) return true;

        let nearest = Number.POSITIVE_INFINITY;
        let allowed = false;
        for (const charity of located) {
          const km = distanceKmBetween(
            { latitude: charity.latitude as number, longitude: charity.longitude as number },
            { latitude: storePoint.latitude as number, longitude: storePoint.longitude as number }
          );
          nearest = Math.min(nearest, km);
          if (km <= Number(charity.service_radius_km ?? 5)) allowed = true;
        }
        if (allowed) donation.distance_text = formatDistanceText(nearest);
        return allowed;
      });
    }

    // Mã nhận hàng chỉ dành cho tổ chức và TNV; cửa hàng phải nhập mã do TNV đưa
    if (actorRole === "partner") {
      items = items.map((donation) => {
        const photos = ((donation as unknown as { donation_photos?: Array<{ status: string }> }).donation_photos ?? []).filter((photo) => photo.status === "approved" || photo.status === "auto_approved");
        return { ...donation, pickup_code: null, donation_photos: photos } as Donation;
      });
    }

    return {
      items,
      pagination: toPagination(query.page, query.limit, count ?? 0)
    };
  },

  // Cửa hàng bấm "tim" trên một sản phẩm: giữ phần hàng đó và gửi đề nghị cho tổ chức từ thiện ở gần
  async createFromProduct(actorId: string, actorRole: UserRole, body: CreateProductDonationBody): Promise<Donation> {
    await assertStoreOwner(body.store_id, actorId, actorRole);

    const { data: loaded, error: productError } = await supabaseAdmin
      .from("products")
      .select("id,store_id,name,stock_quantity,estimated_weight_kg,expires_at,effective_deadline_at,label,is_active,is_donation")
      .eq("id", body.product_id)
      .eq("store_id", body.store_id)
      .maybeSingle();
    if (productError) handleSupabaseError(productError, "Failed to load product");

    const product = requireRecord(
      loaded as {
        id: string; name: string; stock_quantity: number; estimated_weight_kg: number | null; expires_at: string;
        effective_deadline_at: string | null; label: "green" | "yellow" | "red"; is_active: boolean; is_donation: boolean;
      } | null,
      "Không tìm thấy sản phẩm của cửa hàng"
    );

    if (!product.is_active) {
      throw new AppError("Sản phẩm đã ngừng bán nên không thể tặng", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }
    if (body.quantity > product.stock_quantity) {
      throw new AppError("Chỉ còn " + product.stock_quantity + " phần, không thể tặng " + body.quantity + " phần", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }

    const now = new Date();
    const deadline = new Date(product.effective_deadline_at ?? product.expires_at);
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= now.getTime()) {
      throw new AppError("Sản phẩm đã hết thời gian nhận hàng", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }
    const offerExpiresAt = new Date(Math.min(now.getTime() + CHARITY_OFFER_MINUTES * 60_000, deadline.getTime()));

    // Giữ phần hàng này khỏi kho bán (chỉ trừ khi tồn kho chưa bị ai thay đổi)
    const { data: reserved, error: reserveError } = await supabaseAdmin
      .from("products")
      .update({ stock_quantity: product.stock_quantity - body.quantity })
      .eq("id", product.id)
      .eq("stock_quantity", product.stock_quantity)
      .select("id")
      .maybeSingle();
    if (reserveError) handleSupabaseError(reserveError, "Failed to reserve product stock");
    if (!reserved) {
      throw new AppError("Tồn kho vừa thay đổi, vui lòng thử lại", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }

    const portionWeight = Number(product.estimated_weight_kg) > 0 ? Number(product.estimated_weight_kg) : 0.3;
    const { data, error } = await supabaseAdmin
      .from("donations")
      .insert({
        donation_code: generateCode("D"),
        store_id: body.store_id,
        product_id: product.id,
        quantity: body.quantity,
        is_auto: false,
        items: product.name,
        amount_text: `${body.quantity} phần`,
        weight_kg: Math.max(0.01, Math.round(portionWeight * body.quantity * 100) / 100),
        expires_at: deadline.toISOString(),
        pickup_start: now.toISOString(),
        pickup_end: deadline.toISOString(),
        urgency: product.label,
        status: "open",
        offer_expires_at: offerExpiresAt.toISOString(),
        note: body.note ?? null
      })
      .select("*")
      .single();

    if (error) {
      // Không tạo được lô thì trả lại số lượng đã giữ
      await supabaseAdmin.from("products").update({ stock_quantity: product.stock_quantity }).eq("id", product.id);
      handleSupabaseError(error, "Failed to create donation from product");
    }
    const donation = data as Donation;

    await supabaseAdmin.from("notifications").insert({
      recipient_id: null,
      role_target: "charity",
      type: "new-donation",
      title: `Có ${body.quantity} phần tặng: ${product.name}`,
      body: `Nhận lời trước ${offerExpiresAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })}. Ai nhận trước được.`,
      related_type: "donation",
      related_id: donation.id
    });

    return donation;
  },

  async createDonation(actorId: string, actorRole: UserRole, body: CreateDonationBody): Promise<Donation> {
    await assertStoreOwner(body.store_id, actorId, actorRole);

    const { data, error } = await supabaseAdmin
      .from("donations")
      .insert({
        ...body,
        donation_code: generateCode("D"),
        status: "open"
      })
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create donation");
    const donation = data as Donation;

    await supabaseAdmin.from("notifications").insert({
      recipient_id: null,
      role_target: "charity",
      type: "new-donation",
      title: "Donation mới từ cửa hàng",
      body: `${body.items} · ${body.amount_text}`,
      related_type: "donation",
      related_id: donation.id
    });

    return donation;
  },

  async acceptDonation(actorId: string, actorRole: UserRole, donationId: string, body: AcceptDonationBody): Promise<Donation> {
    await assertCharityOwner(body.charity_id, actorId, actorRole);

    // Tổ chức phải được Admin duyệt mới được nhận quyên góp
    const { data: charity, error: charityError } = await supabaseAdmin
      .from("charity_profiles")
      .select("id,status")
      .eq("id", body.charity_id)
      .single();
    if (charityError) handleSupabaseError(charityError, "Failed to load charity profile");
    if ((charity as { status: string } | null)?.status !== "active") {
      throw new AppError("Tổ chức chưa được duyệt nên chưa thể nhận quyên góp", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    const { data: loadedDonation, error: loadError } = await supabaseAdmin
      .from("donations")
      .select("id,status,store_id,offer_expires_at,stores!inner(owner_id)")
      .eq("id", donationId)
      .single();

    if (loadError) handleSupabaseError(loadError, "Failed to load donation");
    const existing = requireRecord(
      loadedDonation as { status: string; offer_expires_at: string | null; stores: { owner_id: string } } | null,
      "Donation was not found"
    );
    if (existing.status !== "open") {
      throw new AppError("Lô quyên góp này đã có tổ chức khác nhận", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }
    if (existing.offer_expires_at && new Date(existing.offer_expires_at).getTime() < Date.now()) {
      throw new AppError("Đã quá hạn nhận lời lô quyên góp này", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }

    const { data, error } = await supabaseAdmin
      .from("donations")
      .update({
        status: "accepted",
        charity_id: body.charity_id,
        assigned_volunteer_id: null,
        store_confirmed_at: null,
        accepted_at: new Date().toISOString()
      })
      .eq("id", donationId)
      // Ai bấm nhận trước thì được: chỉ cập nhật khi lô vẫn còn mở
      .eq("status", "open")
      .select("*")
      .maybeSingle();

    if (error) handleSupabaseError(error, "Failed to accept donation");
    if (!data) {
      throw new AppError("Lô quyên góp này đã có tổ chức khác nhận", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }
    const donation = data as Donation;

    await supabaseAdmin.from("notifications").insert({
      recipient_id: existing.stores.owner_id,
      role_target: "partner",
      type: "donation-claimed",
      title: "Có tổ chức muốn nhận lô tặng",
      body: `Lô ${donation.donation_code} đã được một tổ chức từ thiện chọn. Vào mục Tặng thực phẩm để chấp nhận hoặc từ chối.`,
      related_type: "donation",
      related_id: donation.id
    });

    return donation;
  },

  // Link tạm để trình duyệt của tổ chức tự tải ảnh minh chứng lên (chỉ cho lô đã hoàn thành của chính tổ chức)
  async createProofUploadUrl(actorId: string, actorRole: UserRole, donationId: string, body: ProofUploadBody): Promise<{ path: string; token: string; signed_url: string; public_url: string }> {
    const donation = await loadFlowDonation(donationId);
    if (!donation.charity_id) throw conflict("Lô này chưa có tổ chức nhận");
    await assertCharityOwner(donation.charity_id, actorId, actorRole);
    if (donation.status !== "completed") throw conflict("Chỉ gửi ảnh minh chứng sau khi cửa hàng đã xác nhận bàn giao");

    const extension = PROOF_IMAGE_TYPES[body.content_type];
    if (!extension) throw new AppError("Chỉ nhận ảnh JPG, PNG hoặc WEBP", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);

    const path = "proofs/" + donationId + "/" + randomUUID() + "." + extension;
    const bucket = supabaseAdmin.storage.from(PROOF_BUCKET);
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) {
      throw new AppError("Không tạo được link tải ảnh. Hãy chắc chắn đã chạy file SQL 019.", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
    return { path, token: data.token, signed_url: data.signedUrl, public_url: bucket.getPublicUrl(path).data.publicUrl };
  },

  // Tổ chức lưu ảnh minh chứng + ghi chú; cửa hàng được báo
  async submitProof(actorId: string, actorRole: UserRole, donationId: string, body: SubmitProofBody): Promise<Donation> {
    const donation = await loadFlowDonation(donationId);
    if (!donation.charity_id) throw conflict("Lô này chưa có tổ chức nhận");
    await assertCharityOwner(donation.charity_id, actorId, actorRole);
    if (donation.status !== "completed") throw conflict("Chỉ gửi ảnh minh chứng sau khi cửa hàng đã xác nhận bàn giao");

    // Chỉ chấp nhận ảnh nằm trong thư mục minh chứng của chính lô này
    const prefix = proofPublicPrefix(donationId);
    if (!body.photo_urls.every((url) => url.startsWith(prefix))) {
      throw new AppError("Ảnh không hợp lệ cho lô này", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const { data, error } = await supabaseAdmin
      .from("donations")
      .update({ proof_photo_urls: body.photo_urls, proof_note: body.note ?? null, proof_submitted_at: new Date().toISOString() })
      .eq("id", donationId)
      .select("*")
      .single();
    if (error) handleSupabaseError(error, "Failed to save donation proof");

    await notifyUser(donation.stores.owner_id, "partner", {
      type: "donation-proof-submitted",
      title: "Ảnh minh chứng cho lô " + donation.donation_code,
      body: (donation.charity_profiles?.name ?? "Tổ chức") + " đã gửi " + body.photo_urls.length + " ảnh về việc sử dụng hàng bạn tặng.",
      donationId
    });
    return data as Donation;
  },

  // Cửa hàng chấp nhận hoặc từ chối tổ chức đã chọn lô
  async storeRespond(actorId: string, actorRole: UserRole, donationId: string, body: StoreResponseBody): Promise<Donation> {
    const donation = await loadFlowDonation(donationId);
    await assertStoreOwner(donation.store_id, actorId, actorRole);
    if (donation.status !== "accepted" || !donation.charity_id) throw conflict("Lô này chưa có tổ chức nào chọn");
    if (donation.store_confirmed_at) throw conflict("Bạn đã chấp nhận lô này rồi");

    const now = new Date();
    if (body.accept) {
      const { data, error } = await supabaseAdmin
        .from("donations")
        .update({ store_confirmed_at: now.toISOString() })
        .eq("id", donationId)
        .eq("status", "accepted")
        .select("*")
        .single();
      if (error) handleSupabaseError(error, "Failed to confirm donation");
      await notifyUser(donation.charity_profiles?.owner_id, "charity", {
        type: "donation-store-confirmed",
        title: "Cửa hàng đã chấp nhận lô " + donation.donation_code,
        body: donation.stores.name + " đồng ý. Hãy phân tình nguyện viên đến lấy hàng.",
        donationId
      });
      return data as Donation;
    }

    // Từ chối: lô quay lại hộp thư để tổ chức khác chọn
    const reopenAt = new Date(Math.min(now.getTime() + CHARITY_OFFER_MINUTES * 60_000, new Date(donation.expires_at).getTime()));
    const { data, error } = await supabaseAdmin
      .from("donations")
      .update({
        status: "open",
        charity_id: null,
        accepted_at: null,
        assigned_volunteer_id: null,
        store_confirmed_at: null,
        volunteer_assigned_at: null,
        pickup_code: null,
        packed_at: null,
        offer_expires_at: reopenAt.toISOString()
      })
      .eq("id", donationId)
      .eq("status", "accepted")
      .select("*")
      .single();
    if (error) handleSupabaseError(error, "Failed to decline donation claim");
    await notifyUser(donation.charity_profiles?.owner_id, "charity", {
      type: "donation-store-declined",
      title: "Cửa hàng chưa thể chuẩn bị lô " + donation.donation_code,
      body: donation.stores.name + " đã từ chối. Lô được mở lại cho tổ chức khác.",
      donationId
    });
    return data as Donation;
  },

  // Tổ chức phân tình nguyện viên: sinh mã nhận hàng
  async assignVolunteer(actorId: string, actorRole: UserRole, donationId: string, body: AssignVolunteerBody): Promise<Donation> {
    return (await teamService.assignSingle(actorId, actorRole, donationId, body.volunteer_id, body.distribute_volunteer_id, body.portions)) as Donation;
  },

  // Tổ chức giao giai đoạn phát hàng: chọn người phát và nhập số suất (số suất dùng lại cho báo cáo ESG)
  async assignDistribution(actorId: string, actorRole: UserRole, donationId: string, body: AssignDistributionBody): Promise<Donation> {
    return (await teamService.assignTeam(actorId, actorRole, donationId, { distribute: [{ volunteer_id: body.volunteer_id, share: body.portions }] })) as Donation;
  },

  // Cửa hàng báo đã đóng gói xong, chờ TNV
  async markPacked(actorId: string, actorRole: UserRole, donationId: string): Promise<Donation> {
    const donation = await loadFlowDonation(donationId);
    await assertStoreOwner(donation.store_id, actorId, actorRole);
    if (!donation.assigned_volunteer_id) throw conflict("Tổ chức chưa phân tình nguyện viên");
    if (donation.status !== "accepted" && donation.status !== "in_route") throw conflict("Lô này không ở bước đóng gói");
    if (donation.packed_at) throw conflict("Lô này đã được báo đóng gói");

    const { data, error } = await supabaseAdmin
      .from("donations")
      .update({ packed_at: new Date().toISOString() })
      .eq("id", donationId)
      .select("*")
      .single();
    if (error) handleSupabaseError(error, "Failed to mark donation packed");

    await notifyUser(donation.charity_profiles?.owner_id, "charity", {
      type: "donation-packed",
      title: "Hàng của lô " + donation.donation_code + " đã sẵn sàng",
      body: donation.stores.name + " đã đóng gói. Tình nguyện viên có thể đến lấy.",
      donationId
    });
    return data as Donation;
  },

  // Cửa hàng nhập mã TNV đưa để xác nhận bàn giao
  async confirmHandover(actorId: string, actorRole: UserRole, donationId: string, body: HandoverBody): Promise<Donation> {
    const donation = await loadFlowDonation(donationId);
    await assertStoreOwner(donation.store_id, actorId, actorRole);
    if (!donation.assigned_volunteer_id || !donation.pickup_code) throw conflict("Lô này chưa có tình nguyện viên");
    if (!donation.packed_at) throw conflict("Hãy bấm \"Đã đóng gói\" trước khi bàn giao");
    if (donation.status !== "accepted" && donation.status !== "in_route") throw conflict("Lô này không ở bước bàn giao");

    if (body.code.trim().toUpperCase() !== donation.pickup_code.toUpperCase()) {
      throw new AppError("Mã nhận hàng không đúng. Hãy kiểm tra lại với tình nguyện viên.", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const { data, error } = await supabaseAdmin
      .from("donations")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", donationId)
      .in("status", ["accepted", "in_route"])
      .select("*")
      .maybeSingle();
    if (error) handleSupabaseError(error, "Failed to complete donation");
    if (!data) throw conflict("Lô này đã được cập nhật bởi người khác");

    // Ghi nhận chuyến cho cả đội lấy hàng (kg chia theo phần của mỗi người)
    const { data: pickupTeam } = await supabaseAdmin.from("donation_assignments").select("volunteer_id,share").eq("donation_id", donationId).eq("stage", "pickup");
    const team = (pickupTeam ?? []) as Array<{ volunteer_id: string; share: number }>;
    const members = team.length > 0 ? team : [{ volunteer_id: donation.assigned_volunteer_id, share: 1 }];
    const totalShare = members.reduce((sum, member) => sum + member.share, 0) || 1;
    for (const member of members) {
      const { data: volunteer } = await supabaseAdmin.from("volunteers").select("runs,kg_collected").eq("id", member.volunteer_id).maybeSingle();
      const stats = volunteer as { runs: number; kg_collected: number } | null;
      if (stats) {
        await supabaseAdmin
          .from("volunteers")
          .update({ runs: stats.runs + 1, kg_collected: Number(stats.kg_collected) + Number(donation.weight_kg) * (member.share / totalShare) })
          .eq("id", member.volunteer_id);
      }
    }

    try {
      await ecoImpactService.recordDonationImpact(donationId);
    } catch (impactError) {
      logger.warn("Failed to record eco impact for completed donation", { donationId, error: impactError });
    }

    await notifyUser(donation.charity_profiles?.owner_id, "charity", {
      type: "donation-completed",
      title: "Đã nhận hàng lô " + donation.donation_code,
      body: "Cửa hàng xác nhận bàn giao thành công cho tình nguyện viên.",
      donationId
    });
    return data as Donation;
  },

  async updateDonationStatus(actorId: string, actorRole: UserRole, donationId: string, body: UpdateDonationStatusBody): Promise<Donation> {
    const { data: loadedDonation, error: loadError } = await supabaseAdmin
      .from("donations")
      .select("id,store_id,charity_id,status,product_id,quantity,stores!inner(owner_id)")
      .eq("id", donationId)
      .single();

    if (loadError) handleSupabaseError(loadError, "Failed to load donation");
    const donation = requireRecord(loadedDonation as { store_id: string; charity_id: string | null; status: string; product_id: string | null; quantity: number | null; stores: { owner_id: string } } | null, "Donation was not found");

    if (actorRole === "partner") await assertStoreOwner(donation.store_id, actorId, actorRole);
    if (actorRole === "charity") {
      if (!donation.charity_id) {
        throw new AppError("This donation has not been accepted by a charity", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
      }
      await assertCharityOwner(donation.charity_id, actorId, actorRole);
    }

    if (actorRole === "charity" && (body.status === "completed" || body.status === "in_route")) {
      throw new AppError("Việc bàn giao do cửa hàng xác nhận bằng mã nhận hàng của tình nguyện viên", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    const shouldRecordImpact = donation.status !== "completed" && body.status === "completed";

    const { data, error } = await supabaseAdmin
      .from("donations")
      .update({
        status: body.status,
        assigned_volunteer_id: body.assigned_volunteer_id,
        note: body.note,
        completed_at: body.status === "completed" ? new Date().toISOString() : null
      })
      .eq("id", donationId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update donation");

    // Cửa hàng huỷ lô chưa ai nhận: trả phần đã giữ về kho bán
    if (donation.status === "open" && body.status === "cancelled" && donation.product_id && donation.quantity) {
      const { data: stock } = await supabaseAdmin
        .from("products")
        .select("id,stock_quantity")
        .eq("id", donation.product_id)
        .maybeSingle();
      const loadedStock = stock as { id: string; stock_quantity: number } | null;
      if (loadedStock) {
        await supabaseAdmin
          .from("products")
          .update({ stock_quantity: loadedStock.stock_quantity + donation.quantity })
          .eq("id", loadedStock.id);
      }
    }

    if (shouldRecordImpact) {
      try {
        await ecoImpactService.recordDonationImpact(donationId);
      } catch (impactError) {
        logger.warn("Failed to record eco impact for completed donation", { donationId, error: impactError });
      }
    }
    return data as Donation;
  }
};
