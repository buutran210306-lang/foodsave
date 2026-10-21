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
import type { FoodGroup, Product, Store, UserRole, Voucher } from "../types/domain";
import type { Coordinates } from "../utils/geoDistance";
import { distanceKmBetween, formatDistanceText, geoBoundingBox, isValidCoordinates, roundDistanceKm } from "../utils/geoDistance";
import { computeProductLabelState, foodGroupFromCategory } from "../utils/productExpiryLabel";
import { labelAutomationService } from "./labelAutomationService";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { assertOwnerOrAdmin, getRange, handleSupabaseError, requireRecord, supabaseAdmin, toPagination } from "./supabaseService";

const productSelect = "*, stores!inner(id,name,slug,owner_id,emoji,logo_url,address,district,city,latitude,longitude,rating,is_verified,is_open,opening_hours,opening_schedule,status)";
const storeSelect = "*";
const proximityCandidateLimit = 1000;

const queryLocation = (query: ProductListQuery | StoreListQuery): Coordinates | null => {
  const latitude = query.latitude ?? query.lat;
  const longitude = query.longitude ?? query.lng;
  const coordinates = { latitude, longitude };
  return isValidCoordinates(coordinates) ? coordinates : null;
};

const productDistance = (product: Product, userLocation: Coordinates): Product => {
  const store = product.stores;
  const storeLocation = {
    latitude: Number(store?.latitude),
    longitude: Number(store?.longitude)
  };

  if (!isValidCoordinates(storeLocation)) {
    return { ...product, distance_km: null, distance_text: null };
  }

  const rawDistanceKm = distanceKmBetween(userLocation, storeLocation);
  const distanceKm = roundDistanceKm(rawDistanceKm);
  const distanceText = formatDistanceText(rawDistanceKm);
  const productWithDistance = {
    ...product,
    distance_km: distanceKm,
    distance_text: distanceText
  };
  return store ? { ...productWithDistance, stores: { ...store, distance_km: distanceKm, distance_text: distanceText } } : productWithDistance;
};

const storeDistance = (store: Store, userLocation: Coordinates): Store => {
  const storeLocation = {
    latitude: Number(store.latitude),
    longitude: Number(store.longitude)
  };

  if (!isValidCoordinates(storeLocation)) return { ...store, distance_km: null, distance_text: null };
  const rawDistanceKm = distanceKmBetween(userLocation, storeLocation);
  const distanceKm = roundDistanceKm(rawDistanceKm);
  return {
    ...store,
    distance_km: distanceKm,
    distance_text: formatDistanceText(rawDistanceKm)
  };
};

interface ProductStore {
  id: string;
  owner_id: string;
  opening_schedule: unknown;
}

