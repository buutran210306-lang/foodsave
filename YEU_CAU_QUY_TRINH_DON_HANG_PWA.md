# YÊU CẦU: QUY TRÌNH ĐƠN HÀNG, TIỀN MÔ PHỎNG, ĐIỂM UY TÍN, KHIẾU NẠI VÀ PWA

Tài liệu giao việc cho Claude Code trong VS Code (repo FoodSave bản môn học, 3 bên). Đọc hết trước khi sửa. Làm theo từng đợt ở mục 12, mỗi đợt chạy `npm run typecheck` và thử lại trước khi sang đợt sau.

## 0. Nguyên tắc chung

1. **Không phá những gì đang chạy.** Luồng quyên góp, tình nguyện viên, nhãn/giá, marketing n8n, ESG, KYC, ghép đơn (matching) giữ nguyên.
2. **Giao diện chỉ gọi Backend API**, không ghi trực tiếp vào cơ sở dữ liệu (nguyên tắc sẵn có). Bảng mới bật RLS và không tạo policy (chỉ service role của Backend truy cập).
3. **Tiền là mô phỏng** (sổ cái nội bộ). Thiết kế để sau này thay bước "thanh toán" bằng MoMo thật mà không sửa phần còn lại: mọi thay đổi tiền đi qua một hàm duy nhất `ledgerService.post(...)`.
4. **Mọi tiền lưu VND nguyên** (hậu tố `_cents` nhưng KHÔNG nhân 100, đúng quy ước hiện tại).
5. **Idempotent:** mỗi bút toán sổ cái có `idempotency_key` duy nhất (ví dụ `order:<id>:release`). Gọi lại không được ghi trùng, không hoàn tiền hai lần.
6. **Giờ lưu UTC**, hiển thị giờ Việt Nam (UTC+7).
7. Tệp SQL mới đánh số tiếp từ **028** (hiện có đến 027), viết dạng `if not exists` / `add column if not exists` để chạy lại được. Lưu ý Postgres: `alter type ... add value` phải chạy và commit **trước** khi dùng giá trị mới, nên tách thành tệp 028 riêng.
8. Thông báo: tạo một hàm dùng chung `createNotification()` trong `notificationService` (ghi bảng `notifications`, sau này tự gửi push). Chuyển các chỗ `supabaseAdmin.from("notifications").insert(...)` hiện có (orderService, donationService, labelAutomationService, volunteerService…) sang hàm này.

## 1. Hiện trạng cần biết (đã đọc code)

| Thành phần | Hiện trạng |
|---|---|
| `src/services/orderService.ts` | `createOrder` (giữ kho ngay, `status=pending`, `payment_status=pending`), `confirmPayment` (nút demo, chỉ đổi `payment_status=paid`), `updateOrderStatus` (cộng điểm cửa hàng/người mua khi `completed`, trừ điểm cửa hàng khi cửa hàng hủy, trả hàng về kho khi hủy), `createComplaint`, `updateComplaint` |
| Hạn lấy hàng | Đang là khung chọn sẵn `pickup_slot_key` (`now`/`2h`/`tonight`/`tomorrow`) + `pickup_window` dạng chữ. **Phải thay bằng hạn theo nhãn.** |
| Điểm người mua | `profiles.points` (mặc định 100) và `profiles.rank`. Hằng số `CUSTOMER_REPUTATION_RULES` đã có `noShowDelta -15`, `latePickupDelta -10` nhưng chưa dùng. Hạng: ≥85 Tin cậy, 40–84 Hạn chế, <40 Chặn nhưng chưa chặn gì |
| Điểm cửa hàng | `sellerReputationService`: `seller_reputation(trust_score, status, restricted_until)` + `seller_violations`; <85 → `Restricted` 48 giờ, <40 → `Banned`; mỗi đơn hoàn tất +5. Mọi hàm tự bỏ qua nếu chưa có `DATABASE_URL` |
| Khiếu nại | Bảng `complaints` (open/in_review/resolved/rejected). Người mua gửi, **cửa hàng** đổi trạng thái. Chưa có hạn, hoàn tiền, bước admin, trừ điểm |
| Thanh toán | `momoPaymentService` (sandbox) có sẵn nhưng giao diện dùng nút "Đã thanh toán" (`confirmPaymentDone()` trong FOODSAVE_USER.html) |
| Tác vụ định kỳ | `netlify/functions/label-automation.ts` chạy mỗi 5 phút (khai báo trong `netlify.toml`); sản phẩm đã có `effective_deadline_at` (mốc sớm hơn giữa hạn dùng và giờ đóng cửa) |
| Thông báo | Bảng `notifications` (+ `notification_reads` cho thông báo theo vai trò), chuông trong trang, polling 20 giây. Chưa có push |
| Tình nguyện viên | Không có tài khoản Supabase; đăng nhập số điện thoại, token HMAC (`utils/volunteerToken.ts`, `middlewares/volunteerAuth.ts`, 12 giờ) |
| PWA | Chưa có manifest, service worker, icon. `FOODSAVE_VOLUNTEER.html` đã có `theme-color` và viewport |

Chú ý trong `FOODSAVE_USER.html`: có đoạn "Hook into confirmPaymentDone: +5 when pickup is confirmed" (khoảng dòng 7166) cộng điểm phía trình duyệt. Kiểm tra và **gỡ** nếu nó tự cộng điểm cục bộ, vì điểm giờ do Backend quản lý.

## 2. Quy tắc nghiệp vụ đã chốt

### 2.1 Thời gian theo nhãn

Nhãn của đơn = nhãn khẩn cấp nhất trong các sản phẩm của đơn (đỏ > vàng > xanh).

| Nhãn | Hạn thanh toán sau khi đặt | Hạn lấy hàng sau khi thanh toán | Hạn tự hủy miễn phí (trước hạn lấy) |
|---|---|---|---|
| Xanh | 10 phút | 120 phút | 30 phút |
| Vàng | 10 phút | 90 phút | 20 phút |
| Đỏ | 5 phút | 60 phút | 15 phút |

Đặt các số này ở **một tệp hằng số duy nhất** `src/constants/orderPolicy.ts` để chỉnh được.

Công thức (tính khi thanh toán thành công, `paid_at`):

- `pickup_deadline = min( paid_at + hạn_lấy_theo_nhãn , min(effective_deadline_at của các sản phẩm trong đơn, nếu null thì expires_at) )`
- `cancel_free_until = max( paid_at + 3 phút , pickup_deadline − hạn_tự_hủy_theo_nhãn )` (3 phút đầu luôn được hủy miễn phí để sửa đặt nhầm)
- Lúc **tạo đơn**: từ chối nếu `min(effective_deadline_at) − now < hạn_thanh_toán + 15 phút` (không đủ thời gian lấy hàng). Thông báo rõ lý do.

### 2.2 Trả tiền trước, giữ kho

- Tạo đơn → `status = awaiting_payment`, giữ kho như hiện tại, đặt `pay_deadline = now + hạn_thanh_toán`.
- Quá `pay_deadline` mà chưa trả → tự hủy (`status=cancelled`, `cancel_reason=payment_timeout`, `cancelled_by=system`), trả hàng về kho, **không tính lỗi** cho người mua.
- Bỏ phương thức `cash` (trả khi nhận) khỏi lựa chọn và khỏi tạo đơn (mâu thuẫn với trả trước). Các phương thức còn lại vẫn là nhãn hiển thị, đều mô phỏng.
- Cửa hàng **chỉ thấy đơn đã thanh toán** (không thấy `awaiting_payment`). Ngữ nghĩa trạng thái `pending` hiện có được giữ: "đã thanh toán, chờ cửa hàng nhận đơn", để không phải sửa giao diện cửa hàng.

### 2.3 Vòng đời đơn

```
awaiting_payment --(trả tiền)--> pending --(cửa hàng nhận)--> confirmed --> ready --(quét/nhập QR)--> completed
awaiting_payment --(quá hạn trả)--> cancelled (payment_timeout)
pending|confirmed|ready --(người mua hủy)--> cancelled (hoàn tiền hoặc không, theo 2.4)
pending|confirmed|ready --(cửa hàng hủy/từ chối/hết hàng)--> cancelled (hoàn 100%, trừ điểm cửa hàng như hiện tại)
pending|confirmed|ready --(quá pickup_deadline)--> no_show
```

Thêm 2 giá trị vào enum `order_status`: `awaiting_payment`, `no_show`. Cập nhật `OrderStatus` (domain.ts) và `orderStatusSchema`.

### 2.4 Tiền (sổ cái mô phỏng)

Ký hiệu: `store_amount = subtotal_cents − discount_cents`; `fee = platform_fee_cents` (2.000); `donation = donation_cents`; `total = store_amount + fee + donation`.

