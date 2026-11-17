# ChiiTech Cloudflare Workers AI setup

The only user-facing AI route is the Pages Function at \`/api/ai\`.
Primary model: \`@cf/zai-org/glm-4.7-flash\`. No paid external AI-provider API key is required.

## One-time production binding
1. Cloudflare Dashboard → Workers & Pages → the existing \`chiitech\` Pages project.
2. Settings → Bindings → Production → Add → Workers AI.
3. Variable name must be exactly \`AI\`.
4. Open Settings → Variables and Secrets → Add. Create an encrypted Production secret named `SUPABASE_SERVICE_ROLE_KEY` containing the existing Supabase project's service-role key. Never put this key in frontend JavaScript, HTML, GitHub, or logs.
5. Save and redeploy the production Pages project.

Do not change the Pages build root or add a Wrangler configuration file.
The existing Pages project root is \`chiitech/\`; Pages discovers its
\`functions/\` directory automatically.

## Security and quota
The gateway validates the Supabase access token, derives the company and
role from the user's active database profile, and retrieves business records
using the caller's JWT so Supabase RLS remains the authorization boundary.
The request body cannot choose a different tenant. Deep import review is
company-admin-only.

The database quota manager reserves up to 8,000 estimated Neurons per day
globally and leaves 2,000 of the free 10,000 daily Neurons as a safety
buffer. Active companies share the company pool. A single-user company may
use its whole allocation; teams have a 30% normal individual share and can
draw on the shared pool until 70% of the company allocation is consumed.
Neuron usage is estimated from the published GLM-4.7-Flash input/output
rates and must be calibrated against Cloudflare analytics.

No paid model is an automatic fallback. Benchmark a model replacement before
changing the model ID and its quota rates.
