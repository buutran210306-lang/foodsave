-- 019: Ảnh minh chứng của tổ chức từ thiện sau khi nhận hàng
-- Chạy SAU file 018.
-- Tổ chức gửi 1 đến 3 ảnh và ghi chú cho lô đã hoàn thành; cửa hàng và Admin xem được.

alter table public.donations
  add column if not exists proof_photo_urls text[] not null default '{}',
  add column if not exists proof_note text,
  add column if not exists proof_submitted_at timestamptz;

-- Kho ảnh minh chứng: đọc công khai (chỉ là ảnh thực phẩm đã phát), ghi qua link tải do backend cấp
insert into storage.buckets (id, name, public)
values ('donation-proofs', 'donation-proofs', true)
on conflict (id) do update set public = true;
