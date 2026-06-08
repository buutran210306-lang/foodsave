import type {
  CreateBeneficiaryGroupBody,
  CreateCharityProfileBody,
  CreateGalleryItemBody,
  CreateImpactReportBody,
  CreateVolunteerBody,
  UpdateCharityProfileBody,
  UpdateVolunteerBody
} from "../schemas/charitySchemas";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { handleSupabaseError, requireRecord, supabaseAdmin } from "./supabaseService";

const assertCharityOwner = async (charityId: string, actorId: string, actorRole: UserRole): Promise<void> => {
  if (actorRole === "admin") return;

  const { data, error } = await supabaseAdmin
    .from("charity_profiles")
    .select("owner_id")
    .eq("id", charityId)
    .single();

  if (error) handleSupabaseError(error, "Failed to load charity profile");
  const charity = requireRecord(data as { owner_id: string } | null, "Charity profile was not found");

  if (charity.owner_id !== actorId) {
    throw new AppError("You do not own this charity profile", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
};

const monthBounds = (monthStartValue: string): { start: string; end: string; date: string } => {
  const parsed = new Date(monthStartValue);
  const start = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    date: start.toISOString().slice(0, 10)
  };
};

const withAutoImpactMetrics = async (body: CreateImpactReportBody): Promise<CreateImpactReportBody> => {
  const bounds = monthBounds(body.month_start);
  const { data, error } = await supabaseAdmin
    .from("eco_impact_events")
    .select("store_id,source_type,food_saved_kg,co2_avoided_kg,meals_equivalent")
    .eq("charity_id", body.charity_id)
    .gte("occurred_at", bounds.start)
    .lt("occurred_at", bounds.end);

  if (error) handleSupabaseError(error, "Failed to load eco impact data for report");

  const events = data ?? [];
  const kgSaved = events.reduce((sum, event) => sum + Number((event as { food_saved_kg: number }).food_saved_kg ?? 0), 0);
  const co2Kg = events.reduce((sum, event) => sum + Number((event as { co2_avoided_kg: number }).co2_avoided_kg ?? 0), 0);
  const meals = events.reduce((sum, event) => sum + Number((event as { meals_equivalent: number }).meals_equivalent ?? 0), 0);
  const partnerIds = new Set(events.map((event) => (event as { store_id: string | null }).store_id).filter(Boolean));
  const donationCount = events.filter((event) => (event as { source_type: string }).source_type === "donation").length;

  return {
    ...body,
    month_start: bounds.date,
    meals: body.meals || Math.round(meals),
    kg_saved: body.kg_saved || Math.round(kgSaved * 100) / 100,
    co2_kg: body.co2_kg || Math.round(co2Kg * 100) / 100,
    partners_count: body.partners_count || partnerIds.size,
    donors_count: body.donors_count || donationCount
  };
};

export const charityService = {
  async listMyCharities(ownerId: string): Promise<unknown[]> {
    const { data, error } = await supabaseAdmin
      .from("charity_profiles")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });

    if (error) handleSupabaseError(error, "Failed to load charity profiles");
    return data ?? [];
  },

  async createCharityProfile(ownerId: string, body: CreateCharityProfileBody): Promise<unknown> {
    const { data, error } = await supabaseAdmin
      .from("charity_profiles")
      .insert({
        ...body,
        owner_id: ownerId,
        status: "pending"
      })
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create charity profile");
    return data;
  },

  async updateCharityProfile(actorId: string, actorRole: UserRole, charityId: string, body: UpdateCharityProfileBody): Promise<unknown> {
    await assertCharityOwner(charityId, actorId, actorRole);
    const { data, error } = await supabaseAdmin
      .from("charity_profiles")
      .update(body)
      .eq("id", charityId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update charity profile");
    return data;
  },

  async listVolunteers(actorId: string, actorRole: UserRole, charityId: string): Promise<unknown[]> {
    await assertCharityOwner(charityId, actorId, actorRole);
    const { data, error } = await supabaseAdmin
      .from("volunteers")
      .select("*")
      .eq("charity_id", charityId)
      .order("created_at", { ascending: false });

    if (error) handleSupabaseError(error, "Failed to load volunteers");
    return data ?? [];
  },

  async createVolunteer(actorId: string, actorRole: UserRole, body: CreateVolunteerBody): Promise<unknown> {
    await assertCharityOwner(body.charity_id, actorId, actorRole);
    const { data, error } = await supabaseAdmin
      .from("volunteers")
      .insert(body)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create volunteer");
    return data;
  },

  async updateVolunteer(actorId: string, actorRole: UserRole, volunteerId: string, body: UpdateVolunteerBody): Promise<unknown> {
    const { data: volunteer, error: loadError } = await supabaseAdmin
      .from("volunteers")
      .select("id,charity_id")
      .eq("id", volunteerId)
      .single();

    if (loadError) handleSupabaseError(loadError, "Failed to load volunteer");
    const loadedVolunteer = requireRecord(volunteer as { charity_id: string } | null, "Volunteer was not found");
    await assertCharityOwner(loadedVolunteer.charity_id, actorId, actorRole);

    const { data, error } = await supabaseAdmin
      .from("volunteers")
      .update(body)
      .eq("id", volunteerId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update volunteer");
    return data;
  },

  async createBeneficiaryGroup(actorId: string, actorRole: UserRole, body: CreateBeneficiaryGroupBody): Promise<unknown> {
    await assertCharityOwner(body.charity_id, actorId, actorRole);
    const { data, error } = await supabaseAdmin
      .from("beneficiary_groups")
      .insert(body)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create beneficiary group");
    return data;
  },

  async listBeneficiaryGroups(actorId: string, actorRole: UserRole, charityId: string): Promise<unknown[]> {
    await assertCharityOwner(charityId, actorId, actorRole);
    const { data, error } = await supabaseAdmin
      .from("beneficiary_groups")
      .select("*")
      .eq("charity_id", charityId)
      .order("created_at", { ascending: false });

    if (error) handleSupabaseError(error, "Failed to load beneficiary groups");
    return data ?? [];
  },

  async createImpactReport(actorId: string, actorRole: UserRole, body: CreateImpactReportBody): Promise<unknown> {
    await assertCharityOwner(body.charity_id, actorId, actorRole);
    const payload = await withAutoImpactMetrics(body);
    const { data, error } = await supabaseAdmin
      .from("impact_reports")
      .insert(payload)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create impact report");
    return data;
  },

  async listImpactReports(actorId: string, actorRole: UserRole, charityId: string): Promise<unknown[]> {
    await assertCharityOwner(charityId, actorId, actorRole);
    const { data, error } = await supabaseAdmin
      .from("impact_reports")
      .select("*")
      .eq("charity_id", charityId)
      .order("month_start", { ascending: false });

    if (error) handleSupabaseError(error, "Failed to load impact reports");
    return data ?? [];
  },

  async createGalleryItem(actorId: string, actorRole: UserRole, body: CreateGalleryItemBody): Promise<unknown> {
    await assertCharityOwner(body.charity_id, actorId, actorRole);
    const { data, error } = await supabaseAdmin
      .from("gallery_items")
      .insert(body)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create gallery item");
    return data;
  },

  async listGalleryItems(charityId?: string): Promise<unknown[]> {
    let request = supabaseAdmin
      .from("gallery_items")
      .select("*, charity_profiles(id,name)")
      .eq("is_public", true)
      .order("occurred_on", { ascending: false });

    if (charityId) request = request.eq("charity_id", charityId);

    const { data, error } = await request;
    if (error) handleSupabaseError(error, "Failed to load gallery items");
    return data ?? [];
  }
};
