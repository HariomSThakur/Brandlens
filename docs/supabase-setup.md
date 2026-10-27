# Connect BrandLens to Supabase

This adds email/password sign-in and syncs one workspace snapshot per signed-in user. Local browser storage remains available when Supabase is not configured.

## 1. Create a Supabase project

1. Sign in at [supabase.com/dashboard](https://supabase.com/dashboard) and create a new project on the Free plan.
2. Choose a project name and region. Save the database password somewhere safe; BrandLens does not need that password.
3. Wait for the project to finish provisioning.

## 2. Create the BrandLens table and row policies

1. Open the project's **SQL Editor** and choose **New query**.
2. Open `supabase/schema.sql` in this repository and paste its contents into the query.
3. Click **Run**. The script creates `public.workspace_state`, enables row-level security (RLS), grants signed-in users the required table operations, and limits each operation to the caller's own row.
4. In **Table Editor**, confirm that `workspace_state` exists. Do not turn off RLS.

## 3. Copy the project URL and publishable key

1. In the project dashboard, open **Connect** or **Settings → API Keys**.
2. Copy the **Project URL** and the **publishable key** (`sb_publishable_...`). The key is intended for public app clients; RLS is what protects workspace rows.
3. Never use a secret key (`sb_secret_...`) or legacy `service_role` key in BrandLens.

## 4. Configure local BrandLens

From PowerShell, in the `brandlens-round2` folder:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set these two lines in `.env`:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

Save `.env`. It is ignored by Git; do not commit it. Restart the server with `npm start` after editing environment values. The server loads `.env` on startup.

## 5. Sign in and check sync

1. Open BrandLens at `http://localhost:3000` and refresh the page.
2. Click **Sign in to sync** (or **Connect Supabase**) and choose **Create account**.
3. Use your email and a password of at least six characters. If Supabase requires email confirmation, confirm the email, return to BrandLens, then sign in.
4. On the first sign-in, BrandLens saves the current local workspace to Supabase. Later syncs load the signed-in user's cloud workspace into this browser.
5. In **Table Editor → workspace_state**, verify that one row appears with your user ID as `owner_id` and the workspace JSON under `payload`.

The built-in email service on hosted projects is intended for testing and has recipient/rate limits. For a quick demo, use the email address associated with your Supabase organization. Do not disable email confirmation for a public deployment just to bypass email setup.

## 6. Configure a deployed app (after hosting it)

In the hosting provider's environment-variable settings, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the same two values, then redeploy/restart. In Supabase **Authentication → URL Configuration**, set the Site URL to the deployed BrandLens URL and allow the local URL `http://localhost:3000/**` while you still use local development. Add the exact deployed URL to the redirect allow list as well. Supabase uses these settings for email confirmation redirects.

## Troubleshooting

- **The button still says “Connect Supabase”:** check the variable names and restart the Node server; the app loads configuration when the page starts.
- **Sign-up asks you to check email:** confirm it first, then use **Sign in**. Hosted email delivery may be limited on the Free plan's built-in test service.
- **Sync says schema or permissions are missing:** rerun `supabase/schema.sql` in the SQL Editor and verify RLS is still enabled.
- **Sync loads unexpected old data:** an existing cloud row takes precedence over the browser copy at sign-in. Export a JSON backup before testing if you need to preserve local changes.
- **A free project was paused:** resume it in the Supabase dashboard before testing; inactive free projects can be paused.
