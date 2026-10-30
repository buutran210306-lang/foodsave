-- ============================================================================
-- 036_admin_ops.sql  (Đợt 4b)
-- Làm gì: thêm 4 bảng cho Admin + 2 cột duyệt hồ sơ tổ chức:
--   order_policy_config  : cấu hình chính sách đơn (1 dòng id=1) để Admin chỉnh trên giao diện
--   admin_audit_log      : nhật ký thao tác của Admin (ai, làm gì, lúc nào)
--   automation_runs      : lịch sử chạy các tác vụ tự động (lần chạy gần nhất, lỗi)
--   fraud_alert_status   : trạng thái xử lý cảnh báo gian lận (cảnh báo tự tính, chỉ lưu trạng thái)
--   charity_profiles.rejection_reason / reviewed_at : lý do + thời điểm duyệt tổ chức
-- Chạy lại nhiều lần không sao (if not exists). KHÔNG cần sao lưu: chỉ thêm bảng/cột mới, không đổi dữ liệu cũ.
-- Hoàn tác (chỉ khi cần):
--   drop table if exists public.fraud_alert_status, public.automation_runs, public.admin_audit_log, public.order_policy_config;
--   alter table public.charity_profiles drop column if exists rejection_reason, drop column if exists reviewed_at;
-- ============================================================================

create table if not exists public.order_policy_config (
  id integer primary key default 1 check (id = 1),
  config jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_log_action_idx on public.admin_audit_log(action, created_at desc);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  trigger text not null default 'schedule',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null default true,
  summary jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists automation_runs_job_idx on public.automation_runs(job, started_at desc);

create table if not exists public.fraud_alert_status (
  alert_key text primary key,
  status text not null default 'handled' check (status in ('handled', 'dismissed')),
  note text,
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz not null default now()
);

alter table public.charity_profiles
  add column if not exists rejection_reason text,
  add column if not exists reviewed_at timestamptz;

-- Chỉ backend (service role) đọc/ghi; không mở quyền cho client
alter table public.order_policy_config enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.automation_runs enable row level security;
alter table public.fraud_alert_status enable row level security;
