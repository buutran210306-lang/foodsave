import type { EcoImpactSourceType } from "../schemas/ecoImpactSchemas";

export interface EcoImpactEvent {
  id: string;
  actor_id: string | null;
  store_id: string | null;
  charity_id: string | null;
  source_type: EcoImpactSourceType;
  source_id: string;
  occurred_at: string;
  food_saved_kg: number;
  co2_avoided_kg: number;
  water_saved_liters: number;
  meals_equivalent: number;
  money_saved_cents: number;
  calculation_method: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EcoImpactTotals {
  food_saved_kg: number;
  co2_avoided_kg: number;
  water_saved_liters: number;
  meals_equivalent: number;
  money_saved_cents: number;
  completed_orders: number;
  completed_donations: number;
  events_count: number;
}

export interface EcoImpactMonthlyPoint {
  month: string;
  label: string;
  food_saved_kg: number;
  co2_avoided_kg: number;
  water_saved_liters: number;
  meals_equivalent: number;
  money_saved_cents: number;
}

export interface EcoImpactBadge {
  id: string;
  name: string;
  description: string;
  threshold: number;
  progress: number;
  earned: boolean;
}

export interface EcoImpactGoal {
  target_kg: number;
  current_kg: number;
  percent: number;
  remaining_kg: number;
}

export interface EcoImpactSummary {
  scope: "me" | "partner" | "charity" | "platform";
  period: string;
  totals: EcoImpactTotals;
  monthly_series: EcoImpactMonthlyPoint[];
  badges: EcoImpactBadge[];
  goal: EcoImpactGoal;
  generated_at: string;
}

export interface EcoImpactLeaderboardEntry {
  rank: number;
  actor_id: string;
  display_name: string;
  avatar_url: string | null;
  food_saved_kg: number;
  co2_avoided_kg: number;
  meals_equivalent: number;
}
