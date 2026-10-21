import { randomInt, randomUUID } from "crypto";
import { env } from "../config/env";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { AssignTeamBody, PhotoReviewBody } from "../schemas/donationSchemas";
import type { UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { distanceKmBetween, isValidCoordinates } from "../utils/geoDistance";
import { handleSupabaseError, requireRecord, supabaseAdmin } from "./supabaseService";

// Đội TNV nhiều người cho mỗi lô + ảnh minh chứng do TNV chụp (tổ chức duyệt, quá hạn tự gửi sang cửa hàng)

export type Stage = "pickup" | "distribute";
// Số ảnh tối thiểu mỗi người phải gửi cho phần việc của mình
export const PHOTO_MIN: Record<Stage, number> = { pickup: 1, distribute: 2 };

const PHOTO_BUCKET = "donation-proofs";
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const PICKUP_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const conflict = (message: string): AppError => new AppError(message, HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
const invalid = (message: string): AppError => new AppError(message, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
const forbidden = (message: string): AppError => new AppError(message, HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);

const generatePickupCode = (): string => {
  let code = "";
  for (let index = 0; index < 6; index += 1) code += PICKUP_CODE_CHARS[randomInt(PICKUP_CODE_CHARS.length)];
  return code;
};

const idsOf = async (table: "stores" | "charity_profiles", ownerId: string): Promise<string[]> => {
  const { data, error } = await supabaseAdmin.from(table).select("id").eq("owner_id", ownerId);
  if (error) handleSupabaseError(error, "Failed to load owned profiles");
  return (data ?? []).map((row) => (row as { id: string }).id);
};

interface DonationBrief {
  id: string;
  donation_code: string;
  store_id: string;
  charity_id: string | null;
  status: string;
  quantity: number | null;
  weight_kg: number;
  store_confirmed_at: string | null;
  pickup_code: string | null;
  assigned_volunteer_id: string | null;
  stores: { name: string; owner_id: string; latitude: number | null; longitude: number | null };
  charity_profiles: { name: string; owner_id: string; latitude: number | null; longitude: number | null } | null;
}

const BRIEF_SELECT = "id,donation_code,store_id,charity_id,status,quantity,weight_kg,store_confirmed_at,pickup_code,assigned_volunteer_id,stores!inner(name,owner_id,latitude,longitude),charity_profiles(name,owner_id,latitude,longitude)";

const loadDonation = async (donationId: string): Promise<DonationBrief> => {
  const { data, error } = await supabaseAdmin.from("donations").select(BRIEF_SELECT).eq("id", donationId).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load donation");
  return requireRecord(data as unknown as DonationBrief | null, "Không tìm thấy lô quyên góp");
};

const notify = async (recipientId: string | null | undefined, role: UserRole, type: string, title: string, body: string, donationId: string): Promise<void> => {
  if (!recipientId) return;
  await supabaseAdmin.from("notifications").insert({ recipient_id: recipientId, role_target: role, type, title, body, related_type: "donation", related_id: donationId });
};

// ── Thời hạn duyệt ảnh: ảnh nộp sau 20:00 (hoặc trước 8:00) tính hạn từ 8:00 sáng, giờ Việt Nam
export const computeReviewDeadline = (submittedAt: Date): Date => {
  const vnOffsetMs = 7 * 3600_000;
  const vn = new Date(submittedAt.getTime() + vnOffsetMs);
  const hour = vn.getUTCHours();
  let baseUtcMs = submittedAt.getTime();
  if (hour >= 20 || hour < 8) {
    const day = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + (hour >= 20 ? 1 : 0), 8, 0, 0);
    baseUtcMs = day - vnOffsetMs;
  }
  return new Date(baseUtcMs + env.PHOTO_REVIEW_MINUTES * 60_000);
};

interface VolunteerLite { id: string; charity_id: string; full_name: string; phone: string; status: string }

const loadVolunteers = async (ids: string[]): Promise<Map<string, VolunteerLite>> => {
  const { data, error } = await supabaseAdmin.from("volunteers").select("id,charity_id,full_name,phone,status").in("id", ids);
  if (error) handleSupabaseError(error, "Failed to load volunteers");
  return new Map(((data ?? []) as VolunteerLite[]).map((row) => [row.id, row]));
};

type Access = "admin" | "charity" | "store";

const resolveAccess = async (actorId: string, actorRole: UserRole, donation: { store_id: string; charity_id: string | null }): Promise<Access> => {
  if (actorRole === "admin") return "admin";
  if (actorRole === "charity" && donation.charity_id) {
    if ((await idsOf("charity_profiles", actorId)).includes(donation.charity_id)) return "charity";
  }
  if (actorRole === "partner") {
    if ((await idsOf("stores", actorId)).includes(donation.store_id)) return "store";
  }
  throw forbidden("Bạn không có quyền xem lô này");
};

const VISIBLE_TO_STORE = ["approved", "auto_approved"];

export const teamService = {
  // Ảnh pending quá hạn (và không bị gắn cờ GPS) tự chuyển sang cửa hàng
  async autoApprovePending(donationId?: string): Promise<void> {
    let request = supabaseAdmin
      .from("donation_photos")
      .update({ status: "auto_approved", reviewed_at: new Date().toISOString() })
      .eq("status", "pending")
      .eq("gps_flag", false)
      .lte("review_deadline_at", new Date().toISOString());
    if (donationId) request = request.eq("donation_id", donationId);
    const { data, error } = await request.select("donation_id");
    if (error) {
      // Chưa chạy SQL 023: bỏ qua để không làm hỏng các màn hình khác
      if (error.code === "42P01" || error.code === "PGRST205") return;
      handleSupabaseError(error, "Failed to auto approve photos");
    }
    const donationIds = Array.from(new Set((data ?? []).map((row) => (row as { donation_id: string }).donation_id)));
    for (const id of donationIds) {
      const donation = await loadDonation(id).catch(() => null);
      if (donation) {
        await notify(donation.stores.owner_id, "partner", "donation-photos-approved", "Có ảnh minh chứng mới cho lô " + donation.donation_code,
          "Tổ chức chưa duyệt kịp nên hệ thống tự gửi ảnh cho bạn xem.", id);
      }
    }
  },

  // ── Tổ chức: giao đội TNV (nhiều người) cho lấy hàng và/hoặc phát hàng
  async assignTeam(actorId: string, actorRole: UserRole, donationId: string, body: AssignTeamBody): Promise<unknown> {
    const donation = await loadDonation(donationId);
    if (!donation.charity_id) throw conflict("Lô này chưa có tổ chức nhận");
    if (actorRole !== "admin" && !(await idsOf("charity_profiles", actorId)).includes(donation.charity_id)) {
      throw forbidden("Bạn không phải chủ tổ chức của lô này");
    }
    if (!donation.store_confirmed_at) throw conflict("Cửa hàng chưa chấp nhận lô này");
    if (["open", "rejected", "cancelled"].includes(donation.status)) throw conflict("Lô này không còn ở bước phân công");
    if (body.pickup && !["accepted", "in_route"].includes(donation.status)) throw conflict("Lô này đã lấy hàng xong nên không đổi đội lấy hàng được");

    const members = [...(body.pickup ?? []), ...(body.distribute ?? [])];
    const volunteers = await loadVolunteers(Array.from(new Set(members.map((member) => member.volunteer_id))));
    for (const member of members) {
      const volunteer = volunteers.get(member.volunteer_id);
      if (!volunteer) throw invalid("Không tìm thấy một tình nguyện viên đã chọn");
      if (volunteer.charity_id !== donation.charity_id) throw forbidden("Tình nguyện viên " + volunteer.full_name + " không thuộc tổ chức này");
      if (volunteer.status !== "active") throw conflict("Tình nguyện viên " + volunteer.full_name + " chưa được kích hoạt hoặc đang tạm ngưng");
    }

    const now = new Date().toISOString();
    const stages: Array<[Stage, AssignTeamBody["pickup"]]> = [["pickup", body.pickup], ["distribute", body.distribute]];
    for (const [stage, list] of stages) {
      if (!list) continue;
      const keep = list.map((member) => member.volunteer_id);
      const { error: deleteError } = await supabaseAdmin
        .from("donation_assignments")
        .delete()
        .eq("donation_id", donationId)
        .eq("stage", stage)
        .is("done_at", null)
        .not("volunteer_id", "in", "(" + keep.join(",") + ")");
      if (deleteError) handleSupabaseError(deleteError, "Failed to update team");
      const { error: upsertError } = await supabaseAdmin
        .from("donation_assignments")
        .upsert(list.map((member) => ({ donation_id: donationId, volunteer_id: member.volunteer_id, stage, share: member.share, assigned_at: now })), { onConflict: "donation_id,volunteer_id,stage" });
      if (upsertError) handleSupabaseError(upsertError, "Failed to save team");
    }

    const update: Record<string, unknown> = {};
    if (body.pickup) {
      update.assigned_volunteer_id = body.pickup[0]?.volunteer_id ?? null;
      update.volunteer_assigned_at = now;
      update.pickup_code = donation.pickup_code ?? generatePickupCode();
    }
    if (body.distribute) {
      update.distribute_volunteer_id = body.distribute[0]?.volunteer_id ?? null;
      update.distribute_assigned_at = now;
      update.portions = body.distribute.reduce((sum, member) => sum + member.share, 0);
    }
    const { data, error } = await supabaseAdmin.from("donations").update(update).eq("id", donationId).select("*").single();
    if (error) handleSupabaseError(error, "Failed to assign team");

    if (body.pickup && !donation.assigned_volunteer_id) {
      const names = body.pickup.map((member) => volunteers.get(member.volunteer_id)?.full_name ?? "TNV").join(", ");
      await notify(donation.stores.owner_id, "partner", "donation-volunteer-assigned", "Đã có TNV cho lô " + donation.donation_code,
        names + " sẽ đến lấy hàng. Hãy đóng gói và bấm \"Đã đóng gói\".", donationId);
    }
    return data;
  },

  // Giữ tương thích với màn hình cũ: giao 1 người lấy (+ 1 người phát)
  async assignSingle(actorId: string, actorRole: UserRole, donationId: string, pickupId: string, distributeId?: string, portions?: number): Promise<unknown> {
    const donation = await loadDonation(donationId);
    const body: AssignTeamBody = {
      pickup: [{ volunteer_id: pickupId, share: Math.max(1, donation.quantity ?? 1) }],
      ...(distributeId ? { distribute: [{ volunteer_id: distributeId, share: Math.max(1, portions ?? 1) }] } : {})
    };
    return teamService.assignTeam(actorId, actorRole, donationId, body);
  },

  // ── Xem ảnh của một lô. Cửa hàng chỉ thấy ảnh đã duyệt; tổ chức và admin thấy tất cả
  async listPhotos(actorId: string, actorRole: UserRole, donationId: string): Promise<unknown[]> {
    const donation = await loadDonation(donationId);
    const access = await resolveAccess(actorId, actorRole, donation);
    await teamService.autoApprovePending(donationId);
    let request = supabaseAdmin
      .from("donation_photos")
      .select("id,volunteer_id,stage,photo_url,status,taken_at,gps_flag,gps_distance_m,is_demo,review_note,review_deadline_at,volunteers(full_name)")
      .eq("donation_id", donationId)
      .order("taken_at", { ascending: true });
    if (access === "store") request = request.in("status", VISIBLE_TO_STORE);
    const { data, error } = await request;
    if (error) handleSupabaseError(error, "Failed to load photos");
    return data ?? [];
  },

  // ── Tổ chức duyệt hoặc yêu cầu chụp lại
  async reviewPhoto(actorId: string, actorRole: UserRole, photoId: string, body: PhotoReviewBody): Promise<unknown> {
    const { data: loaded, error: loadError } = await supabaseAdmin.from("donation_photos").select("id,donation_id,volunteer_id,stage,status").eq("id", photoId).maybeSingle();
    if (loadError) handleSupabaseError(loadError, "Failed to load photo");
    const photo = requireRecord(loaded as { id: string; donation_id: string; volunteer_id: string; stage: Stage; status: string } | null, "Không tìm thấy ảnh");
    const donation = await loadDonation(photo.donation_id);
    const access = await resolveAccess(actorId, actorRole, donation);
    if (access === "store") throw forbidden("Chỉ tổ chức mới duyệt được ảnh");

    const status = body.action === "approve" ? "approved" : "retake";
    const note = body.action === "retake" ? (body.note?.trim() || "Ảnh chưa rõ, vui lòng chụp lại") : null;
    const { data, error } = await supabaseAdmin
      .from("donation_photos")
      .update({ status, review_note: note, reviewed_by: actorId, reviewed_at: new Date().toISOString() })
      .eq("id", photoId)
      .select("*")
      .single();
    if (error) handleSupabaseError(error, "Failed to review photo");

    if (status === "approved") {
      await notify(donation.stores.owner_id, "partner", "donation-photos-approved", "Có ảnh minh chứng mới cho lô " + donation.donation_code,
        (donation.charity_profiles?.name ?? "Tổ chức") + " đã gửi ảnh cho thấy hàng của bạn được sử dụng.", donation.id);
    } else {
      // Yêu cầu chụp lại: ảnh không còn tính vào số ảnh tối thiểu, đồng thời mở lại phần việc đã báo xong
      await supabaseAdmin.from("donation_assignments").update({ done_at: null }).eq("donation_id", donation.id).eq("volunteer_id", photo.volunteer_id).eq("stage", photo.stage);
      if (photo.stage === "distribute") await supabaseAdmin.from("donations").update({ distribution_done_at: null }).eq("id", donation.id);
    }
    return data;
  },

  // ── Báo cáo từng lô: ai làm gì, bao nhiêu suất, ảnh, dòng thời gian
  async getReport(actorId: string, actorRole: UserRole, donationId: string): Promise<unknown> {
    const donation = await loadDonation(donationId);
    const access = await resolveAccess(actorId, actorRole, donation);
    await teamService.autoApprovePending(donationId);

    const { data: full, error } = await supabaseAdmin.from("donations").select("*").eq("id", donationId).single();
    if (error) handleSupabaseError(error, "Failed to load donation report");
    const row = full as Record<string, unknown>;

    const { data: assignments } = await supabaseAdmin
      .from("donation_assignments")
      .select("volunteer_id,stage,share,done_at,volunteers(full_name,phone,vehicle)")
      .eq("donation_id", donationId)
      .order("assigned_at", { ascending: true });
    const photos = (await teamService.listPhotos(actorId, actorRole, donationId)) as Array<Record<string, unknown>>;

    const rows = (assignments ?? []) as unknown as Array<{ volunteer_id: string; stage: Stage; share: number; done_at: string | null; volunteers: { full_name: string; phone: string; vehicle: string } | null }>;
    const team = (stage: Stage) => rows.filter((item) => item.stage === stage).map((item) => ({
      volunteer_id: item.volunteer_id,
      name: item.volunteers?.full_name ?? "TNV",
      phone: access === "store" ? null : item.volunteers?.phone ?? null,
      vehicle: item.volunteers?.vehicle ?? "",
      share: item.share,
      done_at: item.done_at,
      photo_count: photos.filter((photo) => photo.volunteer_id === item.volunteer_id && photo.stage === stage && photo.status !== "retake").length
    }));

    const timeline: Array<{ at: string; label: string }> = [];
    const push = (at: unknown, label: string): void => { if (typeof at === "string" && at) timeline.push({ at, label }); };
    push(row.created_at, "Cửa hàng đăng lô tặng");
    push(row.accepted_at, (donation.charity_profiles?.name ?? "Tổ chức") + " chọn lô");
    push(row.store_confirmed_at, "Cửa hàng chấp nhận quyên góp");
    push(row.volunteer_assigned_at, "Tổ chức giao đội lấy hàng");
    push(row.packed_at, "Cửa hàng đóng gói xong");
    push(row.completed_at, "Cửa hàng bàn giao cho TNV");
    for (const photo of photos) {
      if (photo.stage === "pickup") { push(photo.taken_at, "Ảnh nhận hàng của " + String((photo.volunteers as { full_name?: string } | null)?.full_name ?? "TNV")); break; }
    }
    push(row.distribute_assigned_at, "Tổ chức giao đội phát hàng");
    push(row.distribution_done_at, "Hoàn tất phát hàng");
    timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    return {
      donation: {
        id: donation.id,
        code: donation.donation_code,
        status: row.status,
        items: row.items,
        amount_text: row.amount_text,
        quantity: row.quantity,
        weight_kg: row.weight_kg,
        portions: row.portions,
        completed_at: row.completed_at,
        distribution_done_at: row.distribution_done_at
      },
      store: { name: donation.stores.name },
      charity: { name: donation.charity_profiles?.name ?? "" },
      team: { pickup: team("pickup"), distribute: team("distribute") },
      photos,
      timeline
    };
  },

  // ───────── Phía tình nguyện viên

  async volunteerAssignment(volunteerId: string, donationId: string, stage: Stage): Promise<{ donation: DonationBrief; share: number; done_at: string | null }> {
    const { data, error } = await supabaseAdmin
      .from("donation_assignments")
      .select("share,done_at")
      .eq("donation_id", donationId)
      .eq("volunteer_id", volunteerId)
      .eq("stage", stage)
      .maybeSingle();
    if (error) handleSupabaseError(error, "Failed to load assignment");
    const assignment = data as { share: number; done_at: string | null } | null;
    if (!assignment) throw forbidden(stage === "pickup" ? "Bạn không có phần lấy hàng của lô này" : "Bạn không có phần phát hàng của lô này");
    return { donation: await loadDonation(donationId), share: assignment.share, done_at: assignment.done_at };
  },

  async assertPhotoStageOpen(donation: DonationBrief, stage: Stage): Promise<void> {
    if (stage === "pickup") {
      if (!["in_route", "completed"].includes(donation.status)) throw conflict("Hãy chụp ảnh sau khi bạn đã nhận hàng tại cửa hàng");
      return;
    }
    // Giai đoạn phát mở khi đã có ảnh lấy hàng (không chờ duyệt)
    const { count, error } = await supabaseAdmin
      .from("donation_photos")
      .select("id", { count: "exact", head: true })
      .eq("donation_id", donation.id)
      .eq("stage", "pickup")
      .neq("status", "retake");
    if (error) handleSupabaseError(error, "Failed to check pickup photos");
    if ((count ?? 0) < 1) throw conflict("Giai đoạn phát hàng sẽ mở khi người lấy hàng đã gửi ảnh nhận hàng");
  },

  async createPhotoUploadUrl(volunteerId: string, donationId: string, stage: Stage, contentType: string): Promise<{ path: string; token: string; signed_url: string; public_url: string }> {
    const extension = IMAGE_TYPES[contentType];
    if (!extension) throw invalid("Chỉ nhận ảnh JPG, PNG hoặc WEBP");
    const { donation } = await teamService.volunteerAssignment(volunteerId, donationId, stage);
    await teamService.assertPhotoStageOpen(donation, stage);
    const path = "photos/" + donationId + "/" + volunteerId + "/" + randomUUID() + "." + extension;
    const bucket = supabaseAdmin.storage.from(PHOTO_BUCKET);
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) throw new AppError("Không tạo được link tải ảnh. Hãy chắc chắn đã chạy file SQL 019.", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    return { path, token: data.token, signed_url: data.signedUrl, public_url: bucket.getPublicUrl(path).data.publicUrl };
  },

  async submitPhoto(volunteerId: string, donationId: string, input: {
    stage: Stage; photo_url: string; taken_at?: string | undefined; lat?: number | undefined; lng?: number | undefined;
    is_demo?: boolean | undefined; blur_score?: number | undefined; brightness?: number | undefined;
  }): Promise<unknown> {
    const { donation } = await teamService.volunteerAssignment(volunteerId, donationId, input.stage);
    await teamService.assertPhotoStageOpen(donation, input.stage);

    const prefix = env.SUPABASE_URL.replace(/\/+$/, "") + "/storage/v1/object/public/" + PHOTO_BUCKET + "/photos/" + donationId + "/" + volunteerId + "/";
    if (!input.photo_url.startsWith(prefix)) throw invalid("Ảnh không hợp lệ cho nhiệm vụ này");
    if (input.is_demo && !env.DEMO_MODE) throw forbidden("Ảnh tải từ thư viện chỉ dùng được ở chế độ demo");

    // Kiểm tra vị trí chụp: lấy hàng so với cửa hàng, phát hàng so với tổ chức. Ảnh demo bỏ qua.
    const place = input.stage === "pickup" ? donation.stores : donation.charity_profiles;
    let gpsFlag = false;
    let distanceM: number | null = null;
    if (!input.is_demo) {
      const spot = { latitude: input.lat ?? undefined, longitude: input.lng ?? undefined };
      const target = { latitude: place?.latitude ?? undefined, longitude: place?.longitude ?? undefined };
      if (isValidCoordinates(spot) && isValidCoordinates(target)) {
        distanceM = Math.round(distanceKmBetween(spot, target) * 1000);
        gpsFlag = distanceM > env.PHOTO_GPS_MAX_METERS;
      } else if (!isValidCoordinates(spot)) {
        gpsFlag = true; // không có GPS thì không xác minh được vị trí chụp
      }
    }

    const now = new Date();
    const { data, error } = await supabaseAdmin
      .from("donation_photos")
      .insert({
        donation_id: donationId,
        volunteer_id: volunteerId,
        stage: input.stage,
        photo_url: input.photo_url,
        taken_at: input.taken_at ?? now.toISOString(),
        gps_lat: input.lat ?? null,
        gps_lng: input.lng ?? null,
        gps_distance_m: distanceM,
        gps_flag: gpsFlag,
        is_demo: Boolean(input.is_demo),
        blur_score: input.blur_score ?? null,
        brightness: input.brightness ?? null,
        status: "pending",
        review_deadline_at: computeReviewDeadline(now).toISOString()
      })
      .select("id,stage,photo_url,status,taken_at,gps_flag,is_demo,review_note")
      .single();
    if (error) handleSupabaseError(error, "Failed to save photo");
    return data;
  },

  // TNV báo đã xong phần việc của mình (đủ số ảnh tối thiểu)
  async completeStage(volunteerId: string, donationId: string, stage: Stage): Promise<unknown> {
    const { donation } = await teamService.volunteerAssignment(volunteerId, donationId, stage);
    await teamService.assertPhotoStageOpen(donation, stage);
    const { count, error: countError } = await supabaseAdmin
      .from("donation_photos")
      .select("id", { count: "exact", head: true })
      .eq("donation_id", donationId)
      .eq("volunteer_id", volunteerId)
      .eq("stage", stage)
      .neq("status", "retake");
    if (countError) handleSupabaseError(countError, "Failed to count photos");
    if ((count ?? 0) < PHOTO_MIN[stage]) throw conflict("Cần ít nhất " + PHOTO_MIN[stage] + " ảnh cho phần việc này (đang có " + (count ?? 0) + ")");

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("donation_assignments")
      .update({ done_at: now })
      .eq("donation_id", donationId)
      .eq("volunteer_id", volunteerId)
      .eq("stage", stage);
    if (error) handleSupabaseError(error, "Failed to complete stage");

    const { data: volunteer } = await supabaseAdmin.from("volunteers").select("full_name").eq("id", volunteerId).maybeSingle();
    const name = (volunteer as { full_name: string } | null)?.full_name ?? "TNV";
    await notify(donation.charity_profiles?.owner_id, "charity", "donation-photos-submitted", "Ảnh " + (stage === "pickup" ? "nhận hàng" : "phát hàng") + " chờ duyệt · lô " + donation.donation_code,
      name + " đã gửi ảnh. Hãy xem và duyệt để gửi sang cửa hàng.", donationId);

    let distributionDone = false;
    if (stage === "distribute") {
      const { data: pending } = await supabaseAdmin.from("donation_assignments").select("id").eq("donation_id", donationId).eq("stage", "distribute").is("done_at", null);
      if ((pending ?? []).length === 0) {
        distributionDone = true;
        await supabaseAdmin.from("donations").update({ distribution_done_at: now }).eq("id", donationId);
        await notify(donation.charity_profiles?.owner_id, "charity", "donation-distribution-done", "Hoàn tất phát hàng · lô " + donation.donation_code,
          "Tất cả TNV phát hàng đã gửi ảnh phần của mình.", donationId);
      }
    }
    return { done: true, distribution_done: distributionDone };
  },

  // Việc của TNV: đủ thông tin phần việc của mình, đội, ảnh đã gửi
  async listVolunteerTasks(volunteerId: string): Promise<unknown[]> {
    const { data: mine, error: mineError } = await supabaseAdmin.from("donation_assignments").select("donation_id,stage,share,done_at").eq("volunteer_id", volunteerId);
    if (mineError) handleSupabaseError(mineError, "Failed to load assignments");
    const myRows = (mine ?? []) as Array<{ donation_id: string; stage: Stage; share: number; done_at: string | null }>;
    const ids = Array.from(new Set(myRows.map((row) => row.donation_id)));
    if (ids.length === 0) return [];

    const [{ data: donations, error }, { data: team }, { data: photos }] = await Promise.all([
      supabaseAdmin
        .from("donations")
        .select("id,donation_code,items,amount_text,quantity,weight_kg,status,expires_at,store_confirmed_at,packed_at,pickup_code,volunteer_assigned_at,completed_at,note,portions,distribution_done_at,stores(name,address,latitude,longitude,emoji,public_hotline),charity_profiles(name,address)")
        .in("id", ids)
        .in("status", ["accepted", "in_route", "completed"])
        .order("volunteer_assigned_at", { ascending: false })
        .limit(40),
      supabaseAdmin.from("donation_assignments").select("donation_id,stage,share,done_at,volunteers(full_name)").in("donation_id", ids),
      supabaseAdmin.from("donation_photos").select("id,donation_id,volunteer_id,stage,photo_url,status,review_note,taken_at,is_demo,gps_flag").in("donation_id", ids).order("taken_at", { ascending: true })
    ]);
    if (error) handleSupabaseError(error, "Failed to load volunteer tasks");

    const teamRows = (team ?? []) as unknown as Array<{ donation_id: string; stage: Stage; share: number; done_at: string | null; volunteers: { full_name: string } | null }>;
    const photoRows = (photos ?? []) as unknown as Array<{ donation_id: string; volunteer_id: string; stage: Stage; status: string }>;

    return ((donations ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
      const id = row.id as string;
      const mineHere = myRows.filter((item) => item.donation_id === id);
      const myPickup = mineHere.find((item) => item.stage === "pickup") ?? null;
      const myDistribute = mineHere.find((item) => item.stage === "distribute") ?? null;
      const members = (stage: Stage) => teamRows.filter((item) => item.donation_id === id && item.stage === stage).map((item) => ({ name: item.volunteers?.full_name ?? "TNV", share: item.share, done: Boolean(item.done_at) }));
      const allPhotos = photoRows.filter((photo) => photo.donation_id === id);
      return {
        ...row,
        does_pickup: Boolean(myPickup),
        does_distribute: Boolean(myDistribute),
        my_pickup: myPickup ? { share: myPickup.share, done_at: myPickup.done_at } : null,
        my_distribute: myDistribute ? { share: myDistribute.share, done_at: myDistribute.done_at } : null,
        team: { pickup: members("pickup"), distribute: members("distribute") },
        my_photos: allPhotos.filter((photo) => photo.volunteer_id === volunteerId),
        pickup_photo_count: allPhotos.filter((photo) => photo.stage === "pickup" && photo.status !== "retake").length
      };
    });
  }
};
