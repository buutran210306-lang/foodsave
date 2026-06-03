import type { Session, User } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type {
  LoginBody,
  PasswordResetBody,
  RegisterCharityBody,
  RegisterCustomerBody,
  RegisterPartnerBody
} from "../schemas/authSchemas";
import type { Profile, UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { handleSupabaseError } from "./supabaseService";

type AuthAuditEvent =
  | "REGISTER_SUCCESS"
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "TOKEN_REFRESH"
  | "PASSWORD_RESET_REQUESTED";

interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

interface AuthContext {
  store: unknown | null;
  charity: unknown | null;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    phone: string;
    created_at: string;
  };
  profile: Profile;
  session: {
    access_token: string;
    refresh_token: string;
    expires_at: number | null;
    token_type: string;
  };
  context: AuthContext;
}

const normalizePhone = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }
  return trimmed.replace(/\D/g, "");
};

const phoneLoginCandidates = (value: string): string[] => {
  const normalized = normalizePhone(value);
  const withoutPlus = normalized.startsWith("+") ? normalized.slice(1) : normalized;
  const candidates = new Set<string>([value.trim(), normalized]);

  if (withoutPlus.startsWith("84")) {
    candidates.add(`+${withoutPlus}`);
  }

  if (withoutPlus.startsWith("0") && withoutPlus.length >= 10) {
    candidates.add(`+84${withoutPlus.slice(1)}`);
  }

  if (!withoutPlus.startsWith("0") && !withoutPlus.startsWith("84") && withoutPlus.length >= 9) {
    candidates.add(`+84${withoutPlus}`);
  }

  return Array.from(candidates).filter(Boolean);
};

const slugify = (value: string): string => {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

  return slug.length > 0 ? slug : "foodsave";
};

const uniqueSlug = (name: string): string => {
  return `${slugify(name)}-${randomUUID().slice(0, 8)}`;
};

const compactObject = (value: Record<string, unknown>): Record<string, unknown> => {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
};

const authError = (message: string, statusCode = HTTP_STATUS.UNAUTHORIZED, code = ERROR_CODES.AUTH_INVALID_TOKEN): AppError => {
  return new AppError(message, statusCode, code);
};

const writeAuditLog = async (
  eventType: AuthAuditEvent,
  userId: string | null,
  role: UserRole | null,
  meta: RequestMeta,
  metadata: Record<string, unknown> = {}
): Promise<void> => {
  const { error } = await supabaseAdmin.from("auth_audit_logs").insert({
    user_id: userId,
    role,
    event_type: eventType,
    ip_address: meta.ipAddress,
    user_agent: meta.userAgent,
    metadata
  });

  if (error) {
    logger.warn("Không thể ghi auth audit log", error);
  }
};

const loadProfile = async (userId: string): Promise<Profile> => {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw authError("Không tìm thấy hồ sơ người dùng", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
  }

  return data as Profile;
};

const loadContext = async (userId: string, role: UserRole): Promise<AuthContext> => {
  if (role === "partner") {
    const { data, error } = await supabaseAdmin
      .from("stores")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) handleSupabaseError(error, "Failed to load partner store context");
    return {
      store: (data ?? [])[0] ?? null,
      charity: null
    };
  }

  if (role === "charity") {
    const { data, error } = await supabaseAdmin
      .from("charity_profiles")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) handleSupabaseError(error, "Failed to load charity profile context");
    return {
      store: null,
      charity: (data ?? [])[0] ?? null
    };
  }

  return {
    store: null,
    charity: null
  };
};

const buildAuthResult = async (user: User, session: Session): Promise<AuthResult> => {
  const profile = await loadProfile(user.id);
  const context = await loadContext(user.id, profile.role);

  return {
    user: {
      id: user.id,
      email: user.email ?? "",
      phone: user.phone ?? "",
      created_at: user.created_at ?? ""
    },
    profile,
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? null,
      token_type: session.token_type
    },
    context
  };
};

