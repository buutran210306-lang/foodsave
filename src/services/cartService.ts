import type { AddCartItemBody, UpdateCartItemBody } from "../schemas/cartSchemas";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export const cartService = {
  async getCart(userId: string): Promise<unknown[]> {
    const { data, error } = await supabaseAdmin
      .from("cart_items")
      .select("*, products(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) handleSupabaseError(error, "Failed to load cart");
    return data ?? [];
  },

  async addItem(userId: string, body: AddCartItemBody): Promise<unknown> {
    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("id,stock_quantity,is_active")
      .eq("id", body.product_id)
      .single();

    if (productError) handleSupabaseError(productError, "Failed to load product");
    const loadedProduct = product as { stock_quantity: number; is_active: boolean } | null;
    if (!loadedProduct?.is_active || loadedProduct.stock_quantity < body.quantity) {
      throw new AppError("Requested product quantity is not available", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }

    const { data, error } = await supabaseAdmin
      .from("cart_items")
      .upsert({
        user_id: userId,
        product_id: body.product_id,
        quantity: body.quantity
      }, {
        onConflict: "user_id,product_id"
      })
      .select("*, products(*)")
      .single();

    if (error) handleSupabaseError(error, "Failed to add item to cart");
    return data;
  },

  async updateItem(userId: string, productId: string, body: UpdateCartItemBody): Promise<unknown> {
    const { data, error } = await supabaseAdmin
      .from("cart_items")
      .update({ quantity: body.quantity })
      .eq("user_id", userId)
      .eq("product_id", productId)
      .select("*, products(*)")
      .single();

    if (error) handleSupabaseError(error, "Failed to update cart item");
    return data;
  },

  async removeItem(userId: string, productId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from("cart_items")
      .delete()
      .eq("user_id", userId)
      .eq("product_id", productId);

    if (error) handleSupabaseError(error, "Failed to remove cart item");
  },

  async clearCart(userId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from("cart_items")
      .delete()
      .eq("user_id", userId);

    if (error) handleSupabaseError(error, "Failed to clear cart");
  }
};
