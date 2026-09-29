import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function b64u(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decodeB64u(s: string) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
async function generateVapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const x = decodeB64u(jwk.x!);
  const y = decodeB64u(jwk.y!);
  const pub = new Uint8Array(65); pub[0] = 4; pub.set(x, 1); pub.set(y, 33);
  const webhook = new Uint8Array(32); crypto.getRandomValues(webhook);
  return { publicKey: b64u(pub), privateKey: jwk.d!, webhookSecret: b64u(webhook) };
}
async function config() {
  const { data, error } = await admin.rpc("push_delivery_config");
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
async function ensureConfig() {
  let cfg = await config();
  if (cfg?.vapid_public && cfg?.vapid_private && cfg?.webhook_secret) return cfg;
  const g = await generateVapid();
  const functionUrl = SUPABASE_URL + "/functions/v1/push-fanout";
  const subject = "mailto:admin@designtogo.mx";
  const { error } = await admin.rpc("push_initialize_config", {
    p_webhook_secret: g.webhookSecret,
    p_vapid_public: g.publicKey,
    p_vapid_private: g.privateKey,
    p_vapid_subject: subject,
    p_function_url: functionUrl
  });
  if (error) throw error;
  await admin.from("app_settings").upsert({ key: "push_vapid_public", values: [g.publicKey] }, { onConflict: "key" });
  const current = await admin.from("app_settings").select("key").eq("key", "chat_unread_baseline").maybeSingle();
  if (!current.data) await admin.from("app_settings").insert({ key: "chat_unread_baseline", values: [new Date().toISOString()] });
  return await config();
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const cfg = await ensureConfig();

    if (body?.init === true) {
      return Response.json({ ok: true, initialized: true, vapidPublic: cfg.vapid_public });
    }

    const supplied = req.headers.get("x-dtg-secret") || "";
    if (!cfg?.webhook_secret || supplied !== cfg.webhook_secret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const postId = body?.record?.id;
    if (!postId) return new Response("Missing post id", { status: 400 });

    const { data: targets, error: targetsError } = await admin.rpc("push_targets_for_post", { p_post_id: postId });
    if (targetsError) throw targetsError;
    if (!targets?.length) return Response.json({ ok: true, delivered: 0 });

    webpush.setVapidDetails(cfg.vapid_subject || "mailto:admin@designtogo.mx", cfg.vapid_public, cfg.vapid_private);

    let delivered = 0, removed = 0, failed = 0;
    for (const t of targets) {
      const { data: unreadData } = await admin.rpc("chat_unread_count_for_user", { p_user_id: t.user_id });
      const unread = Number(unreadData || 0);
      const kind = t.es_mencion ? "mencion" : t.es_equipo ? "equipo" : "mensaje";
      const payload = JSON.stringify({
        postId,
        autor: t.autor || "Equipo",
        cuerpo: t.cuerpo || (kind === "mensaje" ? "Nuevo mensaje" : ""),
        kind,
        unread,
        url: "./?chat_post=" + encodeURIComponent(postId)
      });
      try {
        await webpush.sendNotification({
          endpoint: t.endpoint,
          keys: { p256dh: t.p256dh, auth: t.auth }
        }, payload, { TTL: 60 * 60 * 12, urgency: kind === "mencion" || kind === "equipo" ? "high" : "normal" });
        delivered++;
        await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq("endpoint", t.endpoint);
      } catch (err: any) {
        const status = Number(err?.statusCode || err?.status || 0);
        if (status === 404 || status === 410) {
          removed++;
          await admin.from("push_subscriptions").delete().eq("endpoint", t.endpoint);
        } else {
          failed++;
          await admin.rpc("push_note_failure", { p_endpoint: t.endpoint }).catch(() => null);
        }
      }
    }
    return Response.json({ ok: true, delivered, removed, failed });
  } catch (err) {
    console.error("[push-fanout]", err);
    return Response.json({ ok: false, error: String((err as Error)?.message || err) }, { status: 500 });
  }
});
