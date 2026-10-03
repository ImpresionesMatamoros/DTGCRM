// Draft only — NOT deployed by STEP 10. Requires verify_jwt = true.
// Secrets (function env, never in index.html):
//   PRODUCT_ENGINE_BASE_URL   e.g. https://pe.example.com   (https, or http://localhost for dev)
//   PRODUCT_ENGINE_API_TOKEN  one of the PE's PRODUCT_ENGINE_API_TOKENS
//   PRODUCT_ENGINE_TIMEOUT_MS optional, 200..10000 (default 4000)
// The CRM keeps working with this function missing, misconfigured or timing out:
// the product picker degrades to manual entry (see STEP_10_AUTH_NETWORK_ADR.md).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handle } from "./handler.js";

Deno.serve((req: Request) =>
  handle(req, {
    env: Deno.env.toObject(),
    verifyUser: async (token: string) => {
      const url = Deno.env.get("SUPABASE_URL");
      const anon = Deno.env.get("SUPABASE_ANON_KEY");
      if(Deno.env.get("DTG_ENVIRONMENT")!=="staging" || url!=="https://"+Deno.env.get("STAGING_CRM_PROJECT_REF")+".supabase.co")return false;
      if (!url || !anon) return false;
      const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data, error } = await sb.auth.getUser(token);
      if (error || !data.user) return false;
      const active = await sb.rpc("is_active_member");
      return !active.error && active.data === true;
    },
  }),
);