| Sự kiện | Bút toán |
|---|---|
| Thanh toán thành công | `charge`: external → escrow, `total`. `settlement_status = held` |
| Hoàn tất (QR) | `release`: escrow → ví cửa hàng `store_amount`; escrow → doanh thu nền tảng `fee`; escrow → quỹ từ thiện `donation`. `settlement_status = released` |
| Hủy trong hạn miễn phí | `refund`: escrow → external, `total` (100%). `settlement_status = refunded`, `payment_status = refunded` |
| Cửa hàng hủy/từ chối/hết hàng | Như trên, hoàn 100% |
| Hủy **sau** hạn miễn phí, hoặc **no-show** | Không hoàn. Làm như `release` nhưng ghi `metadata.reason = late_cancel \| no_show`. `settlement_status = forfeited`. Hàng trả về kho để bán lại |
| Khiếu nại được chấp nhận (sau hoàn tất) | `refund` sau release: ví cửa hàng → external `store_amount`, doanh thu nền tảng → external `fee`, quỹ từ thiện → external `donation` (hoàn 100%, hoặc theo `refund_cents` khi hoàn một phần: trừ ưu tiên từ phần cửa hàng). Ví cửa hàng được phép âm (bù trừ vào các đơn sau) |
| Rút tiền được duyệt | `withdraw`: ví cửa hàng → external |

Hoàn tiền chỉ một lần cho mỗi đơn (kiểm tra `settlement_status` + `idempotency_key`).

### 2.5 No-show và khóa nhãn đỏ

- Quá `pickup_deadline` **+ 5 phút châm chước** (`COMPLETE_GRACE_MINUTES`, cùng mốc cửa hàng còn được xác nhận hoàn tất) mà đơn chưa `completed` → `no_show` (xử lý ở tác vụ định kỳ; cửa hàng bấm tay "Vắng mặt" cũng chỉ được sau mốc này, admin thì không bị giới hạn), tiền theo 2.4, hàng về kho.
- Người mua: điểm −15 (dùng `CUSTOMER_REPUTATION_RULES.noShowDelta`), `no_show_at` ghi vào đơn.
- Đếm số đơn `no_show` của người mua trong 60 ngày gần nhất. **Đủ 3** → `profiles.red_ban_until = now + 30 ngày` (khóa mua sản phẩm nhãn đỏ). Vẫn mua được nhãn xanh/vàng.
- Lần no-show thứ 2 → gửi cảnh báo "còn 1 lần nữa sẽ bị khóa mua hàng nhãn đỏ 30 ngày".
- Khi tạo đơn: nếu có sản phẩm nhãn đỏ và `red_ban_until > now` → lỗi 403 mã `RED_LABEL_BANNED`, kèm ngày được mở lại.
- Điểm người mua `< 40` ("Chặn") → không cho tạo đơn (403 `CUSTOMER_BLOCKED`) cho đến khi admin mở lại.
- Hủy sau hạn miễn phí nhưng trước hạn lấy hàng: người mua −5 điểm, **không** tính vào bộ đếm no-show.

### 2.6 Bảng điểm uy tín (tổng hợp)

| Sự kiện | Người mua | Cửa hàng |
|---|---|---|
| Nhận hàng thành công | +5 | +5 (đã có) |
| No-show | −15, cộng bộ đếm | không đổi |
| Hủy sau mốc miễn phí | −5 | không đổi |
| Cửa hàng hủy/hết hàng ảo | không đổi | −15 (đã có) |
| Khiếu nại được chấp nhận | không đổi | −15, ghi `seller_violations` |
| Khiếu nại bị bác vì sai sự thật | −10 | không đổi |

- Người mua: điểm tối đa 100, tối thiểu 0; giữ hàm `applyCustomerReputationDelta`, **chuyển sang `src/services/customerReputationService.ts`** dùng chung và export.
- Cửa hàng: **giữ nguyên cơ chế ngưỡng sẵn có** (<85 → `Restricted` 48 giờ, <40 → `Banned`). Không thêm quy tắc đếm riêng. Thêm giá trị `COMPLAINT_UPHELD` vào enum `seller_violation_type`.

### 2.7 Khiếu nại

- **Điều kiện gửi:** đơn `completed`; còn trong hạn `complaint_deadline_at` = `completed_at + 12 giờ` nếu trong đơn có món `food_group = cooked`, ngược lại `+ 24 giờ` (lấy hạn ngắn nhất). Mỗi đơn chỉ 1 khiếu nại.
- **Bắt buộc** ≥ 1 ảnh, chọn `reason_code`: `wrong_item`, `spoiled_expired`, `missing_items`, `other`.
- **Quy trình:**
  1. Người mua gửi → `status=open`, `response_due_at = now + 12 giờ`, báo cửa hàng.
  2. Cửa hàng phản hồi trong 12 giờ: `accept` (đồng ý hoàn tiền) hoặc `dispute` (kèm ghi chú và ảnh).
     - `accept` → xử lý như quyết định hoàn 100% (2.4, 2.6) → `resolved`.
     - `dispute` hoặc quá `response_due_at` → `status=in_review`, `escalated_at = now`, vào hàng đợi admin.
  3. Admin quyết định: `refund_full`, `refund_partial` (kèm `refund_cents`), hoặc `reject` (kèm `is_false_claim` tùy chọn).
  4. Hệ quả: hoàn tiền theo 2.4; chấp nhận → trừ điểm cửa hàng + `seller_violations`; bác + `is_false_claim` → trừ điểm người mua; mọi bên nhận thông báo.
- Người mua thấy: trạng thái, phản hồi của cửa hàng, quyết định của admin, số tiền đã hoàn.
- **Ghi chú triển khai Đợt 3:** khiếu nại đúng cả khi hoàn MỘT PHẦN đều trừ 15 điểm cửa hàng; hoàn tiền gọi cả sổ cái và `PaymentProvider.refund`; khiếu nại cũ (không có lý do/ảnh) giữ luồng cũ; ảnh minh chứng chỉ nhận đường dẫn tải lên qua FoodSave; SQL 031 gỡ policy ghi trực tiếp của `complaints`.

### 2.8 Nhắc nhở người mua

- **Trong giao diện:** sau khi thanh toán, trang đơn hàng luôn hiện thanh đếm ngược "Còn X phút để lấy hàng" cùng mã QR, hạn hủy miễn phí và nút Hủy (kèm câu giải thích hủy trong hạn sẽ hoàn tiền, quá hạn không hoàn). Cập nhật mỗi giây ở phía trình duyệt; mốc giờ lấy từ Backend.
- **Thông báo:** (1) ngay sau khi thanh toán: ghi rõ hạn lấy hàng; (2) nhắc giữa chừng khi đã qua nửa thời gian lấy hàng; (3) nhắc cuối khi còn ≤ 15 phút (nhãn đỏ ≤ 10 phút). Cờ chống gửi trùng: `reminder_mid_sent_at`, `reminder_final_sent_at`.
- Hàm chạy 5 phút/lần nên giờ nhắc có thể lệch tối đa ~5 phút, chấp nhận được.

## 3. Cơ sở dữ liệu (SQL)

### 028_order_policy_enums.sql (chạy riêng, xong mới chạy tệp sau)

```sql
alter type public.order_status add value if not exists 'awaiting_payment';
alter type public.order_status add value if not exists 'no_show';
alter type public.seller_violation_type add value if not exists 'COMPLAINT_UPHELD';
```

### 029_order_policy.sql

```sql
alter table public.orders
  add column if not exists pay_deadline timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists pickup_deadline timestamptz,
  add column if not exists cancel_free_until timestamptz,
  add column if not exists policy_label text check (policy_label in ('green','yellow','red')),
  add column if not exists no_show_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by text check (cancelled_by in ('customer','store','system','admin')),
  add column if not exists reminder_mid_sent_at timestamptz,
  add column if not exists reminder_final_sent_at timestamptz,
  add column if not exists settlement_status text not null default 'none'
    check (settlement_status in ('none','held','released','forfeited','refunded','partially_refunded')),
  add column if not exists complaint_deadline_at timestamptz;

alter table public.profiles
  add column if not exists red_ban_until timestamptz;

create index if not exists orders_pay_deadline_idx on public.orders(pay_deadline) where status = 'awaiting_payment';
create index if not exists orders_pickup_deadline_idx on public.orders(pickup_deadline) where status in ('pending','confirmed','ready');
create index if not exists orders_customer_noshow_idx on public.orders(customer_id, no_show_at) where status = 'no_show';
```

### 030_wallet_ledger.sql

