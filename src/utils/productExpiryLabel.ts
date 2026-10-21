import type { FoodGroup, ProductLabel } from "../types/domain";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Ngưỡng nhãn theo nhóm hàng (giờ còn lại tính đến mốc đến trước: hết hạn hoặc cửa hàng đóng cửa)
export const PRODUCT_LABEL_THRESHOLDS: Record<FoodGroup, { redHours: number; yellowHours: number }> = {
  cooked: { redHours: 4, yellowHours: 12 },
  fresh: { redHours: 24, yellowHours: 72 },
  packaged: { redHours: 72, yellowHours: 168 }
};

// Còn dưới 1 giờ thì ngừng nhận đặt và gỡ khỏi hệ thống
export const STOP_SELLING_HOURS = 1;

// Giá cố định theo nhãn: tỷ lệ giảm so với giá gốc
export const LABEL_DISCOUNT_RATE: Record<ProductLabel, number> = {
  green: 0.2,
  yellow: 0.5,
  red: 0.8
};

// Xét nhóm "đóng gói" trước để "bánh kẹo", "bánh quy đóng gói" không bị xếp nhầm vào đồ nấu chín
const CATEGORY_GROUPS: Array<{ group: FoodGroup; keywords: string[] }> = [
  { group: "packaged", keywords: ["đóng gói", "đồ khô", "đóng chai", "đóng hộp", "snack", "bánh kẹo", "bánh quy", "gia vị", "mì gói", "packaged"] },
  { group: "cooked", keywords: ["bữa ăn", "cơm", "nấu chín", "bánh mì", "bánh tươi", "bánh ngọt", "bánh", "món", "đồ ăn", "bakery", "meal"] },
  { group: "fresh", keywords: ["tươi sống", "rau", "củ", "trái cây", "hoa quả", "thịt", "cá", "hải sản", "sữa", "trứng", "fresh"] }
];

export const FOOD_GROUPS: FoodGroup[] = ["cooked", "fresh", "packaged"];

export const isFoodGroup = (value: unknown): value is FoodGroup => {
  return typeof value === "string" && (FOOD_GROUPS as string[]).includes(value);
};

// Suy ra nhóm hàng từ tên danh mục khi frontend không gửi food_group
export const foodGroupFromCategory = (category: string | null | undefined): FoodGroup => {
  const normalized = String(category || "").trim().toLowerCase();
  for (const { group, keywords } of CATEGORY_GROUPS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return group;
  }
  return "fresh";
};

export const priceForLabel = (originalPriceVnd: number, label: ProductLabel): number => {
  const raw = Math.max(0, originalPriceVnd) * (1 - LABEL_DISCOUNT_RATE[label]);
  // Làm tròn tới 1.000đ cho dễ thanh toán; giá gốc nhỏ hơn 1.000đ thì giữ nguyên số lẻ
  return originalPriceVnd >= 1000 ? Math.round(raw / 1000) * 1000 : Math.round(raw);
};

// ===== Giờ mở cửa =====
// Lịch lưu theo giờ Việt Nam (UTC+7, không có giờ mùa hè)
const VN_OFFSET_MS = 7 * HOUR_MS;

export interface OpeningScheduleItem {
  day?: string | number;
  open?: boolean;
  from?: string;
  to?: string;
}

const DAY_ALIASES: Record<string, number> = {
  "chủ nhật": 0, "cn": 0, "sunday": 0, "sun": 0,
  "thứ 2": 1, "thứ hai": 1, "t2": 1, "monday": 1, "mon": 1,
  "thứ 3": 2, "thứ ba": 2, "t3": 2, "tuesday": 2, "tue": 2,
  "thứ 4": 3, "thứ tư": 3, "t4": 3, "wednesday": 3, "wed": 3,
  "thứ 5": 4, "thứ năm": 4, "t5": 4, "thursday": 4, "thu": 4,
  "thứ 6": 5, "thứ sáu": 5, "t6": 5, "friday": 5, "fri": 5,
  "thứ 7": 6, "thứ bảy": 6, "t7": 6, "saturday": 6, "sat": 6
};

const dayIndex = (day: OpeningScheduleItem["day"]): number | null => {
  if (typeof day === "number" && day >= 0 && day <= 6) return day;
  const key = String(day ?? "").trim().toLowerCase();
  return key in DAY_ALIASES ? (DAY_ALIASES[key] ?? null) : null;
};

