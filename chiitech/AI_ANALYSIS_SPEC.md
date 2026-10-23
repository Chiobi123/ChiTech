# AI analysis layer — contract (deterministic baseline stays, Edge Function later)

Status: the deterministic analysis (`analyseRows` + `businessAnalysis` in
`js/imports.js`, auto-saved per batch via `save_import_analysis`) is the
auditable baseline and ships now. The LLM layer below is NOT deployed yet —
no API secret exists anywhere in this repo, and none must ever be added to
browser JavaScript.

## Secure shape (when built)

- Supabase Edge Function (service-role server-side only), e.g.
  `supabase/functions/ai-analysis/index.ts`.
- Input: one stored batch analysis JSON (from `import_batches.analysis`)
  plus aggregate company stats — never raw secrets, never the whole ledger.
- Auth: caller must be `company_admin` of the batch's company (verify via
  `app_private.my_company_id()` inside the function using the caller's JWT).
- Output stored back to the batch (`analysis.ai` key): executive summary,
  strengths, weaknesses, risks, opportunities, anomalies with possible
  causes, prioritized recommended actions — each conclusion carrying the
  data slice (table, period, amounts) it was drawn from.
- Wording rules (hard): "requires review" / "unusual pattern" /
  "potential anomaly" / "risk indicator". Never "fraud" as fact.

## Why this order

The baseline already answers from real data offline; the Edge Function only
adds language fluency later through the same numbers. Any AI sentence a
user sees must link back to a stored figure, or it doesn't ship.
