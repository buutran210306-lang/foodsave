/**
 * Demo chạy được: mái ấm cần 50 ổ bánh mì, không tiệm nào đủ một mình.
 * Chạy:  cd code && npm install && npm run demo
 * Dữ liệu dưới đây là hư cấu, chỉ để minh họa.
 */
import { proposePlans } from "../core/matching";
import { buildCandidate, buildNeed, type DonationRowForMatch, type StoreRowForMatch } from "../services/candidateBuilder";

// Giả sử đang là 14:00 ngày 18/10/2026 (giờ Việt Nam)
const at = new Date("2026-10-18T14:00:00+07:00");

const charity = { name: "Mái ấm Ánh Dương", lat: 10.7769, lng: 106.7009 };

const stores: (StoreRowForMatch & { name: string })[] = [
  { id: "store-may", name: "Tiệm bánh Mây", latitude: 10.788, longitude: 106.695, rating: 4.8 },
  { id: "store-bep-xanh", name: "Bếp Xanh", latitude: 10.77, longitude: 106.687, rating: 4.5 },
  { id: "store-som-mai", name: "Lò bánh Sớm Mai", latitude: 10.765, longitude: 106.71, rating: 4.9 },
  { id: "store-xa", name: "Tiệm bánh Xa Xôi", latitude: 10.86, longitude: 106.81, rating: 5 },
  { id: "store-ngot", name: "Tiệm bánh ngọt Hạt Đường", latitude: 10.779, longitude: 106.703, rating: 4.7 },
];

const donations: DonationRowForMatch[] = [
  // 3 tiệm trong bán kính, cộng lại vừa đủ 50 ổ
  { id: "lo-may", store_id: "store-may", qty: 20, unit: "loaf", weight_kg: 2, expires_at: "2026-10-18T18:30:00+07:00", pickup_start: "14:00", pickup_end: "17:00", category_code: "bakery", perishability: "cooked" },
  { id: "lo-bep-xanh", store_id: "store-bep-xanh", qty: 18, unit: "loaf", weight_kg: 1.8, expires_at: "2026-10-18T22:00:00+07:00", pickup_start: "14:00", pickup_end: "20:00", category_code: "bakery", perishability: "cooked" },
  { id: "lo-som-mai", store_id: "store-som-mai", qty: 12, unit: "loaf", weight_kg: 1.2, expires_at: "2026-10-18T21:00:00+07:00", pickup_start: "15:00", pickup_end: "19:00", category_code: "bakery", perishability: "cooked" },
  // Bị loại: ngoài bán kính 5 km
  { id: "lo-xa", store_id: "store-xa", qty: 40, unit: "loaf", weight_kg: 4, expires_at: "2026-10-18T22:00:00+07:00", pickup_start: "14:00", pickup_end: "20:00", category_code: "bakery", perishability: "cooked" },
  // Bị loại: khác danh mục (bánh kem)
  { id: "lo-banh-kem", store_id: "store-ngot", qty: 10, unit: "box", weight_kg: 5, expires_at: "2026-10-18T20:00:00+07:00", pickup_start: "14:00", pickup_end: "19:00", category_code: "cake", perishability: "cooked" },
];

const needInput = {
  quantity: 50,
  unit: "loaf" as const,
  categoryCodes: ["bakery"],
  neededBy: "2026-10-18T18:00:00+07:00",
  charityLat: charity.lat,
  charityLng: charity.lng,
  radiusKm: 5,
};

const storeById = new Map(stores.map((s) => [s.id, s]));
const candidates = donations
  .map((d) => buildCandidate(d, storeById.get(d.store_id)!, needInput, at))
  .filter((c): c is NonNullable<typeof c> => c !== null);

const result = proposePlans(buildNeed(needInput, at), candidates);

const name = (storeId: string) => storeById.get(storeId)?.name ?? storeId;
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });

console.log(`\n${charity.name} cần ${needInput.quantity} ổ bánh mì trước 18:00, bán kính ${needInput.radiusKm} km`);
console.log(`Xét ${result.candidates.total} lô, dùng ${result.candidates.used}, đã thử ${result.stats.combosEvaluated} tổ hợp\n`);

for (const plan of result.plans) {
  console.log(
    `Phương án ${plan.rank}: ${plan.coveredQty}/${plan.requestedQty} ổ` +
      (plan.shortfall > 0 ? ` (thiếu ${plan.shortfall})` : " (đủ)") +
      ` · ${plan.stopCount} điểm dừng · ~${(plan.estDistanceM / 1000).toFixed(1)} km · ~${Math.round(plan.estDurationS / 60)} phút`,
  );
  for (const stop of plan.stops) {
    const lines = plan.lines.filter((l) => l.siteId === stop.siteId);
    const qty = lines.reduce((s, l) => s + l.qty, 0);
    const label = { green: "Xanh", yellow: "Vàng", red: "Đỏ", expired: "Hết hạn" }[lines[0]?.label ?? "green"];
    console.log(`   ${stop.seq}. ${name(stop.siteId)}: lấy ${qty} ổ lúc khoảng ${hhmm(stop.serviceAt)} (nhãn ${label})`);
  }
}

const reasons: Record<string, string> = {
  out_of_radius: "ngoài bán kính",
  category_mismatch: "khác loại hàng",
  expired: "đã hết hạn",
  infeasible_timing: "tới không kịp hạn",
  unit_mismatch: "đơn vị không quy đổi được",
  no_quantity: "hết hàng",
  excluded_site: "đã loại trước",
  duplicate: "trùng",
  invalid: "dữ liệu lỗi",
};
console.log("\nLô bị loại:");
for (const d of result.candidates.dropped) console.log(`   - ${d.offerId}: ${reasons[d.reason] ?? d.reason}`);
console.log("");
