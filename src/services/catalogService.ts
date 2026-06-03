import type {
  CreateProductBody,
  CreateStoreBody,
  CreateVoucherBody,
  ProductListQuery,
  StoreListQuery,
  UpdateProductBody,
  UpdateStoreBody,
  VoucherListQuery
} from "../schemas/catalogSchemas";
import type { PaginatedResponse } from "../types/api";
import type { Product, Store, UserRole, Voucher } from "../types/domain";
import { assertOwnerOrAdmin, getRange, handleSupabaseError, requireRecord, supabaseAdmin, toPagination } from "./supabaseService";

const productSelect = "*, stores!inner(id,name,slug,owner_id,emoji,logo_url,address,district,city,rating,is_verified,is_open,status)";
const storeSelect = "*";

const getStoreOwner = async (storeId: string): Promise<string> => {
  const { data, error } = await supabaseAdmin
    .from("stores")
    .select("owner_id")
    .eq("id", storeId)
    .single();

  if (error) handleSupabaseError(error, "Failed to load store ownership");
  const store = data as { owner_id: string } | null;
  return requireRecord(store, "Store was not found").owner_id;
};

export const catalogService = {
  async listProducts(query: ProductListQuery): Promise<PaginatedResponse<Product>> {
    const { from, to } = getRange(query);
    let request = supabaseAdmin
      .from("products")
      .select(productSelect, { count: "exact" })
      .eq("is_active", true)
      .gt("stock_quantity", 0)
      .eq("stores.status", "active")
      .range(from, to);

    if (query.search) {
      request = request.or(`name.ilike.%${query.search}%,description.ilike.%${query.search}%`);
    }
    if (query.category) request = request.eq("category", query.category);
    if (query.label) request = request.eq("label", query.label);
    if (query.store_id) request = request.eq("store_id", query.store_id);
    if (query.donation !== undefined) request = request.eq("is_donation", query.donation);
    if (query.min_price_cents !== undefined) request = request.gte("price_cents", query.min_price_cents);
    if (query.max_price_cents !== undefined) request = request.lte("price_cents", query.max_price_cents);

    if (query.sort === "urgent") request = request.order("expires_at", { ascending: true });
    if (query.sort === "discount") request = request.order("original_price_cents", { ascending: false });
    if (query.sort === "price_low") request = request.order("price_cents", { ascending: true });
    if (query.sort === "price_high") request = request.order("price_cents", { ascending: false });
    if (query.sort === "rating") request = request.order("rating", { ascending: false });
    if (query.sort === "newest" || query.sort === "nearest") request = request.order("created_at", { ascending: false });

    const { data, error, count } = await request;
    if (error) handleSupabaseError(error, "Failed to list products");

    return {
      items: (data ?? []) as Product[],
      pagination: toPagination(query.page, query.limit, count ?? 0)
    };
  },

  async getProduct(productId: string): Promise<Product> {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select(productSelect)
      .eq("id", productId)
      .eq("is_active", true)
      .single();

    if (error) handleSupabaseError(error, "Failed to load product");
    return data as Product;
  },

  async listStores(query: StoreListQuery): Promise<PaginatedResponse<Store>> {
    const { from, to } = getRange(query);
    let request = supabaseAdmin
      .from("stores")
      .select(storeSelect, { count: "exact" })
      .eq("status", "active")
      .range(from, to)
      .order("rating", { ascending: false });

    if (query.search) request = request.or(`name.ilike.%${query.search}%,address.ilike.%${query.search}%`);
    if (query.district) request = request.eq("district", query.district);
    if (query.verified !== undefined) request = request.eq("is_verified", query.verified);
    if (query.open !== undefined) request = request.eq("is_open", query.open);

    const { data, error, count } = await request;
    if (error) handleSupabaseError(error, "Failed to list stores");

    return {
      items: (data ?? []) as Store[],
      pagination: toPagination(query.page, query.limit, count ?? 0)
    };
  },

  async getStore(storeId: string): Promise<Store> {
    const { data, error } = await supabaseAdmin
      .from("stores")
      .select(storeSelect)
      .eq("id", storeId)
      .single();

    if (error) handleSupabaseError(error, "Failed to load store");
    return data as Store;
  },

  async createStore(actorId: string, body: CreateStoreBody): Promise<Store> {
    const { data, error } = await supabaseAdmin
      .from("stores")
      .insert({
        ...body,
        owner_id: actorId,
        status: "pending"
      })
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create store");
    return data as Store;
  },

  async updateStore(actorId: string, actorRole: UserRole, storeId: string, body: UpdateStoreBody): Promise<Store> {
    const ownerId = await getStoreOwner(storeId);
    assertOwnerOrAdmin(ownerId, actorId, actorRole);

    const { data, error } = await supabaseAdmin
      .from("stores")
      .update(body)
      .eq("id", storeId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update store");
    return data as Store;
  },

  async createProduct(actorId: string, actorRole: UserRole, body: CreateProductBody): Promise<Product> {
    const ownerId = await getStoreOwner(body.store_id);
    assertOwnerOrAdmin(ownerId, actorId, actorRole);

    const { data, error } = await supabaseAdmin
      .from("products")
      .insert(body)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create product");
    return data as Product;
  },

  async updateProduct(actorId: string, actorRole: UserRole, productId: string, body: UpdateProductBody): Promise<Product> {
    const { data: product, error: loadError } = await supabaseAdmin
      .from("products")
      .select("id,store_id,stores!inner(owner_id)")
      .eq("id", productId)
      .single();

    if (loadError) handleSupabaseError(loadError, "Failed to load product");
    const loaded = product as { store_id: string; stores: { owner_id: string } } | null;
    assertOwnerOrAdmin(requireRecord(loaded, "Product was not found").stores.owner_id, actorId, actorRole);

    const { data, error } = await supabaseAdmin
      .from("products")
      .update(body)
      .eq("id", productId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update product");
    return data as Product;
  },

  async deleteProduct(actorId: string, actorRole: UserRole, productId: string): Promise<void> {
    await this.updateProduct(actorId, actorRole, productId, { is_active: false });
  },

  async listVouchers(query: VoucherListQuery): Promise<Voucher[]> {
    let request = supabaseAdmin
      .from("vouchers")
      .select("*")
      .eq("is_active", true)
      .lte("starts_at", new Date().toISOString())
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (query.store_id) request = request.or(`store_id.eq.${query.store_id},store_id.is.null`);
    if (query.code) request = request.eq("code", query.code.toUpperCase());

    const { data, error } = await request;
    if (error) handleSupabaseError(error, "Failed to list vouchers");
    return (data ?? []) as Voucher[];
  },

  async createVoucher(actorId: string, actorRole: UserRole, body: CreateVoucherBody): Promise<Voucher> {
    if (body.store_id) {
      const ownerId = await getStoreOwner(body.store_id);
      assertOwnerOrAdmin(ownerId, actorId, actorRole);
    } else if (actorRole !== "admin") {
      assertOwnerOrAdmin("admin-only", actorId, actorRole);
    }

    const { data, error } = await supabaseAdmin
      .from("vouchers")
      .insert(body)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create voucher");
    return data as Voucher;
  }
};
