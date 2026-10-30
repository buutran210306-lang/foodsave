/**
 * Đơn vị và quy đổi về đơn vị nhu cầu (DATA-MODEL §4.6, enum `unit_code`). Thuần, không IO.
 */

export type UnitCode = "piece" | "loaf" | "box" | "portion" | "bottle" | "bag" | "kg" | "liter";

export const UNIT_CODES: readonly UnitCode[] = [
  "piece",
  "loaf",
  "box",
  "portion",
  "bottle",
  "bag",
  "kg",
  "liter",
];

export function isUnitCode(value: unknown): value is UnitCode {
  return typeof value === "string" && (UNIT_CODES as readonly string[]).includes(value);
}

/** `kg`, `liter` là đơn vị liên tục (3 chữ số thập phân); các đơn vị khác phải là số nguyên. */
export function isContinuousUnit(unit: UnitCode): boolean {
  return unit === "kg" || unit === "liter";
}

/** Bước nhỏ nhất của số lượng: 1 với đơn vị đếm, 0,001 với kg/lít (`numeric(12,3)`). */
export function quantumOf(unit: UnitCode): number {
  return isContinuousUnit(unit) ? 0.001 : 1;
}

/** Lô có ghép được vào nhu cầu không: cùng đơn vị, hoặc nhu cầu tính kg (quy đổi qua `unit_weight_kg`). */
export function isUnitCompatible(offerUnit: UnitCode, needUnit: UnitCode): boolean {
  return offerUnit === needUnit || needUnit === "kg";
}

/**
 * `private.to_need_units`: cùng đơn vị ⇒ `qty`; nhu cầu kg ⇒ `qty × unit_weight_kg`; còn lại ⇒ lỗi
 * `unit_mismatch` (giống SQL).
 */
export function toNeedUnits(qty: number, unit: UnitCode, unitWeightKg: number, needUnit: UnitCode): number {
  if (unit === needUnit) return qty;
  if (needUnit === "kg") return qty * unitWeightKg;
  throw new RangeError("unit_mismatch");
}

/** Làm tròn `decimals` chữ số (giá trị không âm trong engine; dùng để khử sai số dấu phẩy động). */
export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Làm tròn xuống bội của `quantum` (chống sai số: 2,9999999 với bước 1 ⇒ 3). */
export function floorToQuantum(value: number, quantum: number): number {
  return roundTo(Math.floor(value / quantum + 1e-9) * quantum, 3);
}

/** Làm tròn lên bội của `quantum` (3,0000001 với bước 1 ⇒ 3). */
export function ceilToQuantum(value: number, quantum: number): number {
  return roundTo(Math.ceil(value / quantum - 1e-9) * quantum, 3);
}