```sql
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('external','escrow','platform_revenue','charity_pool','store')),
  store_id uuid references public.stores(id) on delete cascade,
  balance_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallets_store_required check ((owner_type = 'store') = (store_id is not null))
);
create unique index if not exists wallets_system_unique on public.wallets(owner_type) where store_id is null;
create unique index if not exists wallets_store_unique on public.wallets(store_id) where store_id is not null;
-- Tạo sẵn 4 ví hệ thống
insert into public.wallets(owner_type) select t from unnest(array['external','escrow','platform_revenue','charity_pool']) t
on conflict do nothing;

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  order_id uuid references public.orders(id) on delete set null,
  entry_type text not null check (entry_type in ('charge','release','refund','refund_clawback','withdraw','adjustment')),
  from_wallet_id uuid not null references public.wallets(id),
  to_wallet_id uuid not null references public.wallets(id),
  amount_cents bigint not null check (amount_cents > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ledger_order_idx on public.ledger_entries(order_id);
create index if not exists ledger_created_idx on public.ledger_entries(created_at desc);

-- Ghi một bút toán và cập nhật số dư trong CÙNG một giao dịch; gọi lại cùng key thì trả về bút toán cũ
create or replace function public.fs_post_ledger(
  p_key text, p_order uuid, p_type text, p_from uuid, p_to uuid, p_amount bigint, p_meta jsonb
) returns public.ledger_entries language plpgsql as $$
declare e public.ledger_entries;
begin
  select * into e from public.ledger_entries where idempotency_key = p_key;
  if found then return e; end if;
  insert into public.ledger_entries(idempotency_key, order_id, entry_type, from_wallet_id, to_wallet_id, amount_cents, metadata)
  values (p_key, p_order, p_type, p_from, p_to, p_amount, coalesce(p_meta,'{}'::jsonb)) returning * into e;
  update public.wallets set balance_cents = balance_cents - p_amount, updated_at = now() where id = p_from;
  update public.wallets set balance_cents = balance_cents + p_amount, updated_at = now() where id = p_to;
  return e;
end $$;

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 50000),
  bank_name text not null,
  account_last4 text not null check (account_last4 ~ '^[0-9]{4}$'),   -- chỉ lưu 4 số cuối, KHÔNG lưu số tài khoản đầy đủ
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  admin_note text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id)
);
create index if not exists withdrawals_store_idx on public.withdrawals(store_id, requested_at desc);
create index if not exists withdrawals_status_idx on public.withdrawals(status, requested_at);

alter table public.wallets enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.withdrawals enable row level security;
```

Ví cửa hàng tạo lười (lần đầu cần) bằng `ledgerService.getStoreWallet(storeId)`.

**Ghi chú triển khai Đợt 2 (SQL 030 thực tế):** ngoài `fs_post_ledger` (nay khóa hai ví theo thứ tự id rồi `insert ... on conflict (idempotency_key) do nothing`), tệp 030 có thêm các hàm nguyên tử `fs_store_wallet`, `fs_request_withdrawal` (khóa ví rồi kiểm tra số dư khả dụng trong cùng giao dịch), `fs_decide_withdrawal` (duyệt/từ chối đúng một lần), `fs_ledger_check` (đối soát), `fs_finance_summary` (số liệu Admin) và cột `orders.ledger_synced_status` để tác vụ định kỳ bù bút toán cho đơn chưa có trong sổ cái. Rút tối thiểu 50.000đ (`MIN_WITHDRAWAL`); bản mẫu v2 từng ghi 200.000đ là sai.

### 031_complaint_flow.sql

```sql
alter table public.complaints
  add column if not exists reason_code text check (reason_code in ('wrong_item','spoiled_expired','missing_items','other')),
  add column if not exists response_due_at timestamptz,
  add column if not exists store_response text,
  add column if not exists store_response_action text check (store_response_action in ('accept','dispute')),
  add column if not exists store_response_images text[] not null default '{}',
  add column if not exists store_responded_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists decision text check (decision in ('refund_full','refund_partial','reject')),
  add column if not exists refund_cents bigint not null default 0,
  add column if not exists is_false_claim boolean not null default false,
  add column if not exists admin_note text,
  add column if not exists decided_by uuid references public.profiles(id),
  add column if not exists decided_at timestamptz;

create unique index if not exists complaints_one_per_order on public.complaints(order_id);
create index if not exists complaints_queue_idx on public.complaints(status, response_due_at);
```

(Nếu đã có dữ liệu khiếu nại trùng đơn thì tạo index sau khi xử lý trùng.)

### 032_push_subscriptions.sql

```sql
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_id uuid references public.profiles(id) on delete cascade,
  volunteer_id uuid references public.volunteers(id) on delete cascade,
  role text not null check (role in ('customer','volunteer','partner','admin','charity')),
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint push_owner_one check ((user_id is not null) <> (volunteer_id is not null))
);
create index if not exists push_user_idx on public.push_subscriptions(user_id);
create index if not exists push_volunteer_idx on public.push_subscriptions(volunteer_id);
alter table public.push_subscriptions enable row level security;
```

## 4. Backend: việc theo từng tệp

### 4.1 Mới

- `src/constants/orderPolicy.ts`: bảng thời gian (2.1), `MIN_PICKUP_WINDOW_MIN=15`, `GRACE_CANCEL_MIN=3`, `NO_SHOW_BAN_COUNT=3`, `NO_SHOW_WINDOW_DAYS=60`, `RED_BAN_DAYS=30`, `COMPLAINT_WINDOW_COOKED_H=12`, `COMPLAINT_WINDOW_OTHER_H=24`, `COMPLAINT_STORE_RESPONSE_H=12`, `MIN_WITHDRAWAL=50000`, các mức điểm (2.6).
- `src/services/ledgerService.ts`: `post()` (gọi RPC `fs_post_ledger`), `getStoreWallet`, `holdCharge(order)`, `settleOrder(order, reason)` (release/forfeit), `refundOrder(order, {amount?, reason})` (xử lý cả trước và sau release), `getStoreBalance(storeId)` (số dư − tổng lệnh rút đang chờ).
- `src/services/customerReputationService.ts`: `applyDelta`, `getStatus`, `assertCanOrder(customerId, hasRedLabel)`, `recordNoShow(customerId, orderId)` (đếm 60 ngày, đặt `red_ban_until`, cảnh báo lần 2).
- `src/services/orderAutomationService.ts` + `netlify/functions/order-automation.ts` (khai báo `schedule = "*/5 * * * *"` trong `netlify.toml`, giống `label-automation`). Mỗi lần chạy:
  1. Đơn `awaiting_payment` quá `pay_deadline` → hủy hệ thống, trả hàng về kho.
  2. Đơn `pending|confirmed|ready` đã `paid`, quá `pickup_deadline` → `no_show` (tiền forfeited, trả hàng về kho, điểm, bộ đếm, thông báo người mua + cửa hàng).
  3. Nhắc giữa chừng và nhắc cuối (cờ `reminder_*_sent_at`).
  4. Khiếu nại `open`, chưa có phản hồi cửa hàng, quá `response_due_at` → `in_review`, `escalated_at`.
  Mỗi bước bọc try/catch riêng, ghi log số lượng xử lý, trả JSON tóm tắt. Thêm nút chạy tay ở trang Admin giống "Cập nhật nhãn ngay" (endpoint `POST /admin/order-automation/run`).
- `src/services/complaintService.ts`: chuyển logic khiếu nại ra khỏi orderService (tạo, phản hồi cửa hàng, quyết định admin, danh sách theo vai trò).
- `src/services/walletService.ts` (hoặc gộp ledger): ví cửa hàng, lịch sử, tạo/duyệt rút tiền.
- `src/services/pushService.ts`: xem mục 9.
- Types/schemas tương ứng, route mới (mục 5).

### 4.2 Sửa

- `orderService.createOrder`: (a) `customerReputationService.assertCanOrder`; (b) tính nhãn đơn, kiểm tra điều kiện ≥ hạn thanh toán + 15 phút; (c) `status=awaiting_payment`, `pay_deadline`, `policy_label`; (d) bỏ `cash`; (e) `pickup_slot_key` thành tùy chọn (mặc định `policy`), `pickup_window` ghi "Trong N phút sau khi thanh toán"; (f) **không** gửi thông báo "đơn mới" cho cửa hàng ở bước này (chuyển sang bước thanh toán).
- `orderService.confirmPayment`: chỉ cho `awaiting_payment` còn trong `pay_deadline` (quá hạn → 409 mã `PAYMENT_EXPIRED`); đặt `paid_at`, `pickup_deadline`, `cancel_free_until`, `status=pending`, `payment_status=paid`, `settlement_status=held`; gọi `ledgerService.holdCharge`; thông báo cửa hàng "đơn mới đã thanh toán" và thông báo người mua (hạn lấy hàng). Sau này bản MoMo thật chỉ gọi lại hàm này trong webhook thành công (`momoPaymentService.applyMockWebhook` hiện đổi `payment_status`: cho nó gọi chung hàm này để đồng bộ).
- `orderService.updateOrderStatus`:
  - Người mua **không** dùng PATCH này để hủy nữa (chuyển sang `POST /orders/:id/cancel`).
  - `completed`: chỉ khi `payment_status=paid` và `now ≤ pickup_deadline + 5 phút`; ghi `completed_at`, `complaint_deadline_at`, gọi `ledgerService.settleOrder(order,'completed')`, giữ logic cộng điểm + eco impact sẵn có.
  - Cửa hàng/admin hủy: hoàn 100% (`refundOrder`), `cancelled_by=store|admin`, giữ phạt điểm cửa hàng sẵn có, trả hàng về kho.
- Thêm `orderService.cancelByCustomer(customerId, orderId)`: cho trạng thái `awaiting_payment|pending|confirmed|ready`. `awaiting_payment` → hủy, không tiền. Đã trả: `now ≤ cancel_free_until` → hoàn 100%; sau đó → forfeited, điểm −5. Luôn trả hàng về kho. Trả về `{order, refunded: boolean, refund_cents}` để giao diện hiện đúng thông báo.
- `orderService.listOrders/getOrder`: trả thêm các cột mới. Với vai trò `partner`, **ẩn đơn `awaiting_payment`** (và đơn đã hủy do quá hạn trả).
- `orderService.createComplaint / updateComplaint`: chuyển sang `complaintService` theo 2.7; giữ đường dẫn cũ `/orders/complaints...` để giao diện hiện tại không vỡ.
- `labelAutomationService`: dùng `createNotification` (không đổi logic).
- `types/domain.ts`, `schemas/orderSchemas.ts`: thêm trạng thái, trường mới; `createOrderBodySchema.pickup_slot_key` tùy chọn; payment_method bỏ `cash`.

