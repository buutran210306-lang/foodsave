import type {
  CharityEcoImpactQuery,
  EcoImpactLeaderboardQuery,
  EcoImpactSummaryQuery,
  PartnerEcoImpactQuery
} from "../schemas/ecoImpactSchemas";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type {
  EcoImpactBadge,
  EcoImpactEvent,
  EcoImpactLeaderboardEntry,
  EcoImpactMonthlyPoint,
  EcoImpactSummary,
  EcoImpactTotals
} from "../types/ecoImpact";
import type { UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { handleSupabaseError, requireRecord, supabaseAdmin } from "./supabaseService";

interface ImpactFactors {
  co2KgPerFoodKg: number;
  waterLitersPerFoodKg: number;
  foodKgPerMeal: number;
}

interface ImpactEventPayload {
  actor_id: string | null;
  store_id: string | null;
  charity_id: string | null;
  source_type: "order" | "donation" | "manual_adjustment";
  source_id: string;
  occurred_at: string;
  food_saved_kg: number;
  co2_avoided_kg: number;
  water_saved_liters: number;
  meals_equivalent: number;
  money_saved_cents: number;
  calculation_method: string;
  metadata: Record<string, unknown>;
}

interface OrderImpactItem {
  id: string;
  product_id: string;
  product_name: string;
  unit_price_cents: number;
  original_unit_price_cents: number;
  quantity: number;
  product_metadata: Record<string, unknown> | null;
}

interface OrderForImpact {
  id: string;
  order_number: string;
  customer_id: string;
  store_id: string;
  status: string;
  discount_cents: number;
  completed_at: string | null;
  order_items: OrderImpactItem[];
}

interface DonationForImpact {
  id: string;
  donation_code: string;
  store_id: string;
  charity_id: string | null;
  status: string;
  items: string;
  amount_text: string;
  weight_kg: number;
  completed_at: string | null;
}

interface EventScope {
  actorId?: string;
  storeIds?: string[];
  charityIds?: string[];
}

interface DateRange {
  from?: string;
  to: string;
}

const DEFAULT_FACTORS: ImpactFactors = {
  co2KgPerFoodKg: 2.5,
  waterLitersPerFoodKg: 890,
  foodKgPerMeal: 0.35
};

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

const categoryWeightKg: Record<string, number> = {
  bakery: 0.25,
  bread: 0.25,
  cake: 0.2,
  dessert: 0.18,
  rice: 0.45,
  meal: 0.45,
  restaurant: 0.45,
  prepared: 0.45,
  vegetable: 0.3,
  vegetables: 0.3,
  produce: 0.3,
  fruit: 0.25,
  fruits: 0.25,
  dairy: 0.25,
  milk: 0.25,
  meat: 0.35,
  seafood: 0.35,
  drink: 0.35,
  beverage: 0.35
};

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const readNumber = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
};

const monthKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const monthLabel = (key: string): string => {
  const [year, month] = key.split("-");
  return `${month}/${year}`;
};

const startOfMonth = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));

const startOfYear = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0));

const addMonths = (date: Date, amount: number): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1, 0, 0, 0, 0));

const buildRange = (query: EcoImpactSummaryQuery): DateRange => {
  const now = new Date();
  const to = query.date_to ?? now.toISOString();
  if (query.date_from) return { from: query.date_from, to };
  if (query.period === "month") return { from: startOfMonth(now).toISOString(), to };
  if (query.period === "year") return { from: startOfYear(now).toISOString(), to };
  return { to };
};

const buildSeriesKeys = (months: number): string[] => {
  const current = startOfMonth(new Date());
  return Array.from({ length: months }, (_value, index) => monthKey(addMonths(current, index - months + 1)));
};

const earliestSeriesDate = (months: number): string => {
  const current = startOfMonth(new Date());
  return addMonths(current, 1 - months).toISOString();
};

const isWithinRange = (event: EcoImpactEvent, range: DateRange): boolean => {
  const time = new Date(event.occurred_at).getTime();
  const afterFrom = range.from ? time >= new Date(range.from).getTime() : true;
  return afterFrom && time <= new Date(range.to).getTime();
};

