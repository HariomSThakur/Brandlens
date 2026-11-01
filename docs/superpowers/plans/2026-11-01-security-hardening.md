# BrandLens Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prevent invitation impersonation, enforce Admin-only audit labels, and limit abuse of the optional public Ollama review route.

**Architecture:** Browser Web Crypto creates a 256-bit invitation code and sends only its SHA-256 digest to Supabase. Postgres stores the digest and seven-day expiry, validates the raw code plus exact email before membership, and consumes the invite once. Node validates model payloads and applies a process-local quota and concurrency guard before inference.

**Tech Stack:** Existing HTML/CSS/vanilla JavaScript ES modules, Node.js 20 built-ins, Supabase Postgres SQL, and Node's built-in test runner. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-security-hardening-design.md`

## Global Constraints

- Preserve existing Admin, Reviewer, and Creator roles and current members' sign-in without an invite code.
- First-Admin workspace creation remains possible without an invite code.
- Invitation code: 256 bits, digest stored in Supabase, single use, expires after seven days.
- Invite creation and redemption remain database RPCs; never add a service-role key to browser or server configuration.
- Admin-only audit labels are enforced in SQL, not only in the UI.
- Ollama stays optional; deterministic review remains usable when requests are rejected or the model fails.
- No new runtime dependencies; Node.js 20 or newer.
- Do not commit or push; provide the user the commands after implementation.

## Review Focus

- A missing or incorrect invite code for a pending email must fail without silently creating a new Admin workspace.
- An expired, consumed, or rotated invite code must not be replayable.
- Existing members and the first Admin must still sync without entering an invite code.
- Legacy invitations without a digest must fail closed and be clearly reissued by an Admin.
- Multibyte oversized bodies, excessive source text, quota exhaustion, and concurrent excess must not reach Ollama.

---

### Task 1: Add browser invitation-code primitives

**Files:**
- Create: `public/invite-security.js`
- Create: `test/invite-security.test.mjs`

**Interfaces:**
- Produces `generateInviteCode(cryptoProvider = globalThis.crypto) -> string`, returning 64 lowercase hexadecimal characters from 32 secure random bytes.
- Produces `hashInviteCode(code, cryptoProvider = globalThis.crypto) -> Promise<string>`, returning the lowercase hexadecimal SHA-256 digest.
- Produces `isInviteCode(code) -> boolean`, accepting only exactly 64 lowercase or uppercase hexadecimal characters.
- `hashInviteCode` trims and lowercases valid hex before hashing so pasted uppercase codes work consistently with SQL redemption.

- [x] **Step 1: Write failing unit tests**
  - `generateInviteCode_returns_256_bit_hex_token`: assert length 64 and `/^[0-9a-f]{64}$/`.
  - `hashInviteCode_returns_stable_sha256_hex_digest`: assert length 64, same input gives same digest, uppercase/lowercase token spellings hash identically, and digest differs from raw code.
  - `isInviteCode_rejects_missing_malformed_and_wrong_length_values`: test null, blank, non-hex, 63-character and 65-character values.
- [x] **Step 2: Run `node --test test/invite-security.test.mjs` and confirm the new imports fail because the helper does not exist.**
- [x] **Step 3: Implement the three exports in `public/invite-security.js` using Web Crypto only.**
- [x] **Step 4: Run `node --test test/invite-security.test.mjs`; expect all three tests to pass.**

### Task 2: Harden Supabase invitation and audit RPCs

**Files:**
- Modify: `supabase/schema.sql`
- Create: `test/schema-security.test.mjs`
- Modify: `docs/supabase-setup.md`

**Interfaces:**
- `invite_brandlens_member` takes workspace UUID, email, role, and a 64-character SHA-256 digest; it stores the digest and sets expiry to seven days from the call. Reissuing an email replaces the digest and expiry.
- `get_or_create_brandlens_workspace` takes the existing name and initial payload plus an optional raw invitation code. Existing members and first-Admin creation remain valid without it.
- `list_brandlens_team` may return invite email, role, creation time, expiry, and whether a code exists, but never the digest or raw token.

- [x] **Step 1: Add failing schema-contract checks**
  - `workspace_invitation_requires_matching_digest_and_unexpired_code`: assert the SQL adds `invite_code_hash` and `expires_at`, computes SHA-256 for normalized submitted code, checks exact JWT email and expiry, and consumes the invitation in the membership transaction.
  - `legacy_invitation_without_digest_is_not_accepted`: assert the redemption function rejects a null digest or expiry.
  - `pending_invite_without_code_does_not_create_an_unrelated_workspace`: assert code failure occurs before the workspace-creation branch.
  - `existing_member_and_first_admin_do_not_need_a_code`: assert the current-member branch precedes invite redemption and the no-invitation branch can still create the first workspace.
  - `expired_or_consumed_invites_cannot_be_redeemed_again`: assert expiry is checked and successful redemption deletes the invitation in the same function call.
  - `privileged_audit_labels_are_admin_only`: extract the append RPC body and assert both `Workspace invite created` and `Workspace member removed` have an Admin check; assert the existing guideline decision guard remains.
  - `team_listing_never_returns_invite_digest`: assert the team-list projection omits `invite_code_hash`.