## 5. API

| Phương thức | Đường dẫn | Vai trò | Mô tả |
|---|---|---|---|
| POST | `/orders` | customer | Tạo đơn `awaiting_payment` (sửa) |
| POST | `/orders/:id/confirm-payment` | customer | Thanh toán mô phỏng (sửa) |
| POST | `/orders/:id/cancel` | customer | Hủy theo 2.4 (mới) |
| PATCH | `/orders/:id/status` | partner, admin | Cửa hàng nhận/sẵn sàng/hoàn tất/hủy (sửa) |
| POST | `/orders/complaints` | customer | Gửi khiếu nại, kiểm tra hạn, ảnh bắt buộc (sửa) |
| POST | `/orders/complaints/:id/respond` | partner | `accept` / `dispute` (mới) |
| GET | `/orders/complaints/list` | tất cả | Danh sách theo vai trò (giữ) |
| GET | `/admin/complaints?status=in_review` | admin | Hàng đợi tranh chấp (mới) |
| POST | `/admin/complaints/:id/decision` | admin | `refund_full` / `refund_partial` / `reject` (mới) |
| GET | `/partner/wallet` | partner | Số dư, số dư khả dụng, lịch sử bút toán của cửa hàng (mới) |
| POST | `/partner/withdrawals` | partner | Tạo lệnh rút (mới) |
| GET | `/partner/withdrawals` | partner | Lịch sử lệnh rút (mới) |
| GET | `/admin/finance/summary` | admin | Số dư ví escrow, doanh thu, quỹ từ thiện, tổng hoàn, tổng no-show (mới) |
| GET | `/admin/ledger` | admin | Sổ cái có lọc theo loại, đơn, ngày, phân trang (mới) |
| GET, PATCH | `/admin/withdrawals`, `/admin/withdrawals/:id` | admin | Danh sách, duyệt/từ chối (mới) |
| POST | `/admin/order-automation/run` | admin | Chạy tay tác vụ đơn hàng (mới) |
| GET | `/customers/me/trust` | customer | Điểm, hạng, `red_ban_until`, số no-show trong 60 ngày (mới) |
| POST | `/admin/customers/:id/unlock` | admin | Mở khóa nhãn đỏ / chặn, có ghi chú (mới) |
| GET, POST | `/push/public-key`, `/push/subscribe`, `/push/unsubscribe` | customer, volunteer | Mục 9 |

Mã lỗi mới trong `constants/errors.ts`: `RED_LABEL_BANNED`, `CUSTOMER_BLOCKED`, `PAYMENT_EXPIRED`, `PICKUP_EXPIRED`, `COMPLAINT_WINDOW_CLOSED`, `COMPLAINT_ALREADY_EXISTS`, `INSUFFICIENT_BALANCE`.

Mọi route mới thêm vào `src/routes/index.ts`, dùng `requireRoles`, `validateRequest` (Zod) và `asyncHandler` như các route hiện có.

## 6. Giao diện

### 6.1 FOODSAVE_USER.html (người mua)

- **Bước đặt hàng/thanh toán** (quanh `confirmPaymentDone`, dòng ~3052 và ~6107): bỏ chọn khung giờ nhận (gửi `pickup_slot_key` mặc định), bỏ `cash`; thêm đồng hồ đếm ngược `pay_deadline`; hết giờ hiện thông báo "Đơn đã hết hạn thanh toán, hàng đã trả về kho"; thanh toán xong chuyển sang trang đơn.
- **Chi tiết đơn** (khoảng dòng 3190–3195 và timeline ~6262): thanh đếm ngược cố định "Còn X phút để lấy hàng" (đổi màu cam khi ≤ 15 phút, đỏ khi ≤ 5), mã QR luôn hiện, dòng "Hủy miễn phí đến HH:mm"; nút Hủy với hộp xác nhận nói rõ **hoàn tiền** hay **không hoàn tiền** tùy thời điểm; hiển thị trạng thái `no_show` ("Đã quá hạn lấy hàng") và `cancelled` kèm lý do.
- **Khiếu nại** (modal quanh dòng 7057–7224): chọn lý do, bắt buộc ảnh, chỉ mở nút khi còn trong hạn (hiện "Còn X giờ để báo vấn đề"); xem phản hồi của cửa hàng, quyết định admin, số tiền đã hoàn.
- **Điểm và khóa:** hiện điểm, hạng, số lần no-show (x/3) ở trung tâm cá nhân; khi bị khóa nhãn đỏ, ẩn/khóa nút mua sản phẩm nhãn đỏ và hiện ngày mở lại; bắt lỗi `RED_LABEL_BANNED`/`CUSTOMER_BLOCKED` ở bước đặt hàng.
- Thông báo trong chuông cho các loại mới (nhắc hạn, hoàn tiền, no-show, cảnh báo khóa, khiếu nại).

### 6.2 FOODSAVE_PARTNER.html (cửa hàng)

- Danh sách đơn: chỉ đơn đã thanh toán; hiện đếm ngược `pickup_deadline`, nhãn "Quá hạn / no-show" khi có; nút hoàn tất bị chặn quá hạn (hiện lỗi `PICKUP_EXPIRED`).
- **Hộp khiếu nại:** xem khiếu nại (ảnh, lý do, hạn phản hồi), nút Đồng ý hoàn tiền / Phản bác (ghi chú + ảnh).
- **Trang Ví** (thêm mục menu): số dư, số dư khả dụng, lịch sử bút toán (nhận tiền đơn, trừ khiếu nại, rút tiền), nút Rút tiền (form: số tiền, ngân hàng, 4 số cuối tài khoản), danh sách lệnh rút và trạng thái.
- Điểm uy tín cửa hàng và lịch sử vi phạm (dữ liệu đã có sẵn từ `/seller-reputation`), hiển thị cả vi phạm `COMPLAINT_UPHELD`.

### 6.3 ADMIN_FOODSAVE.html

- **Dispute Hub:** hàng đợi khiếu nại `in_review`, xem đầy đủ (đơn, ảnh người mua, phản hồi cửa hàng, lịch sử cửa hàng), form quyết định (hoàn đủ, hoàn một phần, bác, đánh dấu khiếu nại sai sự thật, ghi chú).
- **Finance Center:** thẻ tổng quan, bảng sổ cái có lọc, duyệt/từ chối lệnh rút, kiểm tra khớp (tổng số dư các ví = 0, vì ví external là đối ứng).
- Bảng người mua có điểm thấp/đang bị khóa, nút mở khóa; nút chạy tay `order-automation`.

### 6.4 FOODSAVE_CHARITY.html, FOODSAVE_VOLUNTEER.html

Không đổi nghiệp vụ. Tình nguyện viên chỉ thêm PWA (mục 9).

## 7. Tính tương thích

- Đơn cũ (trước đợt này) không có `pickup_deadline`: tác vụ định kỳ **bỏ qua** đơn có `pickup_deadline is null`; `completed` không kiểm tra hạn nếu cột null.
- Giữ cột `pickup_slot_key`/`pickup_window` và hiển thị cũ cho đơn cũ.
- Các cột mới đều nullable hoặc có default.
- Nếu chạy máy cá nhân (không có Netlify cron), dùng nút chạy tay ở Admin, giống `label-automation`.
- Hàm `sellerReputationService` vẫn tự bỏ qua khi thiếu `DATABASE_URL`; phần điểm người mua dùng Supabase client nên không phụ thuộc.

## 8. Dữ liệu mẫu để kiểm thử

Tạo seed ngắn (`database/Seed/seed_order_policy.sql` hoặc script) với: 1 người mua, 1 cửa hàng đã duyệt, 3 sản phẩm (xanh/vàng/đỏ) hạn dùng đủ dài, để thử từng kịch bản ở mục 10. Cho phép biến môi trường `ORDER_POLICY_TIME_SCALE` (mặc định 1; đặt 0.05 khi demo để 60 phút thành 3 phút) áp lên các mốc thời gian, nhằm thử no-show nhanh. Chỉ bật khi `DEMO_MODE`.

## 9. PWA và thông báo đẩy (người mua và tình nguyện viên)

### 9.1 Tệp tĩnh ở thư mục gốc (Netlify `publish = "."`)

