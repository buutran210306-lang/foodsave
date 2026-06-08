import { PRODUCT_EXPIRY_LABEL_THRESHOLDS } from "../utils/productExpiryLabel";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

const addHours = (date: Date, hours: number): string => {
  return new Date(date.getTime() + hours * 3_600_000).toISOString();
};

export const productExpiryLabelService = {
  async syncProductExpiryLabels(now = new Date()): Promise<void> {
    const redCutoff = addHours(now, PRODUCT_EXPIRY_LABEL_THRESHOLDS.redHours);
    const yellowCutoff = addHours(now, PRODUCT_EXPIRY_LABEL_THRESHOLDS.yellowHours);

    const [{ error: redError }, { error: yellowError }, { error: greenError }] = await Promise.all([
      supabaseAdmin
        .from("products")
        .update({ label: "red" })
        .eq("is_active", true)
        .lte("expires_at", redCutoff)
        .neq("label", "red"),
      supabaseAdmin
        .from("products")
        .update({ label: "yellow" })
        .eq("is_active", true)
        .gt("expires_at", redCutoff)
        .lte("expires_at", yellowCutoff)
        .neq("label", "yellow"),
      supabaseAdmin
        .from("products")
        .update({ label: "green" })
        .eq("is_active", true)
        .gt("expires_at", yellowCutoff)
        .neq("label", "green")
    ]);

    if (redError) handleSupabaseError(redError, "Failed to sync red expiry labels");
    if (yellowError) handleSupabaseError(yellowError, "Failed to sync yellow expiry labels");
    if (greenError) handleSupabaseError(greenError, "Failed to sync green expiry labels");
  }
};