// Cửa hàng của người đăng: đối tác chỉ đăng cho cửa hàng mình sở hữu (stores.owner_id), không cần gửi store_id
const resolveProductStore = async (actorId: string, actorRole: UserRole, storeId?: string): Promise<ProductStore> => {
  let request = supabaseAdmin.from("stores").select("id,owner_id,opening_schedule");
  if (storeId) {
    request = request.eq("id", storeId);
  } else if (actorRole === "admin") {
    throw new AppError("store_id is required for admin", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  } else {
    request = request.eq("owner_id", actorId).order("created_at", { ascending: true });
  }

  const { data, error } = await request.limit(1).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load store");
  const store = data as ProductStore | null;
  if (!store) {
    throw new AppError("Chưa tìm thấy cửa hàng của tài khoản này", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }
  assertOwnerOrAdmin(store.owner_id, actorId, actorRole);
  return store;
};

const runLabelAutomationSafely = async (productIds: string[]): Promise<void> => {
  try {
    await labelAutomationService.run({ productIds });
  } catch (automationError) {
    logger.warn("Không chạy được tác vụ nhãn sau khi lưu sản phẩm", automationError);
  }
};

// Đổi giờ mở cửa thì tính lại nhãn của các sản phẩm đang bán
const refreshStoreProductLabels = async (storeId: string): Promise<void> => {
  const { data } = await supabaseAdmin.from("products").select("id").eq("store_id", storeId).eq("is_active", true);
  const productIds = (data ?? []).map((row) => (row as { id: string }).id);
  if (productIds.length > 0) await runLabelAutomationSafely(productIds);
};

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
    const nowIso = new Date().toISOString();
    const userLocation = queryLocation(query);
    let request = supabaseAdmin
      .from("products")
      .select(productSelect, { count: "exact" })
      .eq("is_active", true)
      .gt("stock_quantity", 0)
      .gte("expires_at", nowIso)
      .eq("stores.status", "active");

    if (query.search) {
      request = request.or(`name.ilike.%${query.search}%,description.ilike.%${query.search}%`);
    }
    if (query.category) request = request.eq("category", query.category);
    if (query.label) request = request.eq("label", query.label);
    if (query.store_id) request = request.eq("store_id", query.store_id);
    if (query.donation !== undefined) request = request.eq("is_donation", query.donation);
    if (query.min_price_cents !== undefined) request = request.gte("price_cents", query.min_price_cents);
    if (query.max_price_cents !== undefined) request = request.lte("price_cents", query.max_price_cents);

    if (userLocation) {
      const bounds = geoBoundingBox(userLocation, query.radius_km);
      request = request
        .not("stores.latitude", "is", null)
        .not("stores.longitude", "is", null)
        .gte("stores.latitude", bounds.minLatitude)
        .lte("stores.latitude", bounds.maxLatitude)
        .gte("stores.longitude", bounds.minLongitude)
        .lte("stores.longitude", bounds.maxLongitude)
        .range(0, proximityCandidateLimit - 1);
    } else {
      request = request.range(from, to);
    }

    if (query.sort === "urgent") request = request.order("expires_at", { ascending: true });
    if (query.sort === "discount") request = request.order("original_price_cents", { ascending: false });
    if (query.sort === "price_low") request = request.order("price_cents", { ascending: true });
    if (query.sort === "price_high") request = request.order("price_cents", { ascending: false });
    if (query.sort === "rating") request = request.order("rating", { ascending: false });
    if (query.sort === "newest" || (query.sort === "nearest" && !userLocation)) request = request.order("created_at", { ascending: false });

    const { data, error, count } = await request;
    if (error) handleSupabaseError(error, "Failed to list products");

    // Nhãn và giá do tác vụ định kỳ (labelAutomationService) cập nhật trong database
    const products = (data ?? []) as Product[];
    if (userLocation) {
      let nearbyProducts = products
        .map((product) => productDistance(product, userLocation))
        .filter((product) => product.distance_km !== null && product.distance_km !== undefined && product.distance_km <= query.radius_km);

      if (query.sort === "nearest") {
        nearbyProducts = nearbyProducts.sort((a, b) => (a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY));
      }

      return {
        items: nearbyProducts.slice(from, to + 1),
        pagination: toPagination(query.page, query.limit, nearbyProducts.length)
      };
    }

    return {
      items: products,
      pagination: toPagination(query.page, query.limit, count ?? 0)
    };
  },

  async getProduct(productId: string): Promise<Product> {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select(productSelect)
      .eq("id", productId)
      .eq("is_active", true)
      .gte("expires_at", new Date().toISOString())
      .single();

    if (error) handleSupabaseError(error, "Failed to load product");
    return data as Product;
  },

  async listStores(query: StoreListQuery): Promise<PaginatedResponse<Store>> {
    const { from, to } = getRange(query);
    const userLocation = queryLocation(query);
    let request = supabaseAdmin
      .from("stores")
      .select(storeSelect, { count: "exact" })
      .eq("status", "active");

    if (query.search) request = request.or(`name.ilike.%${query.search}%,address.ilike.%${query.search}%`);
    if (query.district) request = request.eq("district", query.district);
    if (query.verified !== undefined) request = request.eq("is_verified", query.verified);
    if (query.open !== undefined) request = request.eq("is_open", query.open);

    if (userLocation) {
      const bounds = geoBoundingBox(userLocation, query.radius_km);
      request = request
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .gte("latitude", bounds.minLatitude)
        .lte("latitude", bounds.maxLatitude)
        .gte("longitude", bounds.minLongitude)
        .lte("longitude", bounds.maxLongitude)
        .range(0, proximityCandidateLimit - 1);
    } else {
      request = request.range(from, to).order("rating", { ascending: false });
    }

    const { data, error, count } = await request;
    if (error) handleSupabaseError(error, "Failed to list stores");

    if (userLocation) {
      const nearbyStores = ((data ?? []) as Store[])
        .map((store) => storeDistance(store, userLocation))
        .filter((store) => store.distance_km !== null && store.distance_km !== undefined && store.distance_km <= query.radius_km)
        .sort((a, b) => (a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY));

      return {
        items: nearbyStores.slice(from, to + 1),
        pagination: toPagination(query.page, query.limit, nearbyStores.length)
      };
    }

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

    // Chỉ Admin được đổi trạng thái duyệt của cửa hàng
    const { status, ...ownerEditable } = body;
    const payload = actorRole === "admin" && status ? { ...ownerEditable, status } : ownerEditable;

    const { data, error } = await supabaseAdmin
      .from("stores")
      .update(payload)
      .eq("id", storeId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update store");
    if (payload.opening_schedule !== undefined) {
      await refreshStoreProductLabels(storeId);
    }
    return data as Store;
  },

  async createProduct(actorId: string, actorRole: UserRole, body: CreateProductBody): Promise<Product> {
    const store = await resolveProductStore(actorId, actorRole, body.store_id);
    const foodGroup: FoodGroup = body.food_group ?? foodGroupFromCategory(body.category);
    const imageUrls = body.image_urls ?? (body.image_url ? [body.image_url] : []);
    // Giá bán do hệ thống tính theo nhãn, không lấy giá từ trình duyệt
    const state = computeProductLabelState({
      expiresAt: body.expires_at,
      originalPriceVnd: body.original_price_cents,
      foodGroup,
      openingSchedule: store.opening_schedule
    });

    if (state.shouldStopSelling) {
      throw new AppError(
        "Sản phẩm còn dưới 1 giờ trước hạn sử dụng hoặc giờ đóng cửa, không thể đăng bán",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    const { store_id: _ignoredStoreId, price_cents: _ignoredPrice, label: _ignoredLabel, ...productFields } = body;
    const { data, error } = await supabaseAdmin
      .from("products")
      .insert({
        ...productFields,
        store_id: store.id,
        description: body.description?.trim() || body.name,
        food_group: foodGroup,
        image_urls: imageUrls,
        image_url: imageUrls[0] ?? null,
        label: state.label,
        price_cents: body.is_donation ? 0 : state.priceVnd,
        effective_deadline_at: state.deadline.toISOString(),
        label_changed_at: new Date().toISOString()
      })
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to create product");
    const created = data as Product;
    // Đăng lúc đã vàng/đỏ thì gửi thông báo và chia phần từ thiện ngay, không chờ lượt chạy định kỳ
    await runLabelAutomationSafely([created.id]);
    return created;
  },

  async updateProduct(actorId: string, actorRole: UserRole, productId: string, body: UpdateProductBody): Promise<Product> {
    const { data: product, error: loadError } = await supabaseAdmin
      .from("products")
      .select("id,store_id,expires_at,category,food_group,original_price_cents,is_donation,stores!inner(owner_id,opening_schedule)")
      .eq("id", productId)
      .single();

    if (loadError) handleSupabaseError(loadError, "Failed to load product");
    const loaded = requireRecord(
      product as {
        expires_at: string;
        category: string;
        food_group: FoodGroup | null;
        original_price_cents: number;
        is_donation: boolean;
        stores: { owner_id: string; opening_schedule: unknown };
      } | null,
      "Product was not found"
    );
    assertOwnerOrAdmin(loaded.stores.owner_id, actorId, actorRole);

    const { price_cents: _ignoredPrice, label: _ignoredLabel, ...productFields } = body;
    const update: Record<string, unknown> = { ...productFields };
    if (body.image_urls) update.image_url = body.image_urls[0] ?? null;
    if (body.category && !body.food_group) update.food_group = foodGroupFromCategory(body.category);

    const pricingChanged = body.expires_at !== undefined || body.original_price_cents !== undefined ||
      body.food_group !== undefined || body.category !== undefined || body.is_donation !== undefined;
    if (pricingChanged) {
      const foodGroup = (update.food_group as FoodGroup | undefined) ?? loaded.food_group ?? foodGroupFromCategory(loaded.category);
      const state = computeProductLabelState({
        expiresAt: body.expires_at ?? loaded.expires_at,
        originalPriceVnd: body.original_price_cents ?? loaded.original_price_cents,
        foodGroup,
        openingSchedule: loaded.stores.opening_schedule
      });
      update.label = state.label;
      update.price_cents = (body.is_donation ?? loaded.is_donation) ? 0 : state.priceVnd;
      update.effective_deadline_at = state.deadline.toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from("products")
      .update(update)
      .eq("id", productId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update product");
    if (pricingChanged) await runLabelAutomationSafely([productId]);
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
