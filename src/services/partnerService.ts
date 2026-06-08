import { handleSupabaseError, supabaseAdmin } from "./supabaseService";
import { productExpiryLabelService } from "./productExpiryLabelService";

export const partnerService = {
  async getDashboard(ownerId: string): Promise<unknown> {
    const { data: stores, error: storeError } = await supabaseAdmin
      .from("stores")
      .select("id,name,rating,is_open,status")
      .eq("owner_id", ownerId);

    if (storeError) handleSupabaseError(storeError, "Failed to load stores");
    const storeIds = (stores ?? []).map((store) => (store as { id: string }).id);
    const emptyStoreId = "00000000-0000-0000-0000-000000000000";
    const nowIso = new Date().toISOString();

    await productExpiryLabelService.syncProductExpiryLabels();

    const [{ data: orders, error: orderError }, { data: products, error: productError }, { data: complaints, error: complaintError }, { data: donations, error: donationError }] = await Promise.all([
      supabaseAdmin.from("orders").select("id,status,total_cents,created_at").in("store_id", storeIds.length > 0 ? storeIds : [emptyStoreId]),
      supabaseAdmin.from("products").select("id,label,stock_quantity,is_active,expires_at").in("store_id", storeIds.length > 0 ? storeIds : [emptyStoreId]).gte("expires_at", nowIso),
      supabaseAdmin.from("complaints").select("id,status,priority").in("store_id", storeIds.length > 0 ? storeIds : [emptyStoreId]),
      supabaseAdmin.from("donations").select("id,status,weight_kg").in("store_id", storeIds.length > 0 ? storeIds : [emptyStoreId])
    ]);

    if (orderError) handleSupabaseError(orderError, "Failed to load partner orders");
    if (productError) handleSupabaseError(productError, "Failed to load partner products");
    if (complaintError) handleSupabaseError(complaintError, "Failed to load partner complaints");
    if (donationError) handleSupabaseError(donationError, "Failed to load partner donations");

    const completedOrders = (orders ?? []).filter((order) => (order as { status: string }).status === "completed");
    const completedDonations = (donations ?? []).filter((donation) => (donation as { status: string }).status === "completed");
    const totalRevenue = completedOrders.reduce((sum, order) => sum + ((order as { total_cents: number }).total_cents ?? 0), 0);

    return {
      stores: stores ?? [],
      metrics: {
        store_count: storeIds.length,
        active_order_count: (orders ?? []).filter((order) => !["completed", "cancelled"].includes((order as { status: string }).status)).length,
        completed_order_count: completedOrders.length,
        total_revenue_cents: totalRevenue,
        active_product_count: (products ?? []).filter((product) => (product as { is_active: boolean }).is_active).length,
        red_label_product_count: (products ?? []).filter((product) => (product as { label: string }).label === "red").length,
        open_complaint_count: (complaints ?? []).filter((complaint) => (complaint as { status: string }).status === "open").length,
        donation_count: completedDonations.length,
        donated_weight_kg: completedDonations.reduce((sum, donation) => sum + Number((donation as { weight_kg: number }).weight_kg ?? 0), 0)
      }
    };
  }
};
