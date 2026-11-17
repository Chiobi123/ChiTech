# ChiiTech AI architecture

Runtime: Cloudflare Pages Function \`/api/ai\` + Workers AI model
\`@cf/zai-org/glm-4.7-flash\` + Supabase Auth/PostgREST/PostgreSQL.

The gateway validates the Supabase access token and derives the tenant from
the active profile. Business data is fetched using the caller JWT and RLS.
The client cannot select a tenant or supply authoritative financial figures.
Company admins, workers and auditors are supported only within existing RLS
permissions. Super Admin is not a tenant workspace role.

Context includes recent sales and expenses (365-day window, max 500 each),
products, customers, orders, debts, audit findings and import batches.
Coverage limits are explicit. The last eight exchanges support follow-ups.
Greetings are answered without consuming inference quota.

The model explains facts; deterministic code/database calculations remain
authoritative. Never invent totals, call gross profit net profit, claim fraud,
or write records without an authorised confirmation flow.

Quota: 8,000 estimated Neurons/day globally, reserving 2,000 of the
Cloudflare free 10,000 daily Neurons. Active companies split the company
pool equally. One-user companies can use their whole company allocation.
In teams, 30% is the normal per-user share; the shared pool is available
until 70% company utilisation. Reservations are serialized transactionally.
Estimates use GLM-4.7-Flash token-to-Neuron rates and require calibration.

Future upgrades can add model routing, streaming, richer tools, async
document processing, vector search and plan-based capacity without changing
the frontend chat contract. The model, quota policy and context retrieval
are independently replaceable.
