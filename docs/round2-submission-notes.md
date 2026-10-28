# Round 2 completed features and changes

## Completed in this MVP

- Responsive review workspace with a fictional, clearly labeled brand.
- Draft editing and `.txt` / `.md` import.
- Deterministic findings for risky unsupported claims, expired claim evidence, numeric mismatches, restricted wording, all-caps text, excess exclamation marks and long sentences.
- Finding cards with exact draft quote, approved source text, reason and proposed edit.
- Creator draft editing and suggested edits; Admins and Reviewers record escalations, dismissals, evidence decisions, and approvals.
- Reviewer resolution for claim findings with a linked source and recorded reason.
- Human approval record only after each finding has a disposition and the exact draft plus evidence set have been reviewed; editing the draft or changing evidence requires a fresh review. No publishing capability.
- Browseable facts/rules library, approved-claim ledger and activity log.
- Shared Supabase workspace with Admin, Reviewer, and Creator roles; Admin-managed invites, Reviewer evidence decisions, and Creator draft workflows; Creator syncs are limited to draft text while shared decisions remain reviewer-controlled. Invitations are stored but must be shared manually; transactional invitation email is not configured.
- Persistent Light, Dark, and Dark blue appearance themes, stored per browser.
- Local browser persistence, bounded `.txt` / `.md` import, JSON backup export and optional Supabase Auth/cloud sync. Escalated findings remain actionable for a reviewer.
- Optional server-side Ollama/Qwen advisory review with quote validation and deterministic-only fallback; the UI reports the active mode and configured model tag.
- Supabase SQL schema with shared workspace membership, role-checked RPCs, revision-checked saves, row-level-security policies, and a data-preserving migration from the earlier per-user snapshot.

## Round 1 plan changes

- The MVP is implemented with a small Node.js built-in HTTP server and browser JavaScript to avoid dependency-install and build complexity within the 48-hour window.
- Supabase stores a shared workspace as a JSONB snapshot for the MVP rather than normalizing each entity into separate tables. The updated migration adds Admin, Reviewer, and Creator membership and role checks.
- Local browser mode is available before Supabase credentials are provided. Cloud sync is optional and requires the project's URL, publishable key, and SQL setup.
- Text import is limited to `.txt` and `.md`. DOCX parsing, image recognition, automated invitation emails, workspace switching, broader integrations, and multi-language review are deferred.
- Model review is an optional Ollama connection; the deterministic workflow remains usable if no model is configured or a request fails.

## Three meaningful Round 3 improvements

1. **Evidence-backed claim lifecycle:** source ownership, version history, expiry reminders, substantiation context, and re-approval of changed claims.
2. **Guideline health insights:** detect repeated dismissals, overrides, and conflicting rules, then let owners review and clarify guidance.
3. **Intent-preserving rewrite workflow:** richer multi-span diffs, per-change acceptance, and reviewer feedback that preserves the creator's original meaning.

## Evaluation still needed

The product includes a deterministic review path and a fictional example workspace. The 40-draft author-labeled evaluation is now reproducible with `npm run eval`; its current results and self-authored-data limitation are documented in README. Independent labels and two or three real user interviews remain future work (interviews completed so far: n=0); a short guide is available in `docs/interview-guide.md`. Live Supabase configuration and a deployed public URL must be verified before claiming them.
