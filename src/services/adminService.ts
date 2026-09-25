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
  }
};
