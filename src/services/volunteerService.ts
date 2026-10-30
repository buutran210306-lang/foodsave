import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { createVolunteerToken } from "../utils/volunteerToken";
import { handleSupabaseError, requireRecord, supabaseAdmin } from "./supabaseService";
import { createNotification } from "./notificationService";
import { teamService } from "./teamService";

const normalizePhone = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("84") && digits.length >= 11 ? "0" + digits.slice(2) : digits;
};

interface VolunteerRow {
  id: string;
  charity_id: string;
  full_name: string;
  phone: string;
  status: string;
  vehicle: string;
  charity_profiles: { name: string } | null;
}

interface ProfileRow {
  id: string;
  charity_id: string;
  full_name: string;
  phone: string;
  email: string;
  vehicle: string;
  zones: string[];
  schedule: string;
  role: string;
  duty_role: string;
  active_on: string | null;
  avatar_url: string | null;
  status: string;
  runs: number;
  kg_collected: number;
  rating: number;
  charity_profiles: { name: string; owner_id: string } | null;
}

const PROFILE_SELECT = "id,charity_id,full_name,phone,email,vehicle,zones,schedule,role,duty_role,active_on,avatar_url,status,runs,kg_collected,rating,charity_profiles(name,owner_id)";

// Ngày hiện tại theo giờ Việt Nam (YYYY-MM-DD)
const vnToday = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

export interface VolunteerProfilePatch {
  full_name?: string | undefined;
  email?: string | undefined;
  vehicle?: string | undefined;
  zones?: string[] | undefined;
  schedule?: string | undefined;
  duty_role?: "pickup" | "distribute" | "both" | undefined;
  avatar_url?: string | undefined;
}

const AVATAR_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const avatarPrefix = (volunteerId: string): string => env.SUPABASE_URL.replace(/\/+$/, "") + "/storage/v1/object/public/donation-proofs/avatars/volunteers/" + volunteerId + "/";

