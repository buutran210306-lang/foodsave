export type SellerReputationStatus = "Active" | "Restricted" | "Banned";

export type SellerViolationType = "SELLER_CANCELLED_ORDER" | "MANUAL_REPUTATION_ADJUSTMENT" | "LOW_RATING_RESTRICTION";

export interface SellerReputation {
  seller_id: string;
  trust_score: number;
  rating_avg: number;
  status: SellerReputationStatus;
  restricted_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface SellerViolation {
  id: string;
  seller_id: string;
  order_id: string | null;
  violation_type: SellerViolationType;
  reason: string;
  point_delta: number;
  trust_score_before: number;
  trust_score_after: number;
  rating_avg_snapshot: number;
  status_after: SellerReputationStatus;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface StoreStatusChangedPayload {
  sellerId: string;
  status: SellerReputationStatus;
  trustScore: number;
  ratingAverage: number;
  restrictedUntil: string | null;
  reason: string;
  message: string;
  emittedAt: string;
}
