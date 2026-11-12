// Trattoria 57 — "Alexa, food ready" → every staff tablet shows "🔔 Table 3 — food ready".
// Called by Voice Monkey: GET .../functions/v1/t57-ready?k=<secret code>&t=<table number>
// The secret code is made in the app: ⭐ Manager → Kitchen Alexa → Make secret code.
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const k = u.searchParams.get("k") ?? "";
  const t = (u.searchParams.get("t") ?? "").toString().trim().toLowerCase().replace(/^table\s*/, "").replace(/\s+/g, "");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cfg } = await sb.from("t57_docs").select("data").eq("coll", "alexa").eq("id", "main").maybeSingle();
  const key = cfg?.data?.readyKey ?? "";
  if (!key || k !== key) return new Response("not allowed", { status: 403 });
  if (!/^[a-z0-9]{1,4}$/.test(t)) return new Response("which table?", { status: 400 });
  const id = "ready" + Date.now().toString(36);
  const { error } = await sb.from("t57_docs").insert({ coll: "calls", id, data: { tname: t, what: "ready", at: Date.now(), done: false } });
  if (error) return new Response("error: " + error.message, { status: 500 });
  return new Response("Table " + t + " — food ready sent", { status: 200 });
});
