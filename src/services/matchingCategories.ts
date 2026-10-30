/**
 * Loại hàng dùng khi ghép đơn. Sản phẩm của FoodSave lưu `products.category` là chữ tự do
 * ("Bánh ngọt / bánh tươi", "Bữa ăn / cơm hộp"), nên ở đây đổi sang mã ngắn để so khớp với nhu cầu.
 */
export const MATCH_CATEGORY_CODES = ["bakery", "meal"] as const;
export type MatchCategoryCode = (typeof MATCH_CATEGORY_CODES)[number];

export const MATCH_CATEGORY_LABELS: Record<MatchCategoryCode, string> = {
  bakery: "Bánh ngọt / bánh tươi",
  meal: "Bữa ăn / cơm hộp",
};

/** Đổi `products.category` sang mã loại. Không nhận ra thì trả "other" (engine sẽ loại vì khác loại hàng). */
export function categoryCodeOf(productCategory: string | null | undefined): string {
  const text = (productCategory ?? "").normalize("NFC").toLowerCase();
  if (text.includes("bánh")) return "bakery";
  if (text.includes("bữa ăn") || text.includes("cơm")) return "meal";
  return "other";
}