const resolveEmailFromIdentifier = async (identifier: string): Promise<string> => {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) return trimmed.toLowerCase();

  const candidates = phoneLoginCandidates(trimmed);
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .in("phone", candidates);

  if (error) handleSupabaseError(error, "Failed to resolve login phone");
  if (!data || data.length === 0) {
    throw authError("Email, số điện thoại hoặc mật khẩu không chính xác");
  }

  const email = (data[0] as { email: string | null }).email;
  if (!email) {
    throw authError("Tài khoản này chưa có email đăng nhập hợp lệ");
  }

  return email;
};

const createAuthUser = async (
  role: UserRole,
  email: string,
  password: string,
  fullName: string,
  phone: string,
  extraMetadata: Record<string, unknown>
): Promise<User> => {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role,
      full_name: fullName,
      phone,
      terms_accepted: true,
      ...extraMetadata
    }
  });

  if (error || !data.user) {
    const message = error?.message.toLowerCase().includes("already") ? "Email đã được đăng ký" : "Không thể tạo tài khoản";
    const status = error?.message.toLowerCase().includes("already") ? HTTP_STATUS.CONFLICT : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    throw new AppError(message, status, status === HTTP_STATUS.CONFLICT ? ERROR_CODES.RESOURCE_CONFLICT : ERROR_CODES.INTERNAL_SERVER_ERROR);
  }

  return data.user;
};

const signInWithEmailPassword = async (email: string, password: string): Promise<{ user: User; session: Session }> => {
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

  if (error || !data.user || !data.session) {
    throw authError("Email, số điện thoại hoặc mật khẩu không chính xác");
  }

  return {
    user: data.user,
    session: data.session
  };
};

const updateLastLogin = async (userId: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) handleSupabaseError(error, "Failed to update last login");
};

const upsertProfile = async (
  userId: string,
  role: UserRole,
  email: string,
  fullName: string,
  phone: string,
  status: "active" | "pending",
  metadata: Record<string, unknown>,
  marketingOptIn = false
): Promise<void> => {
  const { error } = await supabaseAdmin.from("profiles").upsert({
    id: userId,
    role,
    email,
    full_name: fullName,
    phone,
    status,
    marketing_opt_in: marketingOptIn,
    terms_accepted_at: new Date().toISOString(),
    metadata
  });

  if (error) handleSupabaseError(error, "Failed to upsert auth profile");
};

const deleteCreatedUser = async (userId: string | null): Promise<void> => {
  if (!userId) return;

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    logger.error("Không thể xóa Auth user sau lỗi đăng ký", error);
  }
};

