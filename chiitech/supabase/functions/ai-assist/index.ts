// Retired legacy Groq endpoint. Production AI now runs at Cloudflare Pages /api/ai.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
serve(() => new Response(JSON.stringify({
  error: "This legacy AI endpoint is retired. Use the ChiiTech Cloudflare AI gateway."
}), {
  status: 410,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
}));
