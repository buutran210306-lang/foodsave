/**
 * Hằng số ước lượng di chuyển dùng chung cho `match_candidates` (SQL, `private.travel_min`), engine ghép đơn
 * và engine tuyến (DATA-MODEL §4.7, ADR-007 §5). Giá trị gốc nằm ở `app_settings`; server đọc rồi truyền vào
 * qua `travelConfigFrom`. Đổi mặc định ⇒ sửa đồng thời `supabase/seed/00_reference.sql` (có test chống lệch).
 */

export interface TravelConfig {
  /** Hệ số đường vòng: quãng đường thật ≈ đường chim bay × hệ số (`matching_detour_factor`). */
  detourFactor: number;
  /** Tốc độ xe máy trung bình trong phố, km/h (`matching_speed_kmh`). */
  speedKmh: number;
  /** Thời gian đệm mỗi lần tới một điểm (gửi xe, tìm cửa hàng, bàn giao), phút (`matching_buffer_minutes`). */
  bufferMinutes: number;
}

export const DEFAULT_TRAVEL_CONFIG: Readonly<TravelConfig> = Object.freeze({
  detourFactor: 1.4,
  speedKmh: 18,
  bufferMinutes: 10,
});

/** Khóa `app_settings` tương ứng từng trường của `TravelConfig`. */
export const TRAVEL_SETTING_KEYS = {
  detourFactor: "matching_detour_factor",
  speedKmh: "matching_speed_kmh",
  bufferMinutes: "matching_buffer_minutes",
} as const satisfies Record<keyof TravelConfig, string>;

/** Số điểm lấy tối đa còn duyệt mọi hoán vị (5! = 120); nhiều hơn ⇒ láng giềng gần nhất + 2-opt. */
export const MAX_EXACT_STOPS = 5;

const VALID: Record<keyof TravelConfig, (n: number) => boolean> = {
  detourFactor: (n) => n >= 1,
  speedKmh: (n) => n > 0,
  bufferMinutes: (n) => n >= 0,
};

function settingNum(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

/**
 * Dựng cấu hình từ các dòng `app_settings` (`{ key: value }`, value là số hoặc chuỗi số). Thiếu hoặc sai
 * ⇒ dùng mặc định của trường đó (giống `private.setting_num(key, default)`).
 */
export function travelConfigFrom(
  settings: Readonly<Record<string, unknown>> | null | undefined,
): TravelConfig {
  const s = settings ?? {};
  const pick = (field: keyof TravelConfig): number => {
    const n = settingNum(s[TRAVEL_SETTING_KEYS[field]]);
    return Number.isFinite(n) && VALID[field](n) ? n : DEFAULT_TRAVEL_CONFIG[field];
  };
  return {
    detourFactor: pick("detourFactor"),
    speedKmh: pick("speedKmh"),
    bufferMinutes: pick("bufferMinutes"),
  };
}

/** Kiểm cấu hình do người gọi truyền vào; sai ⇒ `RangeError`. */
export function assertTravelConfig(config: TravelConfig): TravelConfig {
  for (const field of Object.keys(VALID) as (keyof TravelConfig)[]) {
    const n = config[field];
    if (!Number.isFinite(n) || !VALID[field](n)) throw new RangeError("Cấu hình di chuyển không hợp lệ");
  }
  return config;
}
