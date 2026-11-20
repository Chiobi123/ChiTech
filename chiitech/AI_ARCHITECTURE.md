# ChiiTech AI architecture

Runtime: Cloudflare Pages Function `POST /api/ai`, Workers AI binding `AI`, Supabase Auth/PostgREST/PostgreSQL.

## Three-model task router

- **Everyday conversation and standard workspace questions:** `@cf/openai/gpt-oss-20b`.
- **Import review, extraction, classification and structured document analysis:** `@cf/google/gemma-4-26b-a4b-it`.
- **Multi-step reasoning, comparisons, root-cause analysis, forecasting and strategic questions:** `@cf/qwen/qwen3.8-27b`.

The gateway selects one model per request using the request mode and conservative task-intent rules. It does not run all three models for every question. The selected model and task class are returned for diagnostics. The model-specific published Neuron rates are used when reserving quota, with a 25% estimation buffer. Qwen is materially more expensive, so it is reserved for questions that match the advanced-reasoning route. Greetings are answered without inference.

## Identity, tenant and conversation boundaries

The gateway validates the Supabase access token, derives the user and company from the active profile, and retrieves business records using the caller JWT so existing RLS applies. The client cannot choose a tenant or supply authoritative financial figures. Super Admin is not a tenant workspace role.

Conversation history is short-lived in browser memory and reset when the signed-in email, role or company changes, and on logout. Each request carries a history scope derived from the authenticated Supabase user ID and current company ID. The gateway independently derives the same scope from the verified token and ignores history when the scope does not match. History is untrusted conversational context: it may resolve follow-up wording but is never a source of business facts, identity, permissions or instructions.

The system prompt explicitly anchors every answer to the ChiiTech product, the authenticated account and its active company. Unrelated projects such as FabluX are not part of this workspace and must not be introduced or used as business context.

## Business context and calculations

Context includes recent sales and expenses (365-day window, capped records), products, customers, orders, debts, audit findings and import batches. Coverage limits are explicit. Deterministic code/database calculations remain authoritative. The model explains facts; it must not invent totals, call gross profit net profit, claim fraud, or write records without an authorised confirmation flow.

## Quota and cost control

The existing atomic daily quota reservation remains in place: 8,000 estimated Neurons/day internal global budget, with 2,000 held as a safety reserve. Company allocations and per-user/shared-pool rules remain controlled by the database RPC. Model-specific rates are used in each reservation; estimates are approximate and should be calibrated against Cloudflare usage analytics. Workers AI free allocation and model availability are controlled by Cloudflare and may change; do not describe the service as unlimited or guaranteed free.

## Deployment

The production Pages project requires the Workers AI binding named exactly `AI`. Pages Functions use `context.env.AI`. The existing deploy script stages the Functions directory at the Pages project root next to `dist/` before deploying. After a deployment, verify the live asset version and authenticated `POST /api/ai` responses; an unauthenticated `401` is an expected security response, not an AI inference test.