const calculateDerivedImpact = (foodSavedKg: number, factors: ImpactFactors) => ({
  co2_avoided_kg: round(foodSavedKg * factors.co2KgPerFoodKg, 3),
  water_saved_liters: round(foodSavedKg * factors.waterLitersPerFoodKg, 2),
  meals_equivalent: Math.round(foodSavedKg / factors.foodKgPerMeal)
});

const fallbackWeightForCategory = (category: unknown): number => {
  const key = String(category || "").trim().toLowerCase();
  return categoryWeightKg[key] ?? DEFAULT_FACTORS.foodKgPerMeal;
};

const emptyTotals = (): EcoImpactTotals => ({
  food_saved_kg: 0,
  co2_avoided_kg: 0,
  water_saved_liters: 0,
  meals_equivalent: 0,
  money_saved_cents: 0,
  completed_orders: 0,
  completed_donations: 0,
  events_count: 0
});

const addEventToTotals = (totals: EcoImpactTotals, event: EcoImpactEvent): void => {
  totals.food_saved_kg += Number(event.food_saved_kg) || 0;
  totals.co2_avoided_kg += Number(event.co2_avoided_kg) || 0;
  totals.water_saved_liters += Number(event.water_saved_liters) || 0;
  totals.meals_equivalent += Number(event.meals_equivalent) || 0;
  totals.money_saved_cents += Number(event.money_saved_cents) || 0;
  totals.completed_orders += event.source_type === "order" ? 1 : 0;
  totals.completed_donations += event.source_type === "donation" ? 1 : 0;
  totals.events_count += 1;
};

const normalizeTotals = (totals: EcoImpactTotals): EcoImpactTotals => ({
  ...totals,
  food_saved_kg: round(totals.food_saved_kg, 2),
  co2_avoided_kg: round(totals.co2_avoided_kg, 2),
  water_saved_liters: round(totals.water_saved_liters, 2),
  meals_equivalent: Math.round(totals.meals_equivalent),
  money_saved_cents: Math.round(totals.money_saved_cents)
});

const buildBadges = (totals: EcoImpactTotals): EcoImpactBadge[] => {
  const foodSavedKg = totals.food_saved_kg;
  const orderCount = totals.completed_orders;
  return [
    { id: "food-5", name: "Mầm xanh", description: "Cứu 5kg thực phẩm", threshold: 5, progress: round(foodSavedKg, 2), earned: foodSavedKg >= 5 },
    { id: "food-25", name: "Người giải cứu", description: "Cứu 25kg thực phẩm", threshold: 25, progress: round(foodSavedKg, 2), earned: foodSavedKg >= 25 },
    { id: "food-100", name: "Đại sứ xanh", description: "Cứu 100kg thực phẩm", threshold: 100, progress: round(foodSavedKg, 2), earned: foodSavedKg >= 100 },
    { id: "orders-10", name: "Nhịp đều", description: "Hoàn thành 10 đơn cứu thực phẩm", threshold: 10, progress: orderCount, earned: orderCount >= 10 }
  ];
};

const buildMonthlySeries = (events: EcoImpactEvent[], months: number): EcoImpactMonthlyPoint[] => {
  const keys = buildSeriesKeys(months);
  const buckets = new Map<string, EcoImpactTotals>(keys.map((key) => [key, emptyTotals()]));

  for (const event of events) {
    const key = monthKey(new Date(event.occurred_at));
    const bucket = buckets.get(key);
    if (bucket) addEventToTotals(bucket, event);
  }

  return keys.map((key) => {
    const totals = normalizeTotals(buckets.get(key) ?? emptyTotals());
    return {
      month: key,
      label: monthLabel(key),
      food_saved_kg: totals.food_saved_kg,
      co2_avoided_kg: totals.co2_avoided_kg,
      water_saved_liters: totals.water_saved_liters,
      meals_equivalent: totals.meals_equivalent,
      money_saved_cents: totals.money_saved_cents
    };
  });
};

