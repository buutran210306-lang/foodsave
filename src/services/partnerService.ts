import { randomUUID } from "crypto";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { Product, Store } from "../types/domain";
import { AppError } from "../utils/appError";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

// Ảnh sản phẩm là ảnh công khai cho khách xem, nằm chung bucket với logo/ảnh bìa cửa hàng
const PRODUCT_IMAGE_BUCKET = "partner-assets";
const PRODUCT_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const getOwnStore = async (ownerId: string): Promise<Store | null> => {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) handleSupabaseError(error, "Failed to load store");
  return data as Store | null;
};

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
  },

  // Sản phẩm đang bán của cửa hàng mình (kể cả khi cửa hàng chưa được duyệt)
  async listOwnProducts(ownerId: string): Promise<{ store: Store | null; products: Product[] }> {
    const store = await getOwnStore(ownerId);
    if (!store) return { store: null, products: [] };

    const { data, error } = await supabaseAdmin
      .from("products")
      .select("*")
      .eq("store_id", store.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) handleSupabaseError(error, "Failed to load partner products");
    return { store, products: (data ?? []) as Product[] };
  },

  // Link tạm để trình duyệt tự upload ảnh sản phẩm, không cần quyền ghi Storage trực tiếp
  async createProductImageUploadUrl(ownerId: string, contentType: string): Promise<{ path: string; token: string; signed_url: string; public_url: string }> {
    const extension = PRODUCT_IMAGE_TYPES[contentType];
    if (!extension) {
      throw new AppError("Chỉ nhận ảnh JPG, PNG hoặc WEBP", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    const store = await getOwnStore(ownerId);
    if (!store) {
      throw new AppError("Chưa tìm thấy cửa hàng của tài khoản này", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }

    const path = `products/${store.id}/${randomUUID()}.${extension}`;
    const bucket = supabaseAdmin.storage.from(PRODUCT_IMAGE_BUCKET);
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) {
      throw new AppError("Không tạo được link upload ảnh", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }

    return {
      path,
      token: data.token,
      signed_url: data.signedUrl,
      public_url: bucket.getPublicUrl(path).data.publicUrl
    };
  }
};