- [x] **Step 2: Run `node --test test/schema-security.test.mjs` and confirm these checks fail against the current schema.**
- [x] **Step 3: Update the idempotent migration and RPC signatures.** Ensure `pgcrypto` is available in Supabase's `extensions` schema; add nullable digest/expiry columns so legacy invites fail closed; drop the old workspace-RPC overload to avoid PostgREST ambiguity; validate and hash the normalized code; require exact invite email, valid digest and unexpired invite; consume it once; preserve the existing-member and first-Admin paths. Add Admin checks for the two privileged audit labels.
- [x] **Step 4: Run `node --test test/schema-security.test.mjs`; expect all schema-contract checks to pass.**
- [x] **Step 5: Update `docs/supabase-setup.md`** to say to re-run the current schema, reissue old pending invitations, share codes directly with invitees, and expect codes to expire after seven days.

### Task 3: Connect the invite-code flow to the UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html` only if form help copy needs a static label
- Test: `test/invite-security.test.mjs`

**Interfaces:**
- Consumes `generateInviteCode`, `hashInviteCode`, and `isInviteCode` from Task 1.
- Calls the updated RPC signatures from Task 2. Raw codes are never persisted to localStorage or included in workspace snapshots.

- [x] **Step 1: Add failing UI-flow contract tests**
  - `signup_and_signin_pass_optional_invite_code_to_workspace_rpc`: verify the auth path forwards a trimmed code to `get_or_create_brandlens_workspace`.
  - `admin_invite_sends_digest_and_displays_raw_code_once`: verify invite creation sends the digest, and only the one-time Admin share dialog displays the raw code.
  - `team_listing_does_not_render_digest`: verify the Admin pending-invite view displays expiry/status but not a digest.
- [x] **Step 2: Run the focused test and confirm the current UI does not satisfy the contract.**
- [x] **Step 3: Add an optional invite-code input to signup/sign-in.** Pass it only to the workspace RPC after authentication; do not put it in browser storage. Preserve no-code login for existing members.
- [x] **Step 4: Generate a secure code in the Admin invite handler, send only its digest to the invite RPC, and show the raw token once in a share/copy dialog.** Reissuing the same email rotates the code. Display pending invite expiry and mark legacy rows as requiring reissue.
- [x] **Step 5: Run the focused invite tests and the existing `node --test` suite.**

### Task 4: Bound optional Ollama requests

**Files:**
- Create: `server-security.mjs`
- Modify: `server.mjs`
- Create: `test/server-security.test.mjs`

**Interfaces:**
- `readJsonBody(req, maxBytes = 256_000) -> Promise<object>` counts incoming bytes and throws an error with `statusCode = 413` when the cap is exceeded.
- `readJsonResponse(response, maxBytes = 1_000_000)` cancels and rejects an Ollama response that exceeds its byte cap.
- `validateAiReviewPayload(payload) -> { valid: boolean, error?: string }` accepts a draft up to 30,000 characters, at most 20 sources, source titles up to 200 characters, source content up to 12,000 characters each, and at most 150,000 aggregate source characters.
- `createAiReviewGuard({ now = Date.now, windowMs = 60_000, maxRequests = 12, maxConcurrent = 2 })` returns an acquire operation with an idempotent release function and a retry-after value when rejected. Only successful acquisitions consume the 12-per-minute quota; concurrency rejection leaves quota unchanged.

- [x] **Step 1: Write failing tests**
  - `readJsonBody_counts_utf8_bytes_and_rejects_above_256kb`: use multibyte input and assert HTTP status code 413 above the byte cap.
  - `validateAiReviewPayload_rejects_bad_shape_and_source_limits`: test missing draft, 30,001-character draft, 21 sources, 12,001-character source, and 150,001 aggregate characters.
  - `ai_review_guard_caps_12_requests_per_minute_and_2_concurrent`: use an injected clock; assert the 13th request is rate limited, the third active request is concurrency limited, release is idempotent, and quota resets after 60 seconds.
- [x] **Step 2: Run `node --test test/server-security.test.mjs` and confirm the missing exports fail.**
- [x] **Step 3: Implement the pure helper module and keep state scoped to one server process.**
- [x] **Step 4: Run the focused tests; expect all to pass.**
- [x] **Step 5: Wire the `/api/ai-review` route through byte parsing, payload validation, then the guard before the Ollama fetch.** Release concurrency in `finally`; return 413, 400, or 429 with a useful message; keep the existing deterministic fallback in the browser.
- [x] **Step 6: Run `node --check server.mjs`, `node --check server-security.mjs`, focused helper tests, and the full `npm test` suite.**

**Final review hardening:** reject and pause an oversized streaming request immediately, close it after sending 413, set 10-second header and 30-second request timeouts, cap Ollama generation at 512 tokens, and cancel model responses above 1,000,000 bytes. Regression tests cover early stream rejection and oversized response cancellation.

### Task 5: Document rollout and security boundaries

**Files:**
- Modify: `README.md`
- Modify: `docs/supabase-setup.md`

- [x] **Step 1: Add setup instructions** for migration, seven-day codes, one-time display, reissue of legacy invitations, and code entry during signup.
- [x] **Step 2: Document model limits** as per-process caps and note that multi-instance deployment needs a shared limiter.
- [x] **Step 3: Review all changed copy against implementation and record that live Supabase RPC verification remains owner-side.**
- [x] **Step 4: Run the complete `npm test` suite and inspect `git diff --check` plus the final diff.**

## Execution notes

- Database behavior cannot be proved by Node unit tests. After implementation, give the owner a Supabase SQL verification checklist for wrong/valid/reused/expired codes and Reviewer attempts at Admin-only audit labels.
- No commit or push is included; provide PowerShell commit and push commands to the user after review.
- Current session policy disallows subagent delegation; implementation will use the native in-session workflow with a separate self-review pass.