const buildGoal = (monthlyEvents: EcoImpactEvent[], targetKg: number): EcoImpactSummary["goal"] => {
  const current = round(monthlyEvents.reduce((sum, event) => sum + (Number(event.food_saved_kg) || 0), 0), 2);
  return {
    target_kg: targetKg,
    current_kg: current,
    percent: targetKg > 0 ? Math.min(100, round((current / targetKg) * 100, 1)) : 0,
    remaining_kg: Math.max(0, round(targetKg - current, 2))
  };
};

const buildSummary = (
  scope: EcoImpactSummary["scope"],
  query: EcoImpactSummaryQuery,
  events: EcoImpactEvent[],
  goalTargetKg: number
): EcoImpactSummary => {
  const range = buildRange(query);
  const periodEvents = events.filter((event) => isWithinRange(event, range));
  const totals = normalizeTotals(periodEvents.reduce((acc, event) => {
    addEventToTotals(acc, event);
    return acc;
  }, emptyTotals()));
  const currentMonthRange = { from: startOfMonth(new Date()).toISOString(), to: new Date().toISOString() };
  const monthlyEvents = events.filter((event) => isWithinRange(event, currentMonthRange));

  return {
    scope,
    period: query.period,
    totals,
    monthly_series: buildMonthlySeries(events, query.months),
    badges: buildBadges(totals),
    goal: buildGoal(monthlyEvents, goalTargetKg),
    generated_at: new Date().toISOString()
  };
};

const queryEvents = async (scope: EventScope, from: string | undefined, to: string): Promise<EcoImpactEvent[]> => {
  if (scope.storeIds && scope.storeIds.length === 0) return [];
  if (scope.charityIds && scope.charityIds.length === 0) return [];

  let request = supabaseAdmin
    .from("eco_impact_events")
    .select("*")
    .lte("occurred_at", to)
    .order("occurred_at", { ascending: false });

  if (from) request = request.gte("occurred_at", from);
  if (scope.actorId) request = request.eq("actor_id", scope.actorId);
  if (scope.storeIds) request = request.in("store_id", scope.storeIds.length > 0 ? scope.storeIds : [EMPTY_UUID]);
  if (scope.charityIds) request = request.in("charity_id", scope.charityIds.length > 0 ? scope.charityIds : [EMPTY_UUID]);

  const { data, error } = await request;
  if (error) handleSupabaseError(error, "Failed to load eco impact events");
  return (data ?? []) as EcoImpactEvent[];
};

const loadEventsForSummary = async (scope: EventScope, query: EcoImpactSummaryQuery): Promise<EcoImpactEvent[]> => {
  const range = buildRange(query);
  const seriesFrom = earliestSeriesDate(query.months);
  const from = range.from && new Date(range.from).getTime() < new Date(seriesFrom).getTime() ? range.from : seriesFrom;
  return queryEvents(scope, from, range.to);
};

const getOwnedStoreIds = async (ownerId: string): Promise<string[]> => {
  const { data, error } = await supabaseAdmin.from("stores").select("id").eq("owner_id", ownerId);
  if (error) handleSupabaseError(error, "Failed to load stores");
  return (data ?? []).map((store) => (store as { id: string }).id);
};

const getOwnedCharityIds = async (ownerId: string): Promise<string[]> => {
  const { data, error } = await supabaseAdmin.from("charity_profiles").select("id").eq("owner_id", ownerId);
  if (error) handleSupabaseError(error, "Failed to load charity profiles");
  return (data ?? []).map((charity) => (charity as { id: string }).id);
};