export const volunteerService = {
  async login(phone: string): Promise<{ token: string; volunteer: { id: string; full_name: string; phone: string; charity_name: string } }> {
    const normalized = normalizePhone(phone);
    if (normalized.length < 9) {
      throw new AppError("Số điện thoại không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    // Số điện thoại có thể được lưu kèm dấu cách, dấu chấm hay +84 nên so sánh sau khi chuẩn hóa
    const { data, error } = await supabaseAdmin
      .from("volunteers")
      .select("id,charity_id,full_name,phone,status,vehicle,charity_profiles(name)")
      .limit(2000);
    if (error) handleSupabaseError(error, "Failed to look up volunteer");

    const match = ((data ?? []) as unknown as VolunteerRow[]).find((row) => normalizePhone(row.phone) === normalized);
    if (!match) {
      throw new AppError("Số điện thoại này chưa được tổ chức đăng ký tình nguyện viên", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
    }
    if (match.status === "inactive") {
      throw new AppError("Tài khoản tình nguyện viên đang bị tạm ngưng", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    await supabaseAdmin.from("volunteers").update({ last_login_at: new Date().toISOString() }).eq("id", match.id);

    return {
      token: createVolunteerToken(match.id, match.charity_id),
      volunteer: { id: match.id, full_name: match.full_name, phone: match.phone, charity_name: match.charity_profiles?.name ?? "" }
    };
  },

  async getProfile(volunteerId: string): Promise<unknown> {
    const { data, error } = await supabaseAdmin.from("volunteers").select(PROFILE_SELECT).eq("id", volunteerId).maybeSingle();
    if (error) handleSupabaseError(error, "Failed to load volunteer profile");
    const row = requireRecord(data as unknown as ProfileRow | null, "Không tìm thấy tài khoản tình nguyện viên");
    return {
      id: row.id,
      full_name: row.full_name,
      phone: row.phone,
      email: row.email,
      vehicle: row.vehicle,
      zones: row.zones,
      schedule: row.schedule,
      role: row.role,
      duty_role: row.duty_role ?? "both",
      avatar_url: row.avatar_url,
      demo_mode: env.DEMO_MODE,
      active_today: row.active_on === vnToday(),
      status: row.status,
      runs: row.runs,
      kg_collected: Number(row.kg_collected) || 0,
      rating: Number(row.rating) || 5,
      charity_name: row.charity_profiles?.name ?? ""
    };
  },

  // TNV tự sửa thông tin. KHÔNG cho sửa số điện thoại: chỉ tổ chức được đổi số.
  async updateProfile(volunteerId: string, patch: VolunteerProfilePatch): Promise<unknown> {
    const { data: existing, error: loadError } = await supabaseAdmin.from("volunteers").select(PROFILE_SELECT).eq("id", volunteerId).maybeSingle();
    if (loadError) handleSupabaseError(loadError, "Failed to load volunteer profile");
    const row = requireRecord(existing as unknown as ProfileRow | null, "Không tìm thấy tài khoản tình nguyện viên");
    if (row.status === "inactive") {
      throw new AppError("Tài khoản tình nguyện viên đang bị tạm ngưng", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    const update: VolunteerProfilePatch = {};
    if (patch.full_name !== undefined) update.full_name = patch.full_name;
    if (patch.email !== undefined) update.email = patch.email;
    if (patch.vehicle !== undefined) update.vehicle = patch.vehicle;
    if (patch.zones !== undefined) update.zones = patch.zones;
    if (patch.schedule !== undefined) update.schedule = patch.schedule;
    if (patch.duty_role !== undefined) update.duty_role = patch.duty_role;
    if (patch.avatar_url !== undefined) {
      if (!patch.avatar_url.startsWith(avatarPrefix(volunteerId))) {
        throw new AppError("Ảnh đại diện không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      }
      update.avatar_url = patch.avatar_url;
    }
    if (Object.keys(update).length > 0) {
      const { error } = await supabaseAdmin.from("volunteers").update(update).eq("id", volunteerId);
      if (error) handleSupabaseError(error, "Failed to update volunteer profile");

      // Báo tổ chức biết TNV vừa cập nhật thông tin (danh sách TNV của tổ chức cũng tự cập nhật theo)
      if (row.charity_profiles?.owner_id) {
        await createNotification({
          recipientId: row.charity_profiles.owner_id,
          roleTarget: "charity",
          type: "volunteer-profile-updated",
          title: "TNV " + (update.full_name ?? row.full_name) + " đã cập nhật thông tin",
          body: "Thông tin tình nguyện viên trong danh sách của tổ chức đã được làm mới.",
          relatedType: "volunteer",
          relatedId: volunteerId
        });
      }
    }
    return volunteerService.getProfile(volunteerId);
  },

  // Link tạm để TNV tải ảnh đại diện lên kho ảnh
  async createAvatarUploadUrl(volunteerId: string, contentType: string): Promise<{ path: string; token: string; signed_url: string; public_url: string }> {
    const extension = AVATAR_TYPES[contentType];
    if (!extension) throw new AppError("Chỉ nhận ảnh JPG, PNG hoặc WEBP", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    const path = "avatars/volunteers/" + volunteerId + "/" + randomUUID() + "." + extension;
    const bucket = supabaseAdmin.storage.from("donation-proofs");
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) {
      throw new AppError("Không tạo được link tải ảnh. Hãy chắc chắn đã chạy file SQL 019.", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
    return { path, token: data.token, signed_url: data.signedUrl, public_url: bucket.getPublicUrl(path).data.publicUrl };
  },

  // Bật / tắt "đang hoạt động hôm nay". Còn việc dở thì không cho tắt.
  async setActive(volunteerId: string, active: boolean): Promise<unknown> {
    if (!active) {
      const { count, error: countError } = await supabaseAdmin
        .from("donations")
        .select("id", { count: "exact", head: true })
        .eq("assigned_volunteer_id", volunteerId)
        .in("status", ["accepted", "in_route"]);
      if (countError) handleSupabaseError(countError, "Failed to check volunteer tasks");
      if ((count ?? 0) > 0) {
        throw new AppError("Bạn còn " + count + " việc chưa xong nên chưa thể tắt hoạt động", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
      }
    }
    const { error } = await supabaseAdmin.from("volunteers").update({ active_on: active ? vnToday() : null }).eq("id", volunteerId);
    if (error) handleSupabaseError(error, "Failed to update volunteer activity");
    return volunteerService.getProfile(volunteerId);
  },

  async listTasks(volunteerId: string): Promise<unknown[]> {
    return teamService.listVolunteerTasks(volunteerId);
  },

  // TNV bấm "Bắt đầu đi lấy"
  async startTask(volunteerId: string, donationId: string): Promise<unknown> {
    const { data: loaded, error: loadError } = await supabaseAdmin
      .from("donations")
      .select("id,status,assigned_volunteer_id,donation_code,stores!inner(owner_id),volunteers!assigned_volunteer_id(full_name)")
      .eq("id", donationId)
      .maybeSingle();
    if (loadError) handleSupabaseError(loadError, "Failed to load task");
    const task = requireRecord(
      loaded as unknown as { id: string; status: string; assigned_volunteer_id: string | null; donation_code: string; stores: { owner_id: string }; volunteers: { full_name: string } | null } | null,
      "Không tìm thấy nhiệm vụ"
    );
    const { data: mine } = await supabaseAdmin.from("donation_assignments").select("id").eq("donation_id", donationId).eq("volunteer_id", volunteerId).eq("stage", "pickup").maybeSingle();
    if (!mine && task.assigned_volunteer_id !== volunteerId) {
      throw new AppError("Nhiệm vụ này không được giao cho bạn", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }
    const { data: me } = await supabaseAdmin.from("volunteers").select("full_name").eq("id", volunteerId).maybeSingle();
    const myName = (me as { full_name: string } | null)?.full_name ?? "Tình nguyện viên";
    if (task.status !== "accepted") {
      throw new AppError("Nhiệm vụ này không ở trạng thái chờ xuất phát", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }

    const { data, error } = await supabaseAdmin
      .from("donations")
      .update({ status: "in_route" })
      .eq("id", donationId)
      .eq("status", "accepted")
      .select("id,status")
      .single();
    if (error) handleSupabaseError(error, "Failed to start task");

    await createNotification({
      recipientId: task.stores.owner_id,
      roleTarget: "partner",
      type: "donation-volunteer-en-route",
      title: "TNV đang đến lấy lô " + task.donation_code,
      body: myName + " đã xuất phát đến cửa hàng.",
      relatedType: "donation",
      relatedId: donationId
    });
    return data;
  }
};
