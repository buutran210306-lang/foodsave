import type { UpdateProfileBody } from "../schemas/profileSchemas";
import type { Profile } from "../types/domain";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export const profileService = {
  async getProfile(userId: string): Promise<Profile> {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) handleSupabaseError(error, "Failed to load profile");
    return data as Profile;
  },

  async updateProfile(userId: string, body: UpdateProfileBody): Promise<Profile> {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(body)
      .eq("id", userId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update profile");
    return data as Profile;
  }
};
