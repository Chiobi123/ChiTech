// ChiiTech ai-assist Edge Function — LLM prose over deterministic figures.
// Secrets (GROQ_API_KEY, AI_MODEL, AI_BASE_URL, AI_MAX_PER_DAY) live as
// Supabase secrets; nothing secret ever reaches the browser or repo.
// Auth: caller JWT verified by the platform (verify_jwt) + membership
// re-checked here against profiles. service_role callers (platform tests)
// pass an explicit company_id.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WORDING = `Hard rules, never break them:
- Fraud, theft or dishonesty must NEVER be stated as fact. Use only:
  "requires review", "unusual pattern", "potential anomaly", "risk indicator".
- Every conclusion must cite the figure it came from (quote the number).
- Plain Nigerian small-business language. Short paragraphs. Naira amounts as ₦.
- If the figures don't support an answer, say what extra record is needed.`;

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }
  let body: {
    mode?: string; company_id?: string; question?: string;
    figures?: unknown; analysis?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Bad JSON" }), { status: 400 });
  }
  if (body.mode !== "chat" && body.mode !== "import") {
    return new Response(JSON.stringify({ error: "mode must be chat|import" }), { status: 400 });
  }
  if (!body.company_id) {
    return new Response(JSON.stringify({ error: "company_id required" }), { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Caller identity: platform-verified JWT -> auth user -> own profile.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return new Response(JSON.stringify({ error: "Missing token" }), { status: 401 });
  const caller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user } } = await caller.auth.getUser();
  if (!user && !isServiceJwt(jwt)) {
    return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 });
  }
  if (user) {
    const { data: profile } = await admin.from("profiles")
      .select("company_id, role").eq("id", user.id).maybeSingle();
    if (!profile || (profile.company_id !== body.company_id && profile.role !== "super_admin")) {
      return new Response(JSON.stringify({ error: "Not your company" }), { status: 403 });
    }
  }

  // Daily per-company cap.
  const maxPerDay = Number(Deno.env.get("AI_MAX_PER_DAY") || "200");
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await admin.from("ai_usage")
    .select("questions").eq("company_id", body.company_id).eq("day", today).maybeSingle();
  if (usage && usage.questions >= maxPerDay) {
    return new Response(JSON.stringify({ error: "Daily AI limit reached", fallback: true }), { status: 429 });
  }

  const system = body.mode === "chat"
    ? `You are ChiiTech, a friendly business adviser for Nigerian small businesses. Answer the owner's question using ONLY the figures provided. ${WORDING}`
    : `You are ChiiTech reviewing one uploaded batch of business records for a Nigerian small business. Turn the analysis JSON into: 1) one-paragraph executive summary, 2) strengths, 3) weaknesses phrased as review signals, 4) prioritized actions (do-first first). ${WORDING}`;

  const userText = body.mode === "chat"
    ? `Question: ${body.question || ""}\nFigures (authoritative, do not invent others):\n${JSON.stringify(body.figures || {}).slice(0, 6000)}`
    : `Batch analysis JSON (authoritative):\n${JSON.stringify(body.analysis || {}).slice(0, 8000)}\nWrite the review now.`;

  const baseUrl = (Deno.env.get("AI_BASE_URL") || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let answer = "";
  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("GROQ_API_KEY")}`,
      },
      body: JSON.stringify({
        model: Deno.env.get("AI_MODEL") || "openai/gpt-oss-20b",
        temperature: 0.3,
        max_tokens: 600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText },
        ],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "AI provider error", fallback: true }), { status: 502 });
    }
    const j = await r.json();
    answer = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "").trim();
    if (!answer) {
      return new Response(JSON.stringify({ error: "Empty AI answer", fallback: true }), { status: 502 });
    }
  } catch {
    clearTimeout(timer);
    return new Response(JSON.stringify({ error: "AI timeout", fallback: true }), { status: 504 });
  }

  await admin.from("ai_usage").upsert(
    { company_id: body.company_id, day: today, questions: (usage?.questions || 0) + 1 },
    { onConflict: "company_id,day" },
  );
  return new Response(JSON.stringify({ answer }), {
    headers: { "Content-Type": "application/json" },
  });
});

function isServiceJwt(jwt: string): boolean {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}
