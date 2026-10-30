export type UserRole = "customer" | "partner" | "charity" | "admin";
export type ProfileStatus = "active" | "pending" | "suspended" | "rejected";
export type ProductLabel = "green" | "yellow" | "red";
export type FoodGroup = "cooked" | "fresh" | "packaged";
export type OrderStatus = "awaiting_payment" | "pending" | "confirmed" | "ready" | "completed" | "cancelled" | "no_show";
export type SettlementStatus = "none" | "held" | "released" | "forfeited" | "refunded" | "partially_refunded";
export type OrderCancelledBy = "customer" | "store" | "system" | "admin";
export type PaymentMethod = "momo" | "zalopay" | "vnpay" | "card" | "vietqr" | "cash";
export type PaymentStatus = "pending" | "paid" | "refunded" | "failed";
export type ComplaintPriority = "low" | "medium" | "high";
export type ComplaintStatus = "open" | "in_review" | "resolved" | "rejected";
export type DonationUrgency = "green" | "yellow" | "red";
export type DonationStatus = "open" | "accepted" | "in_route" | "completed" | "rejected" | "cancelled";
export type VolunteerStatus = "new" | "active" | "inactive";
export type ReportStatus = "draft" | "in_progress" | "published";

export interface Profile {
  id: string;
  role: UserRole;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  points: number;
  rank: string;
  /** Khóa mua hàng nhãn đỏ đến thời điểm này (null = không khóa) */
  red_ban_until?: string | null;
  status: ProfileStatus;
  auth_provider: string;
  last_login_at: string | null;
  terms_accepted_at: string | null;
  marketing_opt_in: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Store {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  emoji: string | null;
  address: string;
  district: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  distance_km?: number | null;
  distance_text?: string | null;
  rating: number;
  commission_rate: number;
  service_tier: string;
  is_verified: boolean;
  is_open: boolean;
  opening_hours: string | null;
  opening_schedule?: unknown;
  charity_transfer_enabled?: boolean;
  status: ProfileStatus;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  store_id: string;
  name: string;
  description: string;
  image_url: string | null;
  emoji: string | null;
  category: string;
  food_group: FoodGroup;
  image_urls: string[];
  metadata: Record<string, unknown>;
  effective_deadline_at: string | null;
  label_changed_at: string | null;
  yellow_notified_at: string | null;
  red_notified_at: string | null;
  red_last_notified_at: string | null;
  red_reminder_count: number;
  price_cents: number;
  original_price_cents: number;
  label: ProductLabel;
  expires_at: string;
  stock_quantity: number;
  rating: number;
  sold_count: number;
  estimated_weight_kg: number | null;
  servings_count: number | null;
  is_donation: boolean;
  is_active: boolean;
  blocked_reason: string | null;
  created_at: string;
  updated_at: string;
  distance_km?: number | null;
  distance_text?: string | null;
  stores?: Store;
}

export interface Voucher {
  id: string;
  store_id: string | null;
  code: string;
  name: string;
  description: string;
  percent_off: number | null;
  fixed_discount_cents: number | null;
  min_order_cents: number;
  starts_at: string;
  expires_at: string;
  max_redemptions: number | null;
  redemption_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Order {
  receiver_name?: string | null;
  receiver_phone?: string | null;
  receiver_email?: string | null;
  id: string;
  order_number: string;
  customer_id: string;
  store_id: string;
  status: OrderStatus;
  pickup_slot_key: string;
  pickup_window: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal_cents: number;
  discount_cents: number;
  platform_fee_cents: number;
  donation_cents: number;
  total_cents: number;
  voucher_code: string | null;
  qr_code: string;
  customer_note: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Quy trình trả trước (SQL 029). Đơn cũ có thể là null.
  pay_deadline?: string | null;
  paid_at?: string | null;
  pickup_deadline?: string | null;
  cancel_free_until?: string | null;
  policy_label?: ProductLabel | null;
  no_show_at?: string | null;
  cancel_reason?: string | null;
  cancelled_by?: OrderCancelledBy | null;
  reminder_mid_sent_at?: string | null;
  reminder_final_sent_at?: string | null;
  settlement_status?: SettlementStatus;
  complaint_deadline_at?: string | null;
  stock_restored_at?: string | null;
  ledger_synced_status?: string | null;
  // Nhà cung cấp thanh toán và mã tham chiếu của họ (SQL 034)
  payment_provider?: string | null;
  payment_ref?: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  unit_price_cents: number;
  original_unit_price_cents: number;
  quantity: number;
  product_metadata: Record<string, unknown>;
  created_at: string;
}

export interface Donation {
  id: string;
  donation_code: string;
  store_id: string;
  charity_id: string | null;
  assigned_volunteer_id: string | null;
  items: string;
  amount_text: string;
  weight_kg: number;
  expires_at: string;
  pickup_start: string;
  pickup_end: string;
  urgency: DonationUrgency;
  status: DonationStatus;
  note: string | null;
  distance_text: string | null;
  product_id: string | null;
  quantity: number | null;
  is_auto: boolean;
  offer_expires_at: string | null;
  store_confirmed_at: string | null;
  volunteer_assigned_at: string | null;
  packed_at: string | null;
  pickup_code: string | null;
  proof_photo_urls: string[];
  proof_note: string | null;
  proof_submitted_at: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  recipient_id: string | null;
  role_target: UserRole | null;
  type: string;
  title: string;
  body: string;
  related_type: string | null;
  related_id: string | null;
  read_at: string | null;
  created_at: string;
}