- `manifest-user.webmanifest` và `manifest-volunteer.webmanifest`: `name`, `short_name` ("FoodSave", "FoodSave TNV"), `start_url` (`/FOODSAVE_USER.html`, `/FOODSAVE_VOLUNTEER.html`), `scope: "/"`, `display: "standalone"`, `theme_color` (đã có `#006C4D` ở trang TNV; dùng cùng màu thương hiệu cho người mua), `background_color`, `lang: "vi"`, icon 192, 512 và maskable 512.
- Thư mục `icons/`: icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon-180.png (tạo từ logo FoodSave hiện có; nếu chưa có logo vuông thì dựng tạm chữ "FS" nền xanh).
- `sw.js` (một service worker dùng chung, scope `/`):
  - Cache vỏ ứng dụng: `frontend/*.js`, `frontend/*.css`, icon, `offline.html`; chiến lược stale-while-revalidate cho tệp tĩnh, network-first cho trang HTML.
  - **Không bao giờ** cache `/api/`, Supabase hay nội dung có token.
  - Phiên bản cache (`fs-v1`), xóa cache cũ khi `activate`; `skipWaiting` + `clients.claim`.
  - Sự kiện `push`: hiện thông báo với `title`, `body`, `icon`, `tag`, `data.url`.
  - Sự kiện `notificationclick`: mở/đưa lên tab của `data.url` (deep link vào đúng đơn hoặc nhiệm vụ).
- `offline.html`: trang báo mất kết nối, có nút thử lại.
- `netlify.toml`: thêm `[[headers]]` cho `/sw.js` (`Cache-Control: no-cache`, `Service-Worker-Allowed: /`) và `/*.webmanifest` (`Content-Type: application/manifest+json`).

### 9.2 Trong hai trang HTML (`FOODSAVE_USER.html`, `FOODSAVE_VOLUNTEER.html`)

- Thêm `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `<meta name="apple-mobile-web-app-capable">`, `theme-color` (trang người mua cần thêm).
- Đăng ký service worker; lỗi đăng ký không được làm hỏng trang.
- Nút/biểu ngữ **"Cài ứng dụng"**: bắt sự kiện `beforeinstallprompt` (Chrome Android) và hiện nút; trên iPhone hiện hướng dẫn "Chia sẻ → Thêm vào Màn hình chính". Ẩn khi đã cài (`display-mode: standalone`).
- Nút **"Bật thông báo"** (phải do người dùng bấm, không tự hỏi lúc mở trang): xin quyền `Notification`, gọi `pushManager.subscribe` với khóa VAPID công khai lấy từ `GET /push/public-key`, gửi kết quả lên `POST /push/subscribe`. Hiện trạng thái đã bật/đã chặn và cách mở lại trong cài đặt trình duyệt. Có nút tắt.

### 9.3 Backend

- Thêm dependency `web-push` (và `@types/web-push` nếu cần).
- Biến môi trường mới (ghi vào `.env.example`, đặt trên Netlify, **không** commit khóa thật): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (dạng `mailto:email-của-nhóm`). Tạo khóa bằng `npx web-push generate-vapid-keys`.
- `pushService`:
  - `subscribe`: người mua xác thực bằng JWT (customer); tình nguyện viên xác thực bằng token HMAC (`volunteerAuth`). Lưu `endpoint/p256dh/auth` vào `push_subscriptions` (upsert theo `endpoint`).
  - `sendToUser(userId, payload)` và `sendToVolunteer(volunteerId, payload)`: gửi tới mọi thiết bị; gặp lỗi 404/410 thì xóa subscription; lỗi khác chỉ ghi log, **không** làm hỏng nghiệp vụ gọi nó (luôn try/catch).
  - `createNotification()` (mục 0.8) ghi bảng `notifications` rồi gọi `sendToUser` (chạy nền, không chờ).
- Payload gọn: `{ title, body, url, tag, type }`. `url` là deep link (ví dụ `/FOODSAVE_USER.html#order=<id>`; trang cần đọc hash này để mở đúng đơn: kiểm tra hàm điều hướng hiện có).
- Sự kiện gửi push, người mua: thanh toán thành công (kèm hạn lấy), nhắc giữa chừng, nhắc cuối, cửa hàng nhận/sẵn sàng/hoàn tất, hủy hoặc hoàn tiền, no-show, cảnh báo no-show lần 2, khóa nhãn đỏ, cập nhật khiếu nại.
- Sự kiện gửi push, tình nguyện viên: được tổ chức phân nhiệm vụ mới, nhắc giờ lấy hàng, ảnh minh chứng được duyệt hoặc cần chụp lại. (Tìm các chỗ trong `volunteerService`/`donationService`/`teamService` tạo thông báo hoặc đổi trạng thái để gắn `sendToVolunteer`.)

### 9.4 Giới hạn cần ghi nhận (đưa vào HANDOFF.md và báo cáo)

- Android Chrome hoạt động tốt, có thể bị trì hoãn khi máy bật tiết kiệm pin.
- iPhone chỉ nhận push khi iOS ≥ 16.4 **và** đã "Thêm vào Màn hình chính" bằng Safari.
- Không lên Google Play/App Store; không theo dõi GPS nền. Camera và GPS chỉ dùng khi ứng dụng đang mở.
- Muốn mở rộng sang cổng cửa hàng sau này: dùng lại `sw.js` và `pushService`, chỉ thêm manifest và nút bật thông báo.

## 10. Kịch bản kiểm thử (làm sau mỗi đợt, ghi kết quả vào PR/ghi chú)

1. **Mua đủ vòng:** đặt nhãn vàng → thanh toán → cửa hàng nhận → sẵn sàng → nhập mã QR → `completed`. Kiểm tra: ví escrow = 0, ví cửa hàng +`store_amount`, doanh thu nền tảng +2.000, người mua +5 điểm, cửa hàng +5 điểm, có bản ghi eco impact, đơn có `complaint_deadline_at`.
2. **Không trả tiền:** đặt nhãn đỏ, đợi quá 5 phút → `cancelled (payment_timeout)`, hàng về kho, cửa hàng không hề thấy đơn.
3. **Hủy miễn phí:** thanh toán, hủy trong hạn → hoàn 100%, ví escrow về 0, hàng về kho, không trừ điểm.
4. **Hủy muộn:** thanh toán, hủy sau `cancel_free_until` nhưng trước hạn lấy → không hoàn, cửa hàng nhận tiền trừ phí, người mua −5 điểm, hàng về kho.
5. **No-show:** thanh toán và không đến → `no_show`, forfeited, −15 điểm, hàng về kho, có thông báo cho cả hai bên. Lặp 3 lần trong 60 ngày → `red_ban_until` +30 ngày; lần 2 có cảnh báo; thử đặt nhãn đỏ → `RED_LABEL_BANNED`, nhãn xanh/vàng vẫn đặt được.
6. **Điểm <40:** đặt `points=30` → `CUSTOMER_BLOCKED`; admin `unlock` rồi đặt lại được.
7. **Cửa hàng hủy/hết hàng:** hoàn 100%, cửa hàng −15 điểm.
8. **Nhắc nhở:** đủ 3 thông báo (sau thanh toán, giữa chừng, cuối) và không gửi trùng khi cron chạy lại.
9. **Hoàn tất quá hạn:** cố hoàn tất khi đã quá `pickup_deadline + 5 phút` → `PICKUP_EXPIRED`.
10. **Khiếu nại đồng ý:** gửi trong hạn có ảnh, cửa hàng `accept` → hoàn 100% từ ví cửa hàng, cửa hàng −15 + `seller_violations`, người mua nhận thông báo hoàn tiền.
11. **Khiếu nại phản bác → admin:** `dispute` → vào hàng đợi admin → `refund_partial` đúng số tiền; và nhánh `reject` + `is_false_claim` → người mua −10.
12. **Khiếu nại quá hạn phản hồi:** cửa hàng không trả lời 12 giờ → tự `in_review` (dùng `ORDER_POLICY_TIME_SCALE` để thử nhanh).
13. **Ngoài hạn khiếu nại:** gửi sau 12/24 giờ → `COMPLAINT_WINDOW_CLOSED`; gửi lần 2 cho cùng đơn → `COMPLAINT_ALREADY_EXISTS`.
14. **Rút tiền:** rút vượt số dư khả dụng → `INSUFFICIENT_BALANCE`; rút hợp lệ → `requested`; admin duyệt → số dư giảm; từ chối → số dư giữ nguyên.
15. **Chống trùng:** gọi hai lần liên tiếp thanh toán/hoàn tất/hoàn tiền của cùng đơn → sổ cái chỉ có một bút toán mỗi loại.
16. **Đối soát:** tổng `balance_cents` của mọi ví luôn bằng 0.
17. **PWA:** mở link Netlify trên Chrome Android → có lời nhắc/nút cài; sau khi cài mở toàn màn hình; Lighthouse mục PWA đạt; bật thông báo, chạy một sự kiện thật (thanh toán đơn) khi đã **tắt hẳn ứng dụng** → điện thoại nhận được thông báo, chạm vào mở đúng đơn; tình nguyện viên nhận thông báo khi được phân nhiệm vụ.
18. **Không hồi quy:** quyên góp, tình nguyện viên, nhãn/giá, marketing, ESG, ghép đơn vẫn chạy như cũ.

## 11. Cách triển khai

