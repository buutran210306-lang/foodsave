alter type public.auth_audit_event add value if not exists 'PHONE_OTP_SENT';
alter type public.auth_audit_event add value if not exists 'PHONE_OTP_VERIFIED';
alter type public.auth_audit_event add value if not exists 'PHONE_OTP_FAILED';
