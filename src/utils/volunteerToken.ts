import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../config/env";

// Tình nguyện viên đăng nhập bằng số điện thoại (không có tài khoản Supabase),
// nên dùng token tự ký (HMAC) có hạn dùng thay cho phiên Supabase.
const TOKEN_TTL_SECONDS = 12 * 60 * 60;

interface VolunteerTokenPayload {
  vid: string;
  cid: string;
  exp: number;
}

const secret = (): string => `foodsave-volunteer:${env.SUPABASE_SERVICE_ROLE_KEY}`;

const sign = (body: string): string => createHmac("sha256", secret()).update(body).digest("base64url");

export const createVolunteerToken = (volunteerId: string, charityId: string): string => {
  const payload: VolunteerTokenPayload = {
    vid: volunteerId,
    cid: charityId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
};

export const verifyVolunteerToken = (token: string): VolunteerTokenPayload | null => {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as VolunteerTokenPayload;
    if (!payload.vid || !payload.cid || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
};