1. Chạy SQL 028 (riêng), rồi 029, 030, 031, 032 trong Supabase SQL Editor.
2. Đặt biến môi trường trên Netlify (VAPID, `ORDER_POLICY_TIME_SCALE` nếu cần) và `.env` cục bộ.
3. `npm run typecheck`, rồi đẩy lên GitHub; Netlify tự triển khai (kiểm tra có hàm `order-automation` ở mục Functions và lịch 5 phút).
4. Mở trang Admin bấm chạy tay `order-automation` một lần để kiểm tra.
5. Cập nhật `HANDOFF.md`: quy tắc mới (bảng 2.1), sổ cái, khiếu nại, PWA và giới hạn (mục 9.4).

## 12. Thứ tự làm (từng đợt, kiểm thử xong mới sang đợt sau)

- **Đợt 1: Đơn hàng, no-show, điểm, nhắc nhở.** SQL 028–029; `orderPolicy`; sửa tạo đơn, thanh toán, hủy, hoàn tất; `customerReputationService`; `order-automation`; giao diện người mua (đếm ngược, hủy, điểm, khóa). Kịch bản 1–9.
- **Đợt 2: Tiền.** SQL 030; `ledgerService`; nối vào thanh toán, hoàn tất, hủy, no-show; Ví cửa hàng và rút tiền; Finance Center admin. Kịch bản 14–16 và kiểm tra lại 1–5.
- **Đợt 3: Khiếu nại.** SQL 031; `complaintService`; giao diện người mua, cửa hàng, Dispute Hub admin; trừ điểm và hoàn tiền. Kịch bản 10–13.
- **Đợt 4: PWA và push.** SQL 032; manifest, `sw.js`, icon, `pushService`, `createNotification`; nút cài và bật thông báo; gắn push vào các sự kiện đã liệt kê. Kịch bản 17.
- **Đợt cuối:** chạy lại toàn bộ kịch bản 1–18, cập nhật HANDOFF.md.

## 13. Việc ngoài phạm vi (không làm bây giờ)

Nối MoMo thật (khung `momoPaymentService` giữ nguyên, sau này gọi `confirmPayment` từ webhook thành công); app native; push cho cổng cửa hàng và cổng tổ chức từ thiện; thông báo "hàng đỏ gần bạn" theo vị trí (cần lưu vị trí người dùng); ghép đơn đang phát triển riêng.

## 14. Giao diện v2 cho cổng cửa hàng và cổng admin (ĐÃ DUYỆT, làm sau cùng cho từng đợt)

Người dùng đã xem và đồng ý giao diện mẫu trong hai tệp `FOODSAVE_PARTNER_v2.html` và `ADMIN_FOODSAVE_v2.html` (đặt cạnh tệp gốc, mở bằng đuôi `?demo=1` để xem dữ liệu mẫu, không cần đăng nhập). **Hai tệp này là bản tham chiếu giao diện.** Mỗi tệp được tạo bằng cách chèn đúng 2 khối vào tệp gốc: một thẻ `<style id="ui-v2">` cuối `<head>` và một thẻ `<script id="ui-v2-js">` cuối `<body>`. Mã nghiệp vụ cũ (đăng nhập, gọi API, live-data) giữ nguyên.

### 14.1 Cách đưa vào dự án

1. Đưa hai khối trên vào `FOODSAVE_PARTNER.html` và `ADMIN_FOODSAVE.html` thật (hoặc tách thành `frontend/partner-v2.css`, `frontend/partner-v2.js`, `frontend/admin-v2.css`, `frontend/admin-v2.js` rồi nhúng, nhớ thêm `?v=` chống cache). Không sửa các hàm cũ; lớp v2 ghi đè các hàm vẽ trang (`pDash`, `pOrders`, `pComplaints`, `pWallet`, và `pg.dashboard`, `pg.disputes`, `pg.risks`, `pg.reputation`, thêm `pg.*` mới) và bọc `R()`.
2. Chế độ `?demo=1`: giữ lại để trình bày và kiểm thử giao diện (chỉ chạy khi có tham số, không ảnh hưởng chạy thật). Mọi chỗ gắn thẻ vàng "Mẫu" là dữ liệu mô phỏng cần nối API thật theo bảng 14.2; khi nối xong thì bỏ thẻ và bỏ dữ liệu mẫu tương ứng.
3. Khi nối API thật, thay dữ liệu mẫu trong tệp v2 (các biến `WAL`, `REP`, `WEEK`, `CUST`, `CHAT`, `DISP`, `LEDGER`, `WD`, `LOCKED`, `JOBS`, `VER`, `DIS`, `RK` đang dùng chung dữ liệu cũ) bằng dữ liệu từ các API ở mục 5. Hàm demo (`orderSetStatus`, `resolveComplaint`, `noShow`, `cancelOrder`, `orderConfirmPickup`) chỉ bị ghi đè khi `DEMO`; ngoài demo phải gọi API thật.
4. Không thay đổi CSS của các tệp `frontend/foodsave-*.css` hiện có.

### 14.2 Cổng cửa hàng: màn hình → nguồn dữ liệu thật

| Màn hình v2 | Nội dung | Nối với |
|---|---|---|
| Tổng quan (`pDash`) | Banner chào + doanh thu hôm nay; 5 ô (đơn cần xử lý, SP cảnh báo HSD, xung đột kho, khiếu nại chờ, số dư khả dụng); khối "Cần xử lý ngay" (đơn sắp hết hạn lấy + khiếu nại sắp hết hạn phản hồi); doanh thu 7 ngày; cảnh báo HSD; đơn gần đây | Dữ liệu `ORD`, `PRD`, `COMPLAINTS` đã có; thêm `GET /partner/wallet` (số dư), `GET /seller-reputation` (điểm uy tín); doanh thu 7 ngày tính từ đơn `completed` |
| Đơn hàng (`pOrders`) | Tab: Tất cả, Chờ thanh toán, Mới, Đã nhận, Sẵn sàng, Hoàn thành, Vắng mặt, Đã hủy; mỗi đơn có đồng hồ đếm ngược (hạn thanh toán hoặc hạn lấy hàng), nhãn "Chat với khách"; cột quy tắc trả trước | Trạng thái `awaiting_payment`, `no_show` và các trường `pay_deadline`, `pickup_deadline` từ mục 2–3; `toUiOrder` phải map thêm `pickupDeadline`, `payDeadline`, `paidAt` |
| Chi tiết đơn | Khối "Tiến trình và hạn xử lý" (4 bước, đếm ngược), **khung chat với khách**, nút Sẵn sàng/Hủy/Xác nhận nhận hàng/Vắng mặt như cũ | `orderSetStatus`, `orderConfirmPickup`, `noShow` gọi `PATCH /orders/:id/status`; chặn hoàn tất quá hạn (`PICKUP_EXPIRED`) |
| Khiếu nại (`pComplaints`) | 4 ô thống kê; khung quy trình; thẻ khiếu nại có hạn phản hồi 12 giờ, ảnh minh chứng, nút Đồng ý hoàn tiền / Voucher / Giải thích / Không đồng ý chuyển Admin; danh sách "đang chờ Admin" và "đã giải quyết" | `POST /orders/complaints/:id/respond` (`accept` / `dispute`); hiển thị `respondBy` từ `response_due_at` |
| Ví · Đối soát (`pWallet`) | Số dư khả dụng, tiền đang giữ chờ, chờ duyệt rút, đã rút, phí nền tảng; sổ giao dịch; nút Rút tiền (chỉ nhập số tiền; tài khoản đã lưu 4 số cuối) | `GET /partner/wallet`, `POST /partner/withdrawals`, `GET /partner/withdrawals` |
| Nhận hàng · QR (mới) | Nhập mã nhận hàng hoặc quét QR, danh sách đơn đang chờ khách đến kèm đếm ngược | Gọi cùng `orderConfirmPickup`; thêm quét camera sau (dùng lại thư viện quét barcode đang có trong trang) |
| Khách hàng (mới) | Khách đã mua, tỷ lệ quay lại, đánh giá, số lần vắng mặt; số điện thoại che một phần | API tổng hợp mới `GET /partner/customers` (chỉ khách đã có đơn ở cửa hàng; che số điện thoại phía server) |
| Khuyến mãi (mới) | Voucher của cửa hàng (bảng `vouchers` đã có `store_id`) | `GET/POST /vouchers` theo cửa hàng; hiện chỉ là giao diện |

Quy tắc hiển thị: đồng hồ đếm ngược chuyển màu xanh → vàng khi còn ≤ 30 phút (hạn lấy hàng) hoặc ≤ 3 giờ (hạn phản hồi khiếu nại) → đỏ khi còn ≤ 15 phút hoặc ≤ 1 giờ; hết hạn hiện "Đã hết hạn". Cập nhật mỗi giây bằng một bộ đếm chung, không tạo timer cho từng dòng.

### 14.3 Chat theo đơn giữa cửa hàng và người mua (MỚI, theo slide "Khung chat để cửa hàng nhắn tin trao đổi trực tiếp với khách hàng")

Đây là tính năng mới, chưa có trong code hiện tại. Thêm vào **Đợt 1** (cùng quy trình đơn), vì chat gắn với vòng đời đơn.

