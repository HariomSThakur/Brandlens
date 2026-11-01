# BrandLens security hardening design

**Status:** Proposed for review  
**Date:** 2026-11-01  
**Scope:** Invitation redemption, audit-event permissions, and optional Ollama resource limits

## Intent

Close three source-validated security gaps found in the Codex Security review while keeping BrandLens' current Admin, Reviewer, and Creator roles and its no-model fallback usable.

## Findings this design addresses

1. A pending invitation can be claimed based only on the email in an authenticated Supabase JWT. If Supabase is configured to issue sessions without proving email ownership, another person can register that address and join with the invited role.
2. The append-only audit RPC accepts `Workspace invite created` and `Workspace member removed` from Reviewers even though the corresponding membership operations require Admin.
3. When Ollama is configured, the public model route has no request quota, concurrency bound, or aggregate source limit.

## Goals

- Require a high-entropy, expiring, single-use invitation code as well as an exact email match before a new account joins a workspace.
- Keep raw invitation codes visible only to the Admin who creates or reissues them; store only a cryptographic digest in Supabase.
- Preserve existing-member sign-in and first-Admin workspace creation without an invite code.
- Enforce Admin-only audit labels in the database, even when a caller bypasses the browser UI.
- Bound optional Ollama request size, source content, request rate, and concurrent calls; keep deterministic review available when AI calls are limited.
- Provide focused checks for token lifecycle and model limits, and document the schema migration and reissue behavior.

## Non-goals

- Replacing Supabase Auth or adding a service-role key to the app.
- Sending invitation emails automatically.
- Normalizing the JSONB workspace, changing the role model, or adding workspace switching.
- Making the Ollama route available when its server-side environment is unset.
- Claiming production verification without applying the migration and checking the live Supabase project.

## Approaches considered

1. **Expiring one-time code (selected):** Admin creates a random code and shares it directly with the invitee. The app stores only a SHA-256 digest and expiry in Supabase. This does not depend on the project's email-confirmation setting and preserves self-service signup.
2. **Require email confirmation only:** Document and configure Supabase email confirmation. This is smaller, but the identity guarantee changes if a project setting changes.
3. **Pre-create every account in Supabase:** Avoid email-only self-service redemption, but adds manual account setup and changes the current team onboarding flow.

The user selected approach 1. The code-generation and hashing details below are implementation choices for review.

## Proposed behavior

### Invitation lifecycle

- The Admin browser generates a cryptographically random 256-bit token using Web Crypto and submits its SHA-256 digest to an Admin-only RPC. The token is shown once in a share dialog with a copy action; it is not written to localStorage or included in the team-list RPC.
- Supabase stores the digest and a seven-day expiry. The Admin shares the token with the exact invited email address outside BrandLens.
- The signup/sign-in form gains an optional invitation-code field. A new account must submit the code and sign in with the exact invited email. The database checks email, digest, expiry, one-workspace membership, and the invited role, then consumes the invitation in the same transaction as membership creation.
- Existing signed-in members continue loading their workspace without a code. A user with no pending invitation can still create the first Admin workspace without a code.
- An invalid, missing, expired, or already-used code never joins the workspace and does not silently create a separate workspace when a pending invitation exists.
- On migration, existing pending rows have no valid digest and cannot be redeemed until an Admin reissues the invitation. Reissuing the same email rotates the code and starts a fresh seven-day expiry. The setup guide will call this out.

### Audit permissions

- `append_brandlens_audit_event` rejects `Workspace invite created` and `Workspace member removed` unless the caller is Admin. The existing Admin restriction for guideline owner decisions stays in place.
- The actual invite and removal RPCs remain the authority for membership changes; the event RPC only records history.

### Optional Ollama limits

- Reject invalid or oversized JSON using a byte-based body limit.
- Limit draft characters, number of source records, and aggregate source text before building the prompt.
- Reject oversized uploads immediately, close that connection, and bound request header/body time.
- Apply a per-process request quota and in-flight cap before calling Ollama. Return `429` when the quota is exhausted and preserve the deterministic review path in the browser.
- Cap generation at 512 tokens and cancel an Ollama response that exceeds 1,000,000 bytes.
- The README will explain that in-memory limits apply per server process and that multi-instance deployments need a shared limiter.

## Files expected to change

- `supabase/schema.sql`: invitation digest/expiry migration, updated invite and workspace RPC signatures, one-time redemption, and Admin-only audit-label checks.
- `public/app.js`: secure code generation, one-time Admin display/copy, optional code input, and passcode propagation to the workspace RPC.
- `server.mjs` (and a focused helper module only if needed): byte/source limits, request quota and concurrency handling for Ollama.
- `test/`: focused tests for invitation-code validation/lifecycle helpers and model request limits.
- `docs/supabase-setup.md`, `README.md`: migration/reissue and model-limit behavior.

## Risks and rollout

- The current Supabase schema must be reapplied before the new signup flow works. Existing members remain usable, but unredeemed old invitations must be reissued and the new code shared.
- The current project has no database integration test harness. Node tests can cover pure validation and limiter helpers; the owner must verify SQL redemption and role checks in Supabase with separate Admin, Reviewer, and Creator accounts.
- A process-local Ollama quota is suitable for the current single-instance demo. It is not a distributed rate limiter.
- Invitation email confirmation remains useful defense in depth, but the invite code is the required proof for accepting an invitation.

## Acceptance checks

- Correct code + exact email joins once with the invited role; wrong, missing, expired, and reused codes fail.
- Existing members and first-Admin setup still work without a code.
- Reviewer cannot append either Admin-only audit label; Admin remains able to record allowed activity.
- Oversized source input, requests above quota, calls above the concurrency cap, and oversized Ollama output are bounded; deterministic findings remain available.
- Existing review-engine tests pass, and setup documentation explains the SQL migration and pending-invite reissue.