export const authService = {
  async registerCustomer(body: RegisterCustomerBody, meta: RequestMeta): Promise<AuthResult> {
    let createdUserId: string | null = null;
    const phone = normalizePhone(body.phone);

    try {
      const user = await createAuthUser("customer", body.email, body.password, body.full_name, phone, {
        marketing_opt_in: body.marketing_opt_in
      });
      createdUserId = user.id;

      await upsertProfile(user.id, "customer", body.email, body.full_name, phone, "active", compactObject({
        date_of_birth: body.date_of_birth,
        gender: body.gender,
        referral_code: body.referral_code,
        registration_source: "FOODSAVE_USER.html"
      }), body.marketing_opt_in);

      await writeAuditLog("REGISTER_SUCCESS", user.id, "customer", meta, { channel: "customer" });

      return authService.login({
        identifier: body.email,
        password: body.password,
        expected_role: "customer"
      }, meta);
    } catch (error) {
      await deleteCreatedUser(createdUserId);
      throw error;
    }
  },

  async registerPartner(body: RegisterPartnerBody, meta: RequestMeta): Promise<AuthResult> {
    let createdUserId: string | null = null;
    const phone = normalizePhone(body.phone);

    try {
      const user = await createAuthUser("partner", body.email, body.password, body.representative_name, phone, {
        business_type: body.business_type,
        store_name: body.store_name
      });
      createdUserId = user.id;

      await upsertProfile(user.id, "partner", body.email, body.representative_name, phone, "pending", compactObject({
        registration_source: "FOODSAVE_PARTNER.html",
        business_type: body.business_type,
        store_name: body.store_name,
        tax_code: body.tax_code,
        business_license_number: body.business_license_number
      }));

      const { data: store, error: storeError } = await supabaseAdmin
        .from("stores")
        .insert({
          owner_id: user.id,
          name: body.store_name,
          slug: uniqueSlug(body.store_name),
          address: body.address,
          district: body.district ?? null,
          city: body.city,
          status: "pending",
          service_tier: "Starter",
          opening_hours: "06:00-21:00"
        })
        .select("*")
        .single();

      if (storeError) handleSupabaseError(storeError, "Failed to create partner store");
      if (!store) {
        throw new AppError("Không thể tạo hồ sơ cửa hàng", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }

      const { error: reputationError } = await supabaseAdmin.from("seller_reputation").insert({
        seller_id: (store as { id: string }).id
      });

      if (reputationError) handleSupabaseError(reputationError, "Failed to create seller reputation");

      const { error: applicationError } = await supabaseAdmin.from("applications").insert({
        user_id: user.id,
        type: "partner",
        org_name: body.store_name,
        contact_name: body.representative_name,
        email: body.email,
        phone,
        status: "pending",
        payload: compactObject({
          store_id: (store as { id: string }).id,
          business_type: body.business_type,
          address: body.address,
          district: body.district,
          city: body.city,
          representative_name: body.representative_name,
          business_license_number: body.business_license_number,
          tax_code: body.tax_code,
          bank_name: body.bank_name,
          bank_account_number: body.bank_account_number,
          bank_account_holder: body.bank_account_holder
        })
      });

      if (applicationError) handleSupabaseError(applicationError, "Failed to create partner application");

      await writeAuditLog("REGISTER_SUCCESS", user.id, "partner", meta, { channel: "partner", store_id: (store as { id: string }).id });

      return authService.login({
        identifier: body.email,
        password: body.password,
        expected_role: "partner"
      }, meta);
    } catch (error) {
      await deleteCreatedUser(createdUserId);
      throw error;
    }
  },

  async registerCharity(body: RegisterCharityBody, meta: RequestMeta): Promise<AuthResult> {
    let createdUserId: string | null = null;
    const phone = normalizePhone(body.phone);

    try {
      const user = await createAuthUser("charity", body.email, body.password, body.representative_name, phone, {
        organization_type: body.organization_type,
        organization_name: body.organization_name
      });
      createdUserId = user.id;

      await upsertProfile(user.id, "charity", body.email, body.representative_name, phone, "pending", compactObject({
        registration_source: "FOODSAVE_CHARITY.html",
        organization_type: body.organization_type,
        organization_name: body.organization_name,
        representative_title: body.representative_title
      }));

      const { data: charity, error: charityError } = await supabaseAdmin
        .from("charity_profiles")
        .insert({
          owner_id: user.id,
          name: body.organization_name,
          slug: uniqueSlug(body.organization_name),
          phone,
          email: body.email,
          address: body.address,
          district: body.district ?? null,
          city: body.city,
          beneficiaries_count: body.beneficiaries_count,
          status: "pending"
        })
        .select("*")
        .single();

      if (charityError) handleSupabaseError(charityError, "Failed to create charity profile");
      if (!charity) {
        throw new AppError("Không thể tạo hồ sơ tổ chức từ thiện", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }

      const { error: applicationError } = await supabaseAdmin.from("applications").insert({
        user_id: user.id,
        type: "charity",
        org_name: body.organization_name,
        contact_name: body.representative_name,
        email: body.email,
        phone,
        status: "pending",
        payload: compactObject({
          charity_id: (charity as { id: string }).id,
          organization_type: body.organization_type,
          representative_title: body.representative_title,
          beneficiaries_count: body.beneficiaries_count,
          meals_per_day: body.meals_per_day,
          volunteer_count: body.volunteer_count,
          service_radius_km: body.service_radius_km,
          address: body.address,
          district: body.district,
          city: body.city
        })
      });

      if (applicationError) handleSupabaseError(applicationError, "Failed to create charity application");

      await writeAuditLog("REGISTER_SUCCESS", user.id, "charity", meta, { channel: "charity", charity_id: (charity as { id: string }).id });

      return authService.login({
        identifier: body.email,
        password: body.password,
        expected_role: "charity"
      }, meta);
    } catch (error) {
      await deleteCreatedUser(createdUserId);
      throw error;
    }
  },

  async login(body: LoginBody, meta: RequestMeta): Promise<AuthResult> {
    let resolvedEmail = "";
    let failureAudited = false;

    try {
      resolvedEmail = await resolveEmailFromIdentifier(body.identifier);
      const { user, session } = await signInWithEmailPassword(resolvedEmail, body.password);
      const profile = await loadProfile(user.id);

      if (body.expected_role && profile.role !== body.expected_role) {
        await writeAuditLog("LOGIN_FAILED", user.id, profile.role, meta, {
          reason: "ROLE_MISMATCH",
          expected_role: body.expected_role
        });
        failureAudited = true;
        throw new AppError("Tài khoản không thuộc đúng cổng đăng nhập", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
      }

      if (profile.status === "suspended") {
        await writeAuditLog("LOGIN_FAILED", user.id, profile.role, meta, { reason: "SUSPENDED" });
        failureAudited = true;
        throw new AppError("Tài khoản đã bị tạm khóa", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
      }

      await updateLastLogin(user.id);
      await writeAuditLog("LOGIN_SUCCESS", user.id, profile.role, meta, { expected_role: body.expected_role ?? null });

      return buildAuthResult(user, session);
    } catch (error) {
      if (!failureAudited) {
        await writeAuditLog("LOGIN_FAILED", null, body.expected_role ?? null, meta, {
          identifier: resolvedEmail || body.identifier,
          reason: error instanceof AppError ? error.code : "AUTH_PROVIDER_ERROR"
        });
      }

      throw error;
    }
  },

  async refreshSession(body: { refresh_token: string }, meta: RequestMeta): Promise<AuthResult> {
    const { data, error } = await supabaseAuth.auth.refreshSession({
      refresh_token: body.refresh_token
    });

    if (error || !data.user || !data.session) {
      throw authError("Refresh token không hợp lệ hoặc đã hết hạn");
    }

    const profile = await loadProfile(data.user.id);
    await writeAuditLog("TOKEN_REFRESH", data.user.id, profile.role, meta);

    return buildAuthResult(data.user, data.session);
  },

  async requestPasswordReset(body: PasswordResetBody, meta: RequestMeta): Promise<{ sent: true }> {
    let email = "";

    try {
      email = await resolveEmailFromIdentifier(body.identifier);
    } catch (error) {
      await writeAuditLog("PASSWORD_RESET_REQUESTED", null, null, meta, {
        identifier: body.identifier,
        result: "ACCOUNT_NOT_DISCLOSED"
      });
      return { sent: true };
    }

    const { error } = await supabaseAuth.auth.resetPasswordForEmail(email, {
      redirectTo: env.PASSWORD_RESET_REDIRECT_URL
    });

    if (error) {
      throw new AppError("Không thể gửi email đặt lại mật khẩu", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }

    await writeAuditLog("PASSWORD_RESET_REQUESTED", null, null, meta, { email });
    return { sent: true };
  },

  async logout(accessToken: string, userId: string, role: UserRole, meta: RequestMeta): Promise<{ revoked: true }> {
    const { error } = await supabaseAdmin.auth.admin.signOut(accessToken, "local");

    if (error) {
      throw new AppError("Không thể đăng xuất phiên hiện tại", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }

    await writeAuditLog("LOGOUT", userId, role, meta);
    return { revoked: true };
  }
};