**Quy tắc**
- Mỗi đơn có một cuộc trò chuyện riêng giữa người mua và cửa hàng của đơn đó, mở từ lúc **thanh toán thành công**.
- Cho gửi tin khi đơn ở `confirmed`, `ready` (và `pending` đã thanh toán). Khi đơn `completed`, `cancelled`, `no_show`: **đóng gửi tin**, vẫn xem lại; nếu có khiếu nại thì mở xem cho admin đến khi khiếu nại kết thúc, rồi giữ lưu 30 ngày.
- Chỉ người mua của đơn, nhân viên cửa hàng sở hữu đơn, và admin (chỉ đọc, chỉ khi có khiếu nại hoặc tranh chấp) được xem. Admin không gửi tin vào chat này.
- Chỉ văn bản, tối đa 500 ký tự, giới hạn 20 tin/phút mỗi người gửi. Không gửi ảnh ở bản đầu (ảnh bằng chứng đi qua khiếu nại). Lọc số điện thoại, đường dẫn trong tin nhắn là việc sau, ghi vào HANDOFF.md.
- Thông báo: người mua nhận tin trong chuông và Web Push (đã làm ở mục 9); cửa hàng nhận tin qua Supabase Realtime khi đang mở cổng (chuông + chấm đỏ trên đơn). **Chưa làm push cho cổng cửa hàng** (mục 13 giữ nguyên).
- Tin hệ thống (loại `system`): "Cuộc trò chuyện được mở…", "Đơn đã sẵn sàng", "Đơn đã kết thúc".

**SQL `033_order_messages.sql`** (chạy sau 032)

```sql
create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_role text not null check (sender_role in ('customer','partner','system')),
  body text not null check (char_length(body) between 1 and 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists order_messages_order_idx on public.order_messages(order_id, created_at);
alter table public.order_messages enable row level security;
-- người mua của đơn và chủ cửa hàng của đơn được SELECT; mọi INSERT đi qua API (service role).
create policy order_messages_select_participants on public.order_messages for select using (
  exists (select 1 from public.orders o where o.id = order_id and (
    o.customer_id = auth.uid()
    or exists (select 1 from public.stores s where s.id = o.store_id and s.owner_id = auth.uid())))
);
alter publication supabase_realtime add table public.order_messages;
```

**API**

| Phương thức | Đường dẫn | Vai trò | Mô tả |
|---|---|---|---|
| GET | `/orders/:id/messages` | customer, partner, admin | Lấy tin; kiểm tra quyền; admin chỉ khi đơn có khiếu nại |
| POST | `/orders/:id/messages` | customer, partner | Gửi tin; kiểm tra trạng thái đơn cho phép chat, giới hạn tốc độ; tạo thông báo cho bên kia |
| POST | `/orders/:id/messages/read` | customer, partner | Đánh dấu đã đọc |

Mã lỗi mới: `CHAT_CLOSED`, `CHAT_RATE_LIMITED`, `CHAT_FORBIDDEN`. Tạo `src/services/orderChatService.ts`; tin hệ thống tạo ở `orderService` khi thanh toán, sẵn sàng, kết thúc.

**Giao diện**
- Cửa hàng (v2): ở danh sách đơn có nhãn "Chat với khách" (kèm số tin chưa đọc); ở chi tiết đơn có nút "Nhắn tin cho khách" ở góc trên phải (cuộn tới khung chat) và khung "Trao đổi với …" ngay dưới khối tiến trình, có 3 câu trả lời nhanh ("Hàng đã sẵn sàng, mời bạn đến nhận", "Bạn còn bao lâu nữa đến ạ?", "Cửa hàng sắp đóng cửa, mong bạn đến sớm"), ô nhập, Enter để gửi; khi đơn đã kết thúc chỉ xem lại. Trong demo, bản mẫu dùng biến `CHAT`; thay bằng dữ liệu thật và Realtime.
- Người mua (`FOODSAVE_USER.html`, trong chi tiết đơn): khung chat tương tự, cùng quy tắc mở/đóng; thông báo trong chuông và push.
- Admin (v2): trong hồ sơ khiếu nại ở "Trung tâm khiếu nại" có mục "Lịch sử chat của đơn (bằng chứng)", chỉ đọc.

### 14.4 Cổng admin: màn hình → nguồn dữ liệu thật

| Màn hình v2 | Nội dung | Nối với |
|---|---|---|
| Bảng điều khiển | Thêm dải 5 ô việc cần xử lý: khiếu nại chờ Admin, rút tiền chờ duyệt, tiền giữ chờ, khách bị khóa nhãn đỏ, hồ sơ chờ xác minh; giữ nguyên phần cũ | `GET /admin/complaints?status=in_review`, `GET /admin/finance/summary`, `GET /admin/withdrawals`, API khách bị khóa, API xác minh |
| Trung tâm khiếu nại (`hub`, mới) | Bảng 3 cột: chờ cửa hàng phản hồi, chờ Admin quyết định, đã giải quyết; thẻ có đếm ngược; hồ sơ có lịch sử chat, form quyết định (hoàn đủ / hoàn một phần / bác bỏ) và ô "khiếu nại sai" | `POST /admin/complaints/:id/decision`; khối khiếu nại thật cũ (`cplBlock`) giữ ở cuối trang |
| Tranh chấp (`disputes`) | **Dashboard tổng quan đầu trang**: 5 ô lọc được (Tổng hồ sơ, Mới/đang mở, Đã leo thang, Ưu tiên cao, Đã xử lý), thanh phân bố trạng thái, 3 cửa hàng bị khiếu nại nhiều nhất, danh sách "cần xử lý trước"; bấm ô để lọc bảng bên dưới, bấm dòng/nút "Xử lý" mở bảng chi tiết với các hành động (nhận xử lý, yêu cầu bằng chứng, leo thang, hoàn tiền người dùng, bảo vệ cửa hàng, chia trách nhiệm) | Hiện dùng mảng `DIS` mẫu; nối vào bảng tranh chấp thật (cùng dữ liệu `/orders/complaints/list`); hành động gọi API cập nhật trạng thái |
| Cảnh báo gian lận (`risks`) | **Dashboard tổng quan đầu trang**: 5 ô lọc được (Tổng, Đang mở, Nghiêm trọng ≥ 85, Mức cao 60–84, Theo dõi < 60), thanh phân loại cảnh báo, 3 đối tượng rủi ro cao nhất; bảng có nút "Xử lý" với: điều tra, đóng băng, thử thách, cấm, bỏ qua (báo nhầm) | Hiện dùng mảng `RK` mẫu; nối vào bảng cảnh báo rủi ro thật; hành động ghi nhật ký kiểm toán |
| Tài chính · Sổ cái (`finance`) | 5 ô (escrow, doanh thu nền tảng, quỹ từ thiện, chờ duyệt rút, lệch sổ cái); bảng lệnh rút có nút Duyệt/Từ chối; sổ cái; nút "Chạy đối soát ngay" | Mục 2.4, 3 (SQL 030), API `/admin/finance/summary`, `/admin/ledger`, `/admin/withdrawals` |
| Chính sách nhãn và đơn (`policy`) | Bảng thời hạn theo nhãn (có ô chỉnh), bảng điểm uy tín, quy tắc hạn chế | Bảng cấu hình `order_policy` (mục 3, SQL 029); lưu cấu hình thật khi bấm "Lưu cấu hình" |
| Tự động hóa (`automation`) | Danh sách tác vụ (`label-automation`, `order-automation`, tự chuyển khiếu nại quá hạn, push), lần chạy gần nhất, nút "Chạy ngay", ghi chú `ORDER_POLICY_TIME_SCALE` | `POST /admin/order-automation/run`; thêm bảng nhật ký chạy tác vụ để hiện lần chạy thật |
| Quản lý nhãn (`labels`) | 3 thẻ số lượng Xanh/Vàng/Đỏ, bảng lô hàng theo nhãn | Đếm từ `products`/lô thật |
| Xác minh hồ sơ (`verify`) | Hàng chờ duyệt cửa hàng và tổ chức từ thiện, nút Duyệt/Từ chối | Trạng thái `profiles`/`stores`/hồ sơ tổ chức đã có |
| Khuyến mãi (`vouchers`), Báo cáo ESG (`esg`) | Danh sách voucher; số liệu ESG theo tháng | Bảng `vouchers`; `ECO_IMPACT` đã có |
| Uy tín (`reputation`) | Giữ trang cũ, thêm bảng "Khách bị hạn chế mua nhãn đỏ" có nút Mở khóa | `POST /admin/customers/:id/unlock` |

Thanh bên admin đã được sắp lại theo nhóm: Tổng quan, Người dùng, Đối tác, Kho hàng, Giao dịch, Xử lý vi phạm, Marketing, Hệ thống (xem mã tạo thanh bên trong `admin_v2`). Các mục mới gắn nhãn "new" chỉ để nhận biết khi xem thử, bỏ khi triển khai thật.

### 14.5 Kiểm thử bổ sung (thêm sau kịch bản 18)

