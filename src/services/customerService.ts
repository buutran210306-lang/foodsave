import type { FavoriteProductBody, FavoriteStoreBody, RecentViewBody } from "../schemas/customerSchemas";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export const customerService = {
  async listFavorites(userId: string): Promise<{ products: unknown[]; stores: unknown[] }> {
    const [{ data: products, error: productError }, { data: stores, error: storeError }] = await Promise.all([
      supabaseAdmin.from("favorite_products").select("*, products(*)").eq("user_id", userId).order("created_at", { ascending: false }),
      supabaseAdmin.from("favorite_stores").select("*, stores(*)").eq("user_id", userId).order("created_at", { ascending: false })
    ]);

    if (productError) handleSupabaseError(productError, "Failed to load favorite products");
    if (storeError) handleSupabaseError(storeError, "Failed to load favorite stores");

    return {
      products: products ?? [],
      stores: stores ?? []
    };
  },

  async addFavoriteProduct(userId: string, body: FavoriteProductBody): Promise<unknown> {
    const { data, error } = await supabaseAdmin
      .from("favorite_products")
      .upsert({ user_id: userId, product_id: body.product_id }, { onConflict: "user_id,product_id" })
      .select("*, products(*)")
      .single();

    if (error) handleSupabaseError(error, "Failed to add favorite product");
    return data;
  },

  async removeFavoriteProduct(userId: string, productId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from("favorite_products")
      .delete()
      .eq("user_id", userId)
      .eq("product_id", productId);

    if (error) handleSupabaseError(error, "Failed to remove favorite product");
  },

  async addFavoriteStore(userId: string, body: FavoriteStoreBody): Promise<unknown> {
    const { data, error } = await supabaseAdmin
      .from("favorite_stores")
      .upsert({ user_id: userId, store_id: body.store_id }, { onConflict: "user_id,store_id" })
      .select("*, stores(*)")
      .single();

    if (error) handleSupabaseError(error, "Failed to add favorite store");
    return data;
  },

  async removeFavoriteStore(userId: string, storeId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from("favorite_stores")
      .delete()
      .eq("user_id", userId)
      .eq("store_id", storeId);

    if (error) handleSupabaseError(error, "Failed to remove favorite store");
  },

  async addRecentView(userId: string, body: RecentViewBody): Promise<unknown> {
    const { data, error } = await supabaseAdmin
      .from("recent_product_views")
      .upsert({
        user_id: userId,
        product_id: body.product_id,
        viewed_at: new Date().toISOString()
      }, {
        onConflict: "user_id,product_id"
      })
      .select("*, products(*)")
      .single();

    if (error) handleSupabaseError(error, "Failed to save recent view");
    return data;
  },

  async listRecentViews(userId: string): Promise<unknown[]> {
    const { data, error } = await supabaseAdmin
      .from("recent_product_views")
      .select("*, products(*)")
      .eq("user_id", userId)
      .order("viewed_at", { ascending: false })
      .limit(10);

    if (error) handleSupabaseError(error, "Failed to load recent views");
    return data ?? [];
  }
};
