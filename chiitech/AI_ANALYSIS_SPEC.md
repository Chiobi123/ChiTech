# ChiiTech AI analysis layer

The deterministic import analysis in \`js/imports.js\` and the database remains
the auditable baseline. The language/reasoning layer runs through the Cloudflare
Pages Function at \`/api/ai\` using Cloudflare Workers AI.

## Security contract
- Browser sends a Supabase access token, question, short conversation history,
  or import batch ID. It does not send trusted company identity.
- Gateway validates the token with Supabase Auth and derives company_id and
  role from the authenticated user's own active profile.
- Business context is retrieved using that user's JWT, preserving RLS.
- Deep import analysis is company-admin-only and uses the existing
  \`deep_analyse_import_batch\` RPC.
- No provider key, service-role key or other secret is shipped to browser.

## Model
Primary: \`@cf/zai-org/glm-4.7-flash\`. Do not add a paid fallback.
Benchmark alternatives before changing the model. See
\`AI_ARCHITECTURE.md\` and \`CLOUDFLARE_AI_SETUP.md\`.

## Financial correctness
The model explains figures supplied by the application/database. It is not
the accounting engine. It must not invent totals, label gross profit as net
profit, make unsupported fraud claims, or write business records.
