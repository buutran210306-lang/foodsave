-- 037: Thiết bị nhận thông báo đẩy cho biết đang dùng WEB hay APP người mua (để bấm thông báo mở đúng trang). Chạy SAU 032. Chạy lại nhiều lần không lỗi.
--
-- Làm gì: thêm cột push_subscriptions.client ('web' | 'app'), mặc định 'web'. Dòng cũ giữ nguyên là 'web'.
-- Chưa chạy tệp này thì mọi thứ vẫn chạy: thông báo vẫn gửi được, chỉ là bấm vào sẽ mở bản web (FOODSAVE_USER.html).
-- Không cần sao lưu. Quay lại (nếu cần): alter table public.push_subscriptions drop column if exists client;

alter table public.push_subscriptions add column if not exists client text not null default 'web';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'push_client_check') then
    alter table public.push_subscriptions add constraint push_client_check check (client in ('web', 'app'));
  end if;
end $$;
