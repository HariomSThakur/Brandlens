# BrandLens — Codex 48 Round 3 submission

**Participant:** Hariom Thakur (solo team)
**Role:** Product, full-stack development, Supabase integration, testing and documentation
**Project:** BrandLens — evidence-led review and approval for marketing content

## Project links

- Working demo: https://brandlens-round2.onrender.com
- Source repository: https://github.com/HariomSThakur/Brandlens
- Updated PDF: `output/pdf/BrandLens-Codex-48-Round-3-Submission.pdf`

The owner reports applying the current `supabase/schema.sql` to the Supabase project. Live invitation redemption and separate Reviewer/Creator permission checks still need end-to-end verification. The local deterministic workflow works without Supabase or an AI model.

## What problem does the project solve?

Marketing teams reuse facts and claims across many drafts, but reviewers often have to search source documents manually to check the exact wording, numbers and dates. This makes unsupported or outdated claims easy to miss and decisions hard to trace. BrandLens links each finding to approved evidence and keeps a person responsible for every final decision.

## How does it work?

1. A creator writes or imports a text/Markdown draft.
2. Deterministic rules check it against approved facts, the claim ledger, source dates and writing rules.
3. Finding cards show the exact draft text, supporting excerpt and reason.
4. A creator may accept or reject a verified minimal rewrite; BrandLens reruns the same checks after an edit.
5. A Reviewer or Admin records decisions and can approve only the current draft/evidence version. Nothing is published automatically.

## Completed features

- Draft editor and `.txt` / `.md` import with a 30,000-character limit.
- Deterministic findings for unsupported or expired claims, numeric conflicts, restricted terminology, all-caps text, repeated exclamation marks and long sentences.
- Evidence-backed claim ledger with owner, exact supporting excerpt, extracted key values, source version, alternative wording and re-review date.
- Source version history and a re-review queue for changed or expired claims and dependent past approvals.
- Guideline-health insights for repeated dismissals, accepted edits, escalations, incompatible threshold rules and claims that conflict with restricted wording.
- Admin-recorded guideline decisions—clarify, add exception, or retire—with a rationale and follow-up dismissal-rate reporting when later outcomes exist.
- Verified, per-finding minimal rewrites from explicit guideline mappings or ledger-approved claim alternatives, with protected values, word-level diffs, separate accept/reject actions and edit history.
- Human review and approval records tied to the current draft and evidence versions.
- Supabase Auth, shared Admin/Reviewer/Creator roles, single-use seven-day invitation codes stored as digests, revision-checked saves, and a database-stamped append-only audit-event schema with Admin-only access events.
- Bounded optional Ollama review with request/source limits, per-process rate and concurrency limits, a 512-token generation cap and a 1,000,000-byte response cap.
- Local browser storage, JSON backup export, and Light/Black/Dark blue themes.

## Technology and implementation

The browser app uses HTML, CSS and vanilla JavaScript ES modules. A small Node.js 20 HTTP server serves the app and an optional Ollama endpoint; the project has no runtime package dependencies. Deterministic review rules run in the browser so the core path remains usable if a model is offline. Optional Ollama/Qwen findings are advisory. The hosted project has not been configured with a Qwen checkpoint; its review mode is deterministic.

Supabase Auth and Postgres store the shared workspace as a JSONB snapshot protected by row-level security and role-checked RPCs. An expected-revision value prevents stale saves from replacing newer work. Shared audit events use a separate table: the database assigns actor and timestamp, and triggers reject update/delete operations. The snapshot save RPC ignores client-supplied audit changes. Render hosts the Node service.

The technically difficult parts are tying approvals to the exact evidence version, preventing stale workspace writes, limiting Creator writes in the database, and refusing rewrites that remove links, names or unsupported numbers. AI text never produces an approval and cannot write a claim replacement.

## What changed from the original plan, and why?

The Round 1 proposal included broader document and accessibility work. The shipped product focuses on the highest-risk core workflow: evidence-backed claim checking, human approvals and auditability. Text import supports plain text and Markdown; DOCX parsing, image/alt-text checking, automated invitation email, workspace switching and multi-language review remain deferred. The health-insights page and evidence lifecycle were built for Round 3. A JSONB workspace snapshot remains the compact shared-state format; audit events were separated into an append-only table to protect their integrity.

## Testing notes

- `npm test`: 33 tests passed for invitation-code generation and flow, role/audit SQL contracts, request and model-response limits, source and claim versions, expiry invalidation, approval queues, guideline conflicts, repeated outcomes, safe rewrites, protected values and word diffs.
- `npm run eval`: 40 frozen, synthetic drafts (15 clean) yielded 100.0% micro precision and recall, with 0 false alarms on the clean set. The same project author wrote the rules, fixtures and labels, so this is a reproducible self-check, not independent or real-world validation.
- Syntax checks passed for the browser modules and Node server.
- Automated local HTTP/browser smoke testing was blocked in the build environment because its socket policy denied loopback access. The service process started; its `/` and `/api/health` routes could not be requested from the sandbox.
- The owner reports applying the latest Supabase schema. Live invitation redemption and separate Reviewer/Creator permission checks have not yet been verified. User interviews completed: n=0. The demo brand and evidence are fictional.
- Planned usability check, not yet conducted: ask three people who create or review marketing content to complete the numeric-conflict workflow; record unaided completion, time and confusing findings, and report the actual sample size and results.

## Three Round 3 improvements delivered

### 1. Evidence-backed claim lifecycle and conflict detection

Each approved claim has an owner, linked source version, exact supporting excerpt, extracted numbers and units, an approved alternative when available, and a review date. Approvals retain the claim and source versions they used. Draft checks compare numbers with the supporting evidence. When a source or claim changes or expires, dependent claims and past approvals enter a visible re-review queue. A reviewer must update the evidence, rerun the saved draft and record a new approval; previous records stay intact.

### 2. Guideline-health insights that close the loop

The app groups repeated dismissals, accepted edits and escalations, and flags possible conflicts between guideline thresholds or restricted wording and approved claims. It displays the source snippets and outcome examples. An Admin can record a decision to clarify a rule, add an exception or retire it, with a rationale. Later dismissal rates are calculated when outcomes exist. The app never changes policy on its own.

### 3. Verified minimal-diff rewrites

Suggested replacements use a guideline's explicit terminology mapping or alternative wording already approved in the claim ledger; optional AI tone text is advisory. The app protects links, names and non-claim numbers, checks claim numbers against the exact supporting excerpt, and reruns deterministic checks before an edit is shown. Creators accept or reject each rewrite separately, and reviewers can inspect the word diff and revision history.

## Team member contribution

Hariom Thakur is the only team member. He led the product direction, specified the workflows and role model, configured the project services, reviewed and directed implementation, ran the available validation scenarios, and prepared the submission. OpenAI Codex was used as an AI coding assistant for implementation and debugging; it is disclosed here as a significant tool.
