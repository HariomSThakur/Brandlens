# Connect BrandLens to Supabase

This setup enables email/password accounts, one shared workspace, and Admin, Reviewer, and Creator roles. Local browser mode remains available without Supabase.

## 1. Create a Supabase project

Create a project at [supabase.com/dashboard](https://supabase.com/dashboard) and wait for provisioning to finish. BrandLens needs the Project URL and publishable key; it does not need the database password.

## 2. Apply the workspace schema

1. Open the project **SQL Editor** and choose **New query**.
2. Paste all of `supabase/schema.sql` and click **Run**.
3. The script creates shared workspaces, membership, expiring invitation-code support, role-checked RPCs, row-level security, revision-checked saves, and a server-stamped append-only activity table. Existing `workspace_state` payloads are migrated into workspaces and preserved. Do not delete the existing `workspace_state` table or the accidental empty `Brand len` table.
4. If you already ran an older BrandLens schema, run this updated file in SQL Editor as a migration. Re-running it adds the invitation digest and expiry columns, updates the workspace and invite RPCs, and keeps old pending invitations without a code unusable until reissued. It also enforces Admin-only workspace-access audit labels.

## 3. Set up the app

In PowerShell from the `brandlens-round2` folder:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set the values below, then save the file:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Never put a secret or service-role key in the app. Restart the server (`node server.mjs` or `npm start`) after changing `.env`, refresh `http://localhost:3000`, then sign in and press **Sync workspace**. The first Admin account creates the shared workspace and brings its local demo snapshot into Supabase. Later syncs save or load that shared state. A revision check blocks stale saves so one teammate does not silently overwrite a newer snapshot.

## 4. Invite teammates

1. Sign in as the workspace Admin and open **Team**.
2. Enter the teammate's email, choose **Reviewer** or **Creator**, and create the invite. BrandLens shows a random invitation code once; copy and share it privately with the intended teammate. Creating another invite for the same email rotates the code and expiry.
3. Supabase does not send an invitation email in this MVP. The teammate creates or signs in to Supabase Auth using the exact invited email and enters the invitation code in the sign-in form. The code is single-use and expires after seven days. If email confirmation is required, the teammate must enter the code again after confirming and returning to sign in.
4. Each Supabase account can belong to one BrandLens workspace in this version. Invite the account before it creates a separate BrandLens workspace. Existing members and the first Admin do not need a code.
5. Pending invitations from before this migration have no code digest. Reissue each one from **Team** and share its newly displayed code; the previous invite cannot be redeemed.

Roles: **Admin** can manage membership and all workspace data. **Reviewer** can manage facts/rules and claims, resolve findings, and record approvals. **Creator** can write drafts and use local review suggestions; Sync saves draft text only. Shared findings, evidence, activity, and approvals are managed by Admins and Reviewers. Supabase RPC checks enforce important writes in the database as well as in the UI.

## 5. Verify invitations and role checks

After applying the schema, verify with separate test accounts before sharing the project:

1. As Admin, invite a test email. Copy the one-time code and confirm the pending-invite list shows expiry/status, not the code.
2. With a new Supabase account for that exact email, try a wrong code (must fail), then the correct code (must join once). Try the same code again (must fail). Confirm an existing member still loads without a code and the first Admin can create a workspace without one.
3. Reissue the same email's invitation and confirm the old code no longer works. For legacy invitations from before this migration, reissue and share the new code.
4. In an authenticated Reviewer session, call `append_brandlens_audit_event` directly with `Workspace invite created` and `Workspace member removed`; both requests must be rejected by the database. A normal Admin invite/removal should continue working.

The app's automated schema checks verify the migration's required conditions, but they do not execute SQL against your hosted project. The live RPC checks above are still required.

## 6. Appearance

Open **Settings → Appearance** to choose Light, Black, or Dark blue. The choice is stored in that browser.

## Troubleshooting

- **The sync button still says Connect Supabase:** check `.env` names and restart Node.
- **Schema or permission error:** rerun the current `supabase/schema.sql` in SQL Editor and ensure RLS is enabled.
- **Audit events remain pending:** confirm the current schema has run, then use **Sync workspace** while online. The event key makes retries safe; the database assigns the actor and time.
- **Invite cannot be accepted:** confirm the signed-in email exactly matches the invitation and paste the current, unexpired code. An account already attached to another workspace cannot join this workspace in the current version. Ask the Admin to reissue the invitation if the code was lost, expired, or replaced.
- **An existing signed-in invitee cannot see the code field:** if their browser session was restored without the one-time code, BrandLens opens a code-only retry prompt. They can paste the current code without entering the password again.
- **Sign-up asks for email confirmation:** confirm the email, then sign in. Hosted test email delivery can be rate-limited.
- **Local changes appear missing:** existing cloud data loads on sign-in. Export a JSON backup before testing if you need to preserve local-only changes.
