/**
 * Thời gian đầu vào của engine tuyến/ghép đơn: `Date`, epoch ms, chuỗi ISO 8601 hoặc `timestamptz` dạng text
 * của Postgres ("2026-10-20 10:00:00+07"). Chuỗi bắt buộc có múi giờ để kết quả không phụ thuộc máy chạy.
 * Thuần, không IO.
 */
export type TimeInput = Date | string | number;

const PG_OR_ISO = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** Epoch ms của chuỗi thời điểm có múi giờ; sai định dạng hoặc thiếu múi giờ ⇒ `NaN`. */
export function parseTimestamp(text: string): number {
  const m = PG_OR_ISO.exec(text.trim());
  if (!m) return Number.NaN;
  let tz = m[3]!.toUpperCase();
  if (/^[+-]\d{2}$/.test(tz)) tz += ":00";
  else if (/^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  return Date.parse(`${m[1]}T${m[2]}${tz}`);
}

/** Đổi về epoch ms; không hợp lệ ⇒ `RangeError` mang tên trường. */
export function toMs(value: TimeInput, field = "thời điểm"): number {
  const ms =
    value instanceof Date ? value.getTime() : typeof value === "number" ? value : parseTimestamp(value);
  if (!Number.isFinite(ms)) throw new RangeError(`${field} không hợp lệ`);
  return ms;
}

/** Như `toMs` nhưng `null`/`undefined` ⇒ `null`. */
export function toMsOrNull(value: TimeInput | null | undefined, field?: string): number | null {
  return value === null || value === undefined ? null : toMs(value, field);
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}
