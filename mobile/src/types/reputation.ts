export type SellerReputationStatus = "Active" | "Restricted" | "Banned";

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

export interface SellerDashboardStatus {
  status: SellerReputationStatus;
  trustScore: number;
  ratingAverage: number;
  restrictedUntil: string | null;
  message: string;
}
