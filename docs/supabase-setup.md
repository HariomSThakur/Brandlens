# Connect BrandLens to Supabase

This setup enables email/password accounts, one shared workspace, and Admin, Reviewer, and Creator roles. Local browser mode remains available without Supabase.

## 1. Create a Supabase project

Create a project at [supabase.com/dashboard](https://supabase.com/dashboard) and wait for provisioning to finish. BrandLens needs the Project URL and publishable key; it does not need the database password.

## 2. Apply the workspace schema

1. Open the project **SQL Editor** and choose **New query**.
2. Paste all of `supabase/schema.sql` and click **Run**.
3. The script creates shared workspaces, membership, invitations, role-checked RPCs, and row-level security. Existing `workspace_state` payloads are migrated into workspaces and preserved. Do not delete the existing `workspace_state` table or the accidental empty `Brand len` table.
4. If you already ran an older BrandLens schema, run this updated file in SQL Editor as a migration.

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

Never put a secret or service-role key in the app. Restart the server (`node server.mjs` or `npm start`) after changing `.env`, refresh `http://localhost:3000`, then sign in and press **Sync workspace**. The first Admin account creates the shared workspace and brings its local demo snapshot into Supabase. Later syncs save or load that shared state.

## 4. Invite teammates

1. Sign in as the workspace Admin and open **Team**.
2. Enter the teammate's email, choose **Reviewer** or **Creator**, and create the invite.
3. Supabase does not send an invitation email in this MVP. Share the instructions directly; the teammate must create or sign in to Supabase Auth using the exact invited email. They then open BrandLens and sync. The invite is accepted automatically.
4. Each Supabase account can belong to one BrandLens workspace in this version. Invite the account before it creates a separate BrandLens workspace.

Roles: **Admin** can manage membership and all workspace data. **Reviewer** can manage facts/rules and claims, resolve findings, and record approvals. **Creator** can work on drafts, accept suggested edits, and escalate findings; they cannot edit approved facts/rules or claims, resolve claims, or approve. Supabase RPC checks enforce important writes in the database as well as in the UI.

## 5. Appearance

Open **Settings → Appearance** to choose Light, Dark, or Dark blue. The choice is stored in that browser.

## Troubleshooting

- **The sync button still says Connect Supabase:** check `.env` names and restart Node.
- **Schema or permission error:** rerun the current `supabase/schema.sql` in SQL Editor and ensure RLS is enabled.
- **Invite cannot be accepted:** confirm the signed-in email exactly matches the invitation. An account already attached to another workspace cannot join this workspace in the current version.
- **Sign-up asks for email confirmation:** confirm the email, then sign in. Hosted test email delivery can be rate-limited.
- **Local changes appear missing:** existing cloud data loads on sign-in. Export a JSON backup before testing if you need to preserve local-only changes.
