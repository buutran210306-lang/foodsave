import type { AcceptDonationBody, CreateDonationBody, DonationListQuery, UpdateDonationStatusBody } from "../schemas/donationSchemas";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { Donation, UserRole } from "../types/domain";
import type { PaginatedResponse } from "../types/api";
import { AppError } from "../utils/appError";
import { generateCode, getRange, handleSupabaseError, requireRecord, supabaseAdmin, toPagination } from "./supabaseService";
import { ecoImpactService } from "./ecoImpactService";
import { logger } from "../utils/logger";

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

export const donationService = {
  async listDonations(actorId: string, actorRole: UserRole, query: DonationListQuery): Promise<PaginatedResponse<Donation>> {
    const { from, to } = getRange(query);
    let request = supabaseAdmin
      .from("donations")
      .select("*, stores(id,name,owner_id,emoji,address), charity_profiles(id,name), volunteers(id,full_name,phone)", { count: "exact" })
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

    return {
      items: (data ?? []) as Donation[],
      pagination: toPagination(query.page, query.limit, count ?? 0)
    };
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

    if (body.assigned_volunteer_id) {
      const { data: volunteer, error: volunteerError } = await supabaseAdmin
        .from("volunteers")
        .select("id,charity_id")
        .eq("id", body.assigned_volunteer_id)
        .single();
      if (volunteerError) handleSupabaseError(volunteerError, "Failed to load volunteer");
      const loadedVolunteer = volunteer as { charity_id: string } | null;
      if (loadedVolunteer?.charity_id !== body.charity_id) {
        throw new AppError("Volunteer does not belong to this charity", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
      }
    }

    const { data: loadedDonation, error: loadError } = await supabaseAdmin
      .from("donations")
      .select("id,status,store_id,stores!inner(owner_id)")
      .eq("id", donationId)
      .single();

    if (loadError) handleSupabaseError(loadError, "Failed to load donation");
    const existing = requireRecord(loadedDonation as { status: string; stores: { owner_id: string } } | null, "Donation was not found");
    if (existing.status !== "open") {
      throw new AppError("Only open donations can be accepted", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }

    const { data, error } = await supabaseAdmin
      .from("donations")
      .update({
        status: "accepted",
        charity_id: body.charity_id,
        assigned_volunteer_id: body.assigned_volunteer_id ?? null,
        accepted_at: new Date().toISOString()
      })
      .eq("id", donationId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to accept donation");
    const donation = data as Donation;

    await supabaseAdmin.from("notifications").insert({
      recipient_id: existing.stores.owner_id,
      role_target: "partner",
      type: "donation-accepted",
      title: "Donation đã được nhận",
      body: `Donation ${donation.donation_code} đã được tổ chức từ thiện nhận`,
      related_type: "donation",
      related_id: donation.id
    });

    return donation;
  },

  async updateDonationStatus(actorId: string, actorRole: UserRole, donationId: string, body: UpdateDonationStatusBody): Promise<Donation> {
    const { data: loadedDonation, error: loadError } = await supabaseAdmin
      .from("donations")
      .select("id,store_id,charity_id,status,stores!inner(owner_id)")
      .eq("id", donationId)
      .single();

    if (loadError) handleSupabaseError(loadError, "Failed to load donation");
    const donation = requireRecord(loadedDonation as { store_id: string; charity_id: string | null; status: string; stores: { owner_id: string } } | null, "Donation was not found");

    if (actorRole === "partner") await assertStoreOwner(donation.store_id, actorId, actorRole);
    if (actorRole === "charity") {
      if (!donation.charity_id) {
        throw new AppError("This donation has not been accepted by a charity", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
      }
      await assertCharityOwner(donation.charity_id, actorId, actorRole);
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