19. **Chat:** người mua và cửa hàng gửi/nhận tin của đúng đơn; người khác (khách khác, cửa hàng khác) gọi API đều nhận `CHAT_FORBIDDEN`; sau khi đơn `completed`/`cancelled`/`no_show` gửi tin nhận `CHAT_CLOSED`; gửi quá 20 tin/phút nhận `CHAT_RATE_LIMITED`; admin chỉ đọc được khi đơn có khiếu nại; tin của cửa hàng làm người mua nhận thông báo (chuông + push).
20. **Giao diện cửa hàng:** mở đơn đang xử lý thấy khung chat; đếm ngược đổi màu đúng mốc 14.2; tab "Chờ thanh toán", "Vắng mặt" hiện đúng đơn.
21. **Dashboard Tranh chấp và Cảnh báo gian lận:** số ở các ô khớp số dòng trong bảng sau khi lọc; bấm lại ô thì bỏ lọc; thao tác "Xử lý" đổi trạng thái và cập nhật số liệu ngay.
22. **Không hồi quy giao diện:** đăng nhập, danh sách sản phẩm, thêm/sửa sản phẩm, quyên góp, marketing, AI Agent, khiếu nại thật cũ vẫn hoạt động; không có lỗi trong console ở cả hai cổng.

### 14.6 Thứ tự (bổ sung vào mục 12)

- Đợt 1: thêm SQL `033_order_messages.sql`, `orderChatService`, API chat, khung chat người mua và cửa hàng; giao diện v2 phần Tổng quan, Đơn hàng, Chi tiết đơn, Nhận hàng · QR của cổng cửa hàng.
- Đợt 2: Ví (cửa hàng), Tài chính · Sổ cái (admin).
- Đợt 3: Khiếu nại (cửa hàng), Trung tâm khiếu nại và dashboard Tranh chấp (admin), lịch sử chat trong hồ sơ khiếu nại.
- Đợt 4: Chính sách, Tự động hóa, Quản lý nhãn, Xác minh hồ sơ, Khuyến mãi, ESG, dashboard Cảnh báo gian lận, Khách bị hạn chế; sau cùng chạy kịch bản 19–22.

## 15. Chuyển từ mô phỏng sang thanh toán và chi trả THẬT

Phiên bản hiện tại vẫn là **mô phỏng**: không có tiền thật chạy qua, không nối MoMo hay ngân hàng. Hệ thống được xây để sau này chỉ cần thay hai lớp nhà cung cấp, phần nghiệp vụ (đơn, sổ cái, ví, rút tiền) giữ nguyên.

### 15.1 Kiến trúc hai lớp nhà cung cấp
| Lớp | Biến môi trường | Mặc định | Có sẵn | Ghi chú |
|---|---|---|---|---|
| Thu tiền `PaymentProvider` (`src/services/payments/`) | `PAYMENT_PROVIDER` | `simulated` | `SimulatedPaymentProvider` (nút "Đã thanh toán"); `MomoPaymentProvider` là KHUNG chưa gọi mạng (ném lỗi `PROVIDER_NOT_CONFIGURED`) | Giao diện: `createPayment`, `verifyCallback`, `refund`, `getStatus` |
| Chi trả `PayoutProvider` (`src/services/payouts/`) | `PAYOUT_PROVIDER` | `manual` | `ManualPayoutProvider` (admin chuyển khoản tay rồi bấm "Đã chi"); `BankApiPayoutProvider` là KHUNG chưa nối | Giao diện: `createPayout`, `getPayoutStatus` |

- Thanh toán thành công của mọi nhà cung cấp đi qua MỘT hàm `orderService.markPaid` (hạn lấy hàng, sổ cái, thông báo, chat). Webhook thật: `POST /api/v1/payments/webhook/:provider` (kiểm tra chữ ký trong provider, chống trùng theo `payment_events`, kiểm tra khớp số tiền, thanh toán đến muộn thì tự gọi `refund`). Provider mô phỏng không có webhook: endpoint trả 404. Khi PAYMENT_PROVIDER là cổng thật, người mua **không** tự bấm "Đã thanh toán" được (`PAYMENT_REQUIRES_PROVIDER`).
- Webhook MoMo giả cũ `/orders/payments/momo/webhook/mock` (không chữ ký) chỉ chạy khi `DEMO_MODE=true`.
- Mã tham chiếu nhà cung cấp lưu ở `orders.payment_provider`, `orders.payment_ref` (SQL 034).

### 15.2 Vòng đời lệnh rút (SQL 035)
`requested → approved → processing → paid`, hoặc `rejected` / `failed`. Mỗi bước ghi người thực hiện và thời gian (`approved_by/at`, `processing_by/at`, `paid_by/at`, `failed_by/at`). **Chỉ `paid` mới trừ ví** (bút toán `withdraw`, khóa `withdrawal:<id>`) và bắt buộc có mã giao dịch ngân hàng; `rejected` / `failed` không mất tiền: số dư khả dụng (= số dư − lệnh `requested/approved/processing`) tự được trả lại. Mọi bước idempotent (lặp lại hoặc đồng thời không trừ ví hai lần). Tối thiểu rút 50.000đ.

### 15.3 Tài khoản nhận tiền
- Bảng `store_payout_accounts`: số đầy đủ chỉ nằm ở `account_number_encrypted` (AES-256-GCM, khóa `PAYOUT_ENCRYPTION_KEY`, định dạng `v1:iv:tag:ciphertext`). RLS bật, không policy: trình duyệt không đọc được. Mọi API chỉ trả `bank_name`, `account_holder_name`, `account_last4`.
- Chỉ admin, khi chi trả một lệnh đã duyệt, xem được số đầy đủ; mỗi lần ghi `payout_access_log` (ai, khi nào, lệnh nào) **trước** khi giải mã (ghi nhật ký lỗi thì không giải mã). Không giải mã cho cửa hàng.
- Đổi tài khoản: bản cũ thành `replaced`, bản mới `pending_verification`; chưa `verified` thì không tạo được lệnh rút. Admin xác minh kèm đối chiếu tên chủ tài khoản với tên đăng ký kinh doanh (`partner_profiles.legal_name`); lệch thì đánh dấu `name_mismatch` và bắt buộc ghi chú.
- Đăng ký cửa hàng: số đầy đủ gửi qua `POST /partner/payout-account` (mã hóa ngay ở backend); hồ sơ, đơn đăng ký và metadata chỉ giữ dạng che (••••6789).

### 15.4 Các bước chuyển sang thanh toán thật (MoMo)
1. Đăng ký tài khoản merchant MoMo, ký hợp đồng, lấy khóa **sandbox** (`MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`).
2. Điền `MomoPaymentProvider` (`createPayment`, `verifyCallback` dựng chuỗi ký IPN theo tài liệu MoMo dùng `hmacSha256Hex` + `safeEqualHex`, `refund`, `getStatus`).
3. Đặt biến môi trường trên Netlify (bản thử), đăng ký URL IPN `https://<tên-site>/api/v1/payments/webhook/momo` với MoMo.
4. Kiểm thử sandbox: thanh toán thành công, thất bại, webhook trùng, sai chữ ký, lệch số tiền, thanh toán đến sau khi đơn hết hạn (phải tự hoàn), hoàn tiền, hủy trong hạn.
5. Chỉ khi đạt hết mới đặt `PAYMENT_PROVIDER=momo` ở môi trường thật. Quay lại mô phỏng bất cứ lúc nào bằng `PAYMENT_PROVIDER=simulated`.
6. Chi trả thật: giữ `PAYOUT_PROVIDER=manual` cho đến khi có hợp đồng và API chuyển tiền của ngân hàng; điền `BankApiPayoutProvider.createPayout` (nhận số đầy đủ qua đường giải mã có nhật ký), kiểm thử sandbox ngân hàng, rồi đặt `PAYOUT_PROVIDER=bank_api`.
7. **Đối soát hằng ngày:** (a) trang Admin → Tài chính → "Chạy đối soát ngay" (tổng số dư mọi ví = 0); (b) đối chiếu tổng bút toán `charge` trong ngày với sao kê / báo cáo của MoMo, và các lệnh `paid` với sao kê ngân hàng; (c) kiểm tra `payment_events` có dòng `rejected` (lệch tiền) hoặc `received` treo (webhook chưa xử lý xong); (d) kiểm tra `order_events` loại `provider_refund_failed` (hoàn tiền qua cổng thất bại, phải xử lý tay).
8. **Lệnh `failed`:** admin ghi lý do; số tiền vẫn còn trong ví cửa hàng; cửa hàng sửa tài khoản nhận tiền (cần xác minh lại) rồi gửi lệnh mới. Nếu ngân hàng báo hoàn tiền SAU khi lệnh đã `paid`, cần bút toán điều chỉnh thủ công (`adjustment`), hiện CHƯA có giao diện cho việc này.

### 15.5 Việc phải làm trước khi vận hành tiền thật
- Giữ hộ tiền khách (escrow) và chi cho đối tác có thể thuộc hoạt động trung gian thanh toán cần giấy phép: **tham vấn pháp lý và nhà cung cấp cổng thanh toán** về mô hình trước khi bật. Tài liệu này không phải tư vấn pháp lý.
- Khóa mã hóa: lưu bản sao ở nơi an toàn (mất khóa = mất khả năng đọc số tài khoản đã mã hóa), đặt lịch xoay khóa, không bao giờ commit.
- `verifyCallback` của MoMo CHƯA được kiểm thử với MoMo thật; chỉ cơ chế chữ ký, chống trùng, hoàn tiền muộn được kiểm bằng nhà cung cấp thử trong bộ test.
