// Draft only. Requires verify_jwt=true and OPENAI_API_KEY in function secrets.
// Invoked by the author after the audio and message exist; the audio remains
// usable even if this function is unavailable.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!token || !url || !anon) return reply({ error: "Unauthorized" }, 401);
  if (!apiKey) return reply({ error: "Transcription not configured" }, 503);
  const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: auth, error: authError } = await sb.auth.getUser(token);
  if (authError || !auth.user) return reply({ error: "Unauthorized" }, 401);
  let postId: string;
  try { postId = String((await req.json()).postId || ""); } catch { return reply({ error: "Invalid JSON" }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return reply({ error: "Invalid message ID" }, 400);
  const { data: post, error: readError } = await sb.from("team_posts")
    .select("id,author_user_id,conversation_id,audio_storage_path,audio_mime")
    .eq("id", postId).is("deleted_at", null).single();
  if (readError || !post || post.author_user_id !== auth.user.id || !post.audio_storage_path)
    return reply({ error: "Message unavailable" }, 404);
  const expectedPrefix = (post.conversation_id || "team") + "/";
  if (!post.audio_storage_path.startsWith(expectedPrefix))
    return reply({ error: "Invalid audio path" }, 400);
  const { data: file, error: storageError } = await sb.storage.from("chat-private").download(post.audio_storage_path);
  if (storageError || !file) return reply({ error: "Audio unavailable" }, 404);
  if (file.size > 25 * 1024 * 1024) return reply({ error: "Audio too large" }, 413);
  const mime = post.audio_mime || file.type || "audio/webm";
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("file", new File([file], `message.${ext}`, { type: mime }));
  // No language parameter: Spanish and English remain in their spoken language.
  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form,
    });
    if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
    const result = await res.json();
    const transcript = typeof result.text === "string" ? result.text.slice(0, 50000) : "";
    if (!transcript) throw new Error("Empty transcript");
    const { error: updateError } = await sb.from("team_posts").update({
      transcript, transcript_status: "ready",
    }).eq("id", postId).eq("author_user_id", auth.user.id);
    if (updateError) throw updateError;
    return reply({ status: "ready" });
  } catch (error) {
    await sb.from("team_posts").update({ transcript_status: "failed" })
      .eq("id", postId).eq("author_user_id", auth.user.id);
    console.error("Transcription failed", error instanceof Error ? error.message : "unknown error");
    return reply({ error: "Transcription unavailable; audio retained" }, 502);
  }
});
