import type { User } from "@supabase/supabase-js";
import type { Profile } from "./domain";
import type { ValidatedRequestData } from "./api";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      profile?: Profile;
      validated?: ValidatedRequestData;
    }
  }
}

export {};