const assertScopedId = (candidateId: string | undefined, allowedIds: string[], message: string): string[] => {
  if (!candidateId) return allowedIds;
  if (!allowedIds.includes(candidateId)) {
    throw new AppError(message, HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
  return [candidateId];
};

const loadImpactFactors = async (): Promise<ImpactFactors> => {
  const { data, error } = await supabaseAdmin
    .from("eco_impact_factors")
    .select("co2_kg_per_food_kg,water_liters_per_food_kg,food_kg_per_meal")
    .eq("id", "default")
    .single();

  if (error || !data) return DEFAULT_FACTORS;
  const factors = data as { co2_kg_per_food_kg: number; water_liters_per_food_kg: number; food_kg_per_meal: number };
  return {
    co2KgPerFoodKg: Number(factors.co2_kg_per_food_kg) || DEFAULT_FACTORS.co2KgPerFoodKg,
    waterLitersPerFoodKg: Number(factors.water_liters_per_food_kg) || DEFAULT_FACTORS.waterLitersPerFoodKg,
    foodKgPerMeal: Number(factors.food_kg_per_meal) || DEFAULT_FACTORS.foodKgPerMeal
  };
};

const insertImpactEvent = async (payload: ImpactEventPayload): Promise<EcoImpactEvent> => {
  const { error } = await supabaseAdmin
    .from("eco_impact_events")
    .upsert(payload, { onConflict: "source_type,source_id", ignoreDuplicates: true });

  if (error) handleSupabaseError(error, "Failed to record eco impact event");

  const { data, error: loadError } = await supabaseAdmin
    .from("eco_impact_events")
    .select("*")
    .eq("source_type", payload.source_type)
    .eq("source_id", payload.source_id)
    .single();

  if (loadError) handleSupabaseError(loadError, "Failed to load recorded eco impact event");
  return requireRecord(data as EcoImpactEvent | null, "Eco impact event was not found");
};

const calculateOrderFoodKg = (items: OrderImpactItem[]): { foodSavedKg: number; method: string } => {
  let usedProductWeights = true;
  const foodSavedKg = items.reduce((sum, item) => {
    const metadata = item.product_metadata ?? {};
    const snapshotWeight = readNumber(metadata.estimated_weight_kg);
    if (snapshotWeight) return sum + snapshotWeight * item.quantity;
    usedProductWeights = false;
    return sum + fallbackWeightForCategory(metadata.category) * item.quantity;
  }, 0);

  return {
    foodSavedKg: round(foodSavedKg, 3),
    method: usedProductWeights ? "product_weight" : "category_estimate"
  };
};

const calculateOrderSavings = (order: OrderForImpact): number => {
  const itemSavings = order.order_items.reduce((sum, item) => {
    const unitSavings = Math.max(0, item.original_unit_price_cents - item.unit_price_cents);
    return sum + unitSavings * item.quantity;
  }, 0);
  return Math.max(0, itemSavings + (Number(order.discount_cents) || 0));
};

export const ecoImpactService = {
  async recordOrderImpact(orderId: string): Promise<EcoImpactEvent | null> {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id,order_number,customer_id,store_id,status,discount_cents,completed_at,order_items(*)")
      .eq("id", orderId)
      .single();

    if (error) handleSupabaseError(error, "Failed to load order for eco impact");
    const order = requireRecord(data as OrderForImpact | null, "Order was not found");
    if (order.status !== "completed") return null;

    const factors = await loadImpactFactors();
    const { foodSavedKg, method } = calculateOrderFoodKg(order.order_items ?? []);
    const derived = calculateDerivedImpact(foodSavedKg, factors);

    return insertImpactEvent({
      actor_id: order.customer_id,
      store_id: order.store_id,
      charity_id: null,
      source_type: "order",
      source_id: order.id,
      occurred_at: order.completed_at ?? new Date().toISOString(),
      food_saved_kg: foodSavedKg,
      co2_avoided_kg: derived.co2_avoided_kg,
      water_saved_liters: derived.water_saved_liters,
      meals_equivalent: derived.meals_equivalent,
      money_saved_cents: calculateOrderSavings(order),
      calculation_method: method,
      metadata: {
        order_number: order.order_number,
        items_count: order.order_items.length,
        factors
      }
    });
  },

  async recordDonationImpact(donationId: string): Promise<EcoImpactEvent | null> {
    const { data, error } = await supabaseAdmin
      .from("donations")
      .select("id,donation_code,store_id,charity_id,status,items,amount_text,weight_kg,completed_at")
      .eq("id", donationId)
      .single();

    if (error) handleSupabaseError(error, "Failed to load donation for eco impact");
    const donation = requireRecord(data as DonationForImpact | null, "Donation was not found");
    if (donation.status !== "completed") return null;

    const factors = await loadImpactFactors();
    const foodSavedKg = round(Number(donation.weight_kg) || 0, 3);
    const derived = calculateDerivedImpact(foodSavedKg, factors);

    return insertImpactEvent({
      actor_id: null,
      store_id: donation.store_id,
      charity_id: donation.charity_id,
      source_type: "donation",
      source_id: donation.id,
      occurred_at: donation.completed_at ?? new Date().toISOString(),
      food_saved_kg: foodSavedKg,
      co2_avoided_kg: derived.co2_avoided_kg,
      water_saved_liters: derived.water_saved_liters,
      meals_equivalent: derived.meals_equivalent,
      money_saved_cents: 0,
      calculation_method: "donation_weight",
      metadata: {
        donation_code: donation.donation_code,
        items: donation.items,
        amount_text: donation.amount_text,
        factors
      }
    });
  },

  async getMyImpact(actorId: string, query: EcoImpactSummaryQuery): Promise<EcoImpactSummary> {
    const events = await loadEventsForSummary({ actorId }, query);
    return buildSummary("me", query, events, 10);
  },

  async getPartnerImpact(actorId: string, actorRole: UserRole, query: PartnerEcoImpactQuery): Promise<EcoImpactSummary> {
    const storeIds = actorRole === "admin"
      ? query.store_id ? [query.store_id] : undefined
      : assertScopedId(query.store_id, await getOwnedStoreIds(actorId), "You do not own this store");
    const scope: EventScope = storeIds ? { storeIds } : {};
    const events = await loadEventsForSummary(scope, query);
    return buildSummary("partner", query, events, 250);
  },

  async getCharityImpact(actorId: string, actorRole: UserRole, query: CharityEcoImpactQuery): Promise<EcoImpactSummary> {
    const charityIds = actorRole === "admin"
      ? query.charity_id ? [query.charity_id] : undefined
      : assertScopedId(query.charity_id, await getOwnedCharityIds(actorId), "You do not own this charity profile");
    const scope: EventScope = charityIds ? { charityIds } : {};
    const events = await loadEventsForSummary(scope, query);
    return buildSummary("charity", query, events, 250);
  },

  async getPlatformImpact(query: EcoImpactSummaryQuery): Promise<EcoImpactSummary> {
    const events = await loadEventsForSummary({}, query);
    return buildSummary("platform", query, events, 5000);
  },

  async getLeaderboard(query: EcoImpactLeaderboardQuery): Promise<EcoImpactLeaderboardEntry[]> {
    const now = new Date();
    const from = query.period === "week"
      ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      : query.period === "month"
        ? startOfMonth(now).toISOString()
        : undefined;
    const events = await queryEvents({}, from, now.toISOString());
    const totalsByActor = new Map<string, EcoImpactTotals>();

    for (const event of events) {
      if (!event.actor_id) continue;
      const totals = totalsByActor.get(event.actor_id) ?? emptyTotals();
      addEventToTotals(totals, event);
      totalsByActor.set(event.actor_id, totals);
    }

    const actorIds = Array.from(totalsByActor.keys());
    if (actorIds.length === 0) return [];

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id,full_name,avatar_url")
      .in("id", actorIds);
    if (error) handleSupabaseError(error, "Failed to load leaderboard profiles");

    const profiles = new Map((data ?? []).map((profile) => {
      const typed = profile as { id: string; full_name: string | null; avatar_url: string | null };
      return [typed.id, typed];
    }));

    return Array.from(totalsByActor.entries())
      .map(([actorId, rawTotals]) => {
        const totals = normalizeTotals(rawTotals);
        const profile = profiles.get(actorId);
        return {
          rank: 0,
          actor_id: actorId,
          display_name: profile?.full_name ?? "Người dùng FoodSave",
          avatar_url: profile?.avatar_url ?? null,
          food_saved_kg: totals.food_saved_kg,
          co2_avoided_kg: totals.co2_avoided_kg,
          meals_equivalent: totals.meals_equivalent
        };
      })
      .sort((a, b) => b.food_saved_kg - a.food_saved_kg)
      .slice(0, query.limit)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }
};
