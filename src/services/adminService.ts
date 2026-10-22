import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

type ProfileRow = {
  id: string;
  role?: string | null;
  full_name?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StoreRow = {
  id: string;
  owner_id: string;
  name?: string | null;
  slug?: string | null;
  logo_url?: string | null;
  address?: string | null;
  district?: string | null;
  city?: string | null;
  rating?: number | string | null;
  commission_rate?: number | string | null;
  service_tier?: string | null;
  is_verified?: boolean | null;
  status?: string | null;
  rejection_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const requirePartnerProfile = async (userId: string): Promise<ProfileRow> => {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,role,full_name,phone,avatar_url,status,metadata,created_at,updated_at")
    .eq("id", userId)
    .single();

  if (error) handleSupabaseError(error, "Failed to load partner profile");
  if (!data) {
    throw new AppError("Partner profile was not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const profile = data as ProfileRow;
  if (profile.role !== "partner") {
    throw new AppError("Target user is not a partner", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  return profile;
};

const requirePartnerStores = async (userId: string): Promise<StoreRow[]> => {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("*")
    .eq("owner_id", userId);

  if (error) handleSupabaseError(error, "Failed to load partner stores");

  const stores = (data ?? []) as StoreRow[];
  if (stores.length === 0) {
    throw new AppError("Partner store was not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  return stores;
};

const loadProfilesById = async (ownerIds: string[]): Promise<Map<string, ProfileRow>> => {
  if (ownerIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,role,full_name,phone,avatar_url,status,metadata,created_at,updated_at")
    .in("id", ownerIds);

  if (error) handleSupabaseError(error, "Failed to load partner profiles");

  return new Map(((data ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));
};

export const adminService = {
  async getPendingPartners(): Promise<Array<{ userId: string; profile: ProfileRow | null; store: StoreRow }>> {
    const [
      { data: pendingStores, error: pendingStoreError },
      { data: pendingProfiles, error: pendingProfileError }
    ] = await Promise.all([
      supabaseAdmin
        .from("stores")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("profiles")
        .select("id,role,full_name,phone,avatar_url,status,metadata,created_at,updated_at")
        .eq("role", "partner")
        .eq("status", "pending")
    ]);

    if (pendingStoreError) handleSupabaseError(pendingStoreError, "Failed to load pending partner stores");
    if (pendingProfileError) handleSupabaseError(pendingProfileError, "Failed to load pending partner profiles");

    const pendingStoreRows = (pendingStores ?? []) as StoreRow[];
    const pendingProfileRows = (pendingProfiles ?? []) as ProfileRow[];
    const pendingProfileIds = new Set(pendingProfileRows.map((profile) => profile.id));
    const ownerIds = [...new Set([...pendingStoreRows.map((store) => store.owner_id), ...pendingProfileRows.map((profile) => profile.id)])];

    let storeRows = pendingStoreRows;
    if (ownerIds.length > 0) {
      const { data: storesByOwner, error: storesByOwnerError } = await supabaseAdmin
        .from("stores")
        .select("*")
        .in("owner_id", ownerIds)
        .order("created_at", { ascending: false });

      if (storesByOwnerError) handleSupabaseError(storesByOwnerError, "Failed to load stores for pending partner profiles");

      const storesById = new Map<string, StoreRow>();
      [...pendingStoreRows, ...((storesByOwner ?? []) as StoreRow[])].forEach((store) => {
        storesById.set(store.id, store);
      });
      storeRows = [...storesById.values()].filter((store) => store.status === "pending" || pendingProfileIds.has(store.owner_id));
    }

    const profilesById = await loadProfilesById([...new Set(storeRows.map((store) => store.owner_id))]);

    return storeRows.map((store) => ({
      userId: store.owner_id,
      profile: profilesById.get(store.owner_id) ?? null,
      store
    }));
  },

  async approvePartner(userId: string): Promise<{ userId: string; profile: ProfileRow; stores: StoreRow[] }> {
    await requirePartnerProfile(userId);
    await requirePartnerStores(userId);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id,role,full_name,phone,avatar_url,status,metadata,created_at,updated_at")
      .single();

    if (profileError) handleSupabaseError(profileError, "Failed to approve partner profile");

    const { data: stores, error: storeError } = await supabaseAdmin
      .from("stores")
      .update({
        status: "active",
        is_verified: true,
        rejection_reason: null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("owner_id", userId)
      .select("*");

    if (storeError) handleSupabaseError(storeError, "Failed to approve partner stores");

    return {
      userId,
      profile: profile as ProfileRow,
      stores: (stores ?? []) as StoreRow[]
    };
  },

  async rejectPartner(userId: string, reason: string): Promise<{ userId: string; profile: ProfileRow; stores: StoreRow[] }> {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      throw new AppError("Rejection reason is required", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    await requirePartnerProfile(userId);
    await requirePartnerStores(userId);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id,role,full_name,phone,avatar_url,status,metadata,created_at,updated_at")
      .single();

    if (profileError) handleSupabaseError(profileError, "Failed to reject partner profile");

    const { data: stores, error: storeError } = await supabaseAdmin
      .from("stores")
      .update({
        status: "rejected",
        rejection_reason: normalizedReason,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("owner_id", userId)
      .select("*");

    if (storeError) handleSupabaseError(storeError, "Failed to reject partner stores");

    return {
      userId,
      profile: profile as ProfileRow,
      stores: (stores ?? []) as StoreRow[]
    };
  },

  // Tổng quan số người dùng theo vai trò + danh sách người mua thật (đọc bằng service role, chỉ Admin gọi được)
  async systemUsers(): Promise<{
    counts: { customers: number; partners: number; charities: number; volunteers: number; admins: number; stores: number };
    buyers: Array<Record<string, unknown>>;
  }> {
    const countRole = async (role: string): Promise<number> => {
      const { count, error } = await supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("role", role);
      if (error) handleSupabaseError(error, "Failed to count " + role);
      return count ?? 0;
    };
    const countTable = async (table: string): Promise<number> => {
      const { count, error } = await supabaseAdmin.from(table).select("id", { count: "exact", head: true });
      if (error) handleSupabaseError(error, "Failed to count " + table);
      return count ?? 0;
    };
    const [customers, partners, charities, admins, volunteers, stores] = await Promise.all([
      countRole("customer"), countRole("partner"), countRole("charity"), countRole("admin"), countTable("volunteers"), countTable("stores")
    ]);

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id,full_name,phone,status,points,rank,created_at")
      .eq("role", "customer")
      .order("created_at", { ascending: false })
      .limit(500);
    if (profilesError) handleSupabaseError(profilesError, "Failed to list buyers");
    const buyers = profiles ?? [];

    // Email + cách đăng nhập nằm ở auth.users, đơn hàng nằm ở bảng orders
    const authInfo = new Map<string, { email: string; provider: string; lastSignIn: string | null }>();
    try {
      const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const user of data?.users ?? []) {
        const provider = String((user.app_metadata as Record<string, unknown> | undefined)?.provider ?? "email");
        authInfo.set(user.id, { email: user.email ?? "", provider, lastSignIn: user.last_sign_in_at ?? null });
      }
    } catch {
      // Không đọc được auth.users thì vẫn trả danh sách (thiếu email)
    }

    const orderStats = new Map<string, { total: number; completed: number; cancelled: number }>();
    const ids = buyers.map((b) => b.id as string);
    if (ids.length) {
      const { data: orders } = await supabaseAdmin.from("orders").select("customer_id,status").in("customer_id", ids).limit(20000);
      for (const order of orders ?? []) {
        const key = order.customer_id as string;
        const stat = orderStats.get(key) ?? { total: 0, completed: 0, cancelled: 0 };
        stat.total += 1;
        if (order.status === "completed") stat.completed += 1;
        if (order.status === "cancelled") stat.cancelled += 1;
        orderStats.set(key, stat);
      }
    }

    return {
      counts: { customers, partners, charities, volunteers, admins, stores },
      buyers: buyers.map((b) => {
        const auth = authInfo.get(b.id as string);
        const stat = orderStats.get(b.id as string);
        return {
          id: b.id,
          full_name: b.full_name ?? "",
          email: auth?.email ?? "",
          phone: b.phone ?? "",
          status: b.status ?? "active",
          provider: auth?.provider ?? "email",
          points: b.points ?? 0,
          rank: b.rank ?? "",
          created_at: b.created_at,
          last_sign_in_at: auth?.lastSignIn ?? null,
          orders_total: stat?.total ?? 0,
          orders_completed: stat?.completed ?? 0,
          orders_cancelled: stat?.cancelled ?? 0
        };
      })
    };
  }
};
