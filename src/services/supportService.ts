import type { CreateApplicationBody, CreateContactMessageBody } from "../schemas/supportSchemas";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export const supportService = {
  async createContactMessage(userId: string | null, body: CreateContactMessageBody): Promise<unknown> {
    const { data, error } = await supabaseAdmin
      .from("contact_messages")
      .insert({
        ...body,
        user_id: userId,
        status: "open"
      })
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create contact message");
    return data;
  },

  async createApplication(userId: string | null, body: CreateApplicationBody): Promise<unknown> {
    const { data, error } = await supabaseAdmin
      .from("applications")
      .insert({
        ...body,
        user_id: userId,
        status: "pending"
      })
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create application");
    return data;
  }
};
