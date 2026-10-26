create table if not exists public.workspace_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.workspace_state enable row level security;

create policy "Users can read their own BrandLens workspace"
  on public.workspace_state for select
  using (auth.uid() = owner_id);

create policy "Users can create their own BrandLens workspace"
  on public.workspace_state for insert
  with check (auth.uid() = owner_id);

create policy "Users can update their own BrandLens workspace"
  on public.workspace_state for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