const minutesOfDay = (value: string | undefined): number | null => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
};

interface DailyWindow {
  openMinute: number;
  closeMinute: number;
}

const parseSchedule = (schedule: unknown): Map<number, DailyWindow> => {
  const byDay = new Map<number, DailyWindow>();
  if (!Array.isArray(schedule)) return byDay;

  for (const raw of schedule as OpeningScheduleItem[]) {
    if (!raw || raw.open === false) continue;
    const index = dayIndex(raw.day);
    const openMinute = minutesOfDay(raw.from);
    const closeMinute = minutesOfDay(raw.to);
    if (index === null || openMinute === null || closeMinute === null) continue;
    // Giờ đóng nhỏ hơn giờ mở nghĩa là mở qua đêm (ví dụ 18:00 - 02:00)
    byDay.set(index, { openMinute, closeMinute: closeMinute <= openMinute ? closeMinute + 24 * 60 : closeMinute });
  }

  return byDay;
};

// Nửa đêm (giờ Việt Nam) của ngày chứa thời điểm `date`, trả về theo UTC
const vnMidnight = (date: Date): number => {
  const vnTime = date.getTime() + VN_OFFSET_MS;
  return vnTime - (vnTime % DAY_MS) - VN_OFFSET_MS;
};

const vnWeekday = (utcMidnightOfVnDay: number): number => {
  return new Date(utcMidnightOfVnDay + VN_OFFSET_MS).getUTCDay();
};

/**
 * Mốc đến trước giữa giờ hết hạn và giờ cửa hàng đóng cửa: thời điểm muộn nhất
 * trước khi hết hạn mà cửa hàng còn mở để khách đến lấy.
 * Ví dụ bánh hết hạn 24h, cửa hàng đóng 21h -> mốc là 21h.
 * Không có lịch mở cửa hợp lệ thì dùng giờ hết hạn.
 */
export const effectiveDeadline = (expiresAt: Date, schedule: unknown, now = new Date()): Date => {
  const windows = parseSchedule(schedule);
  if (windows.size === 0) return expiresAt;
  // Hạn còn xa (trên 30 ngày) thì giờ đóng cửa không ảnh hưởng tới nhãn
  if (expiresAt.getTime() - now.getTime() > 30 * DAY_MS) return expiresAt;

  let best: number | null = null;
  // Bắt đầu từ hôm qua để tính cả ca mở qua đêm của ngày hôm trước
  for (let dayStart = vnMidnight(now) - DAY_MS; dayStart <= expiresAt.getTime(); dayStart += DAY_MS) {
    const window = windows.get(vnWeekday(dayStart));
    if (!window) continue;
    const openAt = dayStart + window.openMinute * 60_000;
    const closeAt = dayStart + window.closeMinute * 60_000;
    if (openAt > expiresAt.getTime()) continue;
    const candidate = Math.min(closeAt, expiresAt.getTime());
    if (best === null || candidate > best) best = candidate;
  }

  return best === null ? expiresAt : new Date(best);
};

export const hoursUntil = (deadline: Date, now = new Date()): number => {
  const diff = deadline.getTime() - now.getTime();
  if (!Number.isFinite(diff)) return Number.POSITIVE_INFINITY;
  return Math.max(0, diff / HOUR_MS);
};

export const labelForRemainingHours = (remainingHours: number, group: FoodGroup): ProductLabel => {
  const thresholds = PRODUCT_LABEL_THRESHOLDS[group];
  if (remainingHours <= thresholds.redHours) return "red";
  if (remainingHours <= thresholds.yellowHours) return "yellow";
  return "green";
};

export interface ProductLabelState {
  label: ProductLabel;
  priceVnd: number;
  deadline: Date;
  remainingHours: number;
  shouldStopSelling: boolean;
}

export const computeProductLabelState = (input: {
  expiresAt: string | Date;
  originalPriceVnd: number;
  foodGroup: FoodGroup;
  openingSchedule?: unknown;
  now?: Date;
}): ProductLabelState => {
  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt);
  const deadline = effectiveDeadline(expiresAt, input.openingSchedule, now);
  const remainingHours = hoursUntil(deadline, now);
  const label = labelForRemainingHours(remainingHours, input.foodGroup);

  return {
    label,
    priceVnd: priceForLabel(input.originalPriceVnd, label),
    deadline,
    remainingHours,
    shouldStopSelling: remainingHours < STOP_SELLING_HOURS
  };
};
