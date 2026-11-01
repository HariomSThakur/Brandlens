-- BrandLens team workspaces and role-protected shared state.
-- Safe to run after the original per-user workspace_state setup.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'BrandLens Workspace',
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','reviewer','creator')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('reviewer','creator')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  invite_code_hash text,
  expires_at timestamptz,
  unique (workspace_id, email)
);

-- Existing pending invitations have no code proof and therefore fail closed.
-- Admins can reissue each invitation to generate a new code and expiry.
alter table public.workspace_invitations add column if not exists invite_code_hash text;
alter table public.workspace_invitations add column if not exists expires_at timestamptz;

create table if not exists public.workspace_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid unique references public.workspaces(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.workspace_state add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.workspace_state add column if not exists revision bigint not null default 1;
create unique index if not exists workspace_state_workspace_id_uidx on public.workspace_state(workspace_id) where workspace_id is not null;

-- Migrate any pre-team per-user workspaces without losing their saved JSON.
insert into public.workspaces (owner_id, name)
select s.owner_id, coalesce(nullif(s.payload->>'workspace',''), 'BrandLens Workspace')
from public.workspace_state s
on conflict (owner_id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.owner_id, 'admin'
from public.workspaces w
on conflict (user_id) do nothing;

update public.workspace_state s
set workspace_id = w.id
from public.workspaces w
where s.owner_id = w.owner_id and s.workspace_id is null;

create or replace function public.brandlens_role(target_workspace uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.role from public.workspace_members m
  where m.workspace_id = target_workspace and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.brandlens_is_member(target_workspace uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select public.brandlens_role(target_workspace) is not null; $$;

create or replace function public.brandlens_is_admin(target_workspace uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select public.brandlens_role(target_workspace) = 'admin'; $$;

revoke all on function public.brandlens_role(uuid) from public, anon;
revoke all on function public.brandlens_is_member(uuid) from public, anon;
revoke all on function public.brandlens_is_admin(uuid) from public, anon;
grant execute on function public.brandlens_role(uuid) to authenticated;
grant execute on function public.brandlens_is_member(uuid) to authenticated;
grant execute on function public.brandlens_is_admin(uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.workspace_state enable row level security;

drop policy if exists "BrandLens members can read their workspace" on public.workspaces;
create policy "BrandLens members can read their workspace" on public.workspaces
for select to authenticated using (public.brandlens_is_member(id));

drop policy if exists "BrandLens members can read team membership" on public.workspace_members;
create policy "BrandLens members can read team membership" on public.workspace_members
for select to authenticated using (user_id = auth.uid() or public.brandlens_is_admin(workspace_id));

drop policy if exists "BrandLens admins can read invitations" on public.workspace_invitations;
create policy "BrandLens admins can read invitations" on public.workspace_invitations
for select to authenticated using (public.brandlens_is_admin(workspace_id));

drop policy if exists "BrandLens members can read shared workspace state" on public.workspace_state;
create policy "BrandLens members can read shared workspace state" on public.workspace_state
for select to authenticated using (public.brandlens_is_member(workspace_id));

revoke all on public.workspaces, public.workspace_members, public.workspace_invitations from anon, authenticated;
grant select on public.workspaces, public.workspace_members, public.workspace_invitations to authenticated;
revoke all on public.workspace_state from anon, authenticated;
grant select on public.workspace_state to authenticated;

drop function if exists public.get_or_create_brandlens_workspace(text,jsonb);

create or replace function public.get_or_create_brandlens_workspace(
  p_name text,
  p_initial_payload jsonb,
  p_invite_code text default null
)
returns jsonb
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt()->>'email','')));
  v_workspace uuid;
  v_role text;
  v_name text;
  v_payload jsonb;
  v_revision bigint;
  v_has_invitation boolean;
  v_crypto_schema text;
  v_invite_code_hash text;
  v_invite public.workspace_invitations%rowtype;
begin
  if v_user is null then raise exception 'Sign in is required.'; end if;

  -- Serialize workspace creation or invitation redemption for this account.
  perform 1 from auth.users u where u.id = v_user for update;

  -- Existing members can always reload their current workspace without a code.
  select m.workspace_id into v_workspace
  from public.workspace_members m where m.user_id = v_user;

  if v_workspace is null then
    select exists (
      select 1 from public.workspace_invitations i
      where lower(i.email) = v_email
    ) into v_has_invitation;

    if v_has_invitation then
      if coalesce(p_invite_code,'') !~ '^[0-9A-Fa-f]{64}$' then
        raise exception 'A valid invitation code is required for this email address.';
      end if;
      select n.nspname into v_crypto_schema
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'pgcrypto';
      if v_crypto_schema is null then raise exception 'The pgcrypto extension is required to redeem invitations.'; end if;
      execute format('select encode(%I.digest(convert_to($1, ''UTF8''), ''sha256''), ''hex'')', v_crypto_schema)
        into v_invite_code_hash using lower(trim(p_invite_code));

      select i.* into v_invite
      from public.workspace_invitations i
      where lower(i.email) = v_email
        and i.invite_code_hash is not null
        and i.expires_at is not null
        and i.invite_code_hash = v_invite_code_hash
        and i.expires_at > now()
      order by i.created_at asc
      limit 1
      for update;

      if not found then
        raise exception 'The invitation code is invalid or expired. Ask the Admin to reissue the invite.';
      end if;

      insert into public.workspace_members(workspace_id,user_id,role)
      values(v_invite.workspace_id,v_user,v_invite.role);
      delete from public.workspace_invitations where id = v_invite.id;
      v_workspace := v_invite.workspace_id;
    else
      if nullif(trim(p_invite_code),'') is not null then
        raise exception 'No pending invitation matches this code.';
      end if;
      insert into public.workspaces(name,owner_id)
      values(coalesce(nullif(trim(p_name),''),'BrandLens Workspace'),v_user)
      returning id into v_workspace;
      insert into public.workspace_members(workspace_id,user_id,role)
      values(v_workspace,v_user,'admin');
      insert into public.workspace_state(owner_id,workspace_id,payload,updated_at)
      values(v_user,v_workspace,jsonb_set(coalesce(p_initial_payload,'{}'::jsonb),'{audit}','[]'::jsonb,true),now());
    end if;
  end if;

  select m.role,w.name,s.payload,s.revision into v_role,v_name,v_payload,v_revision
  from public.workspace_members m
  join public.workspaces w on w.id=m.workspace_id
  left join public.workspace_state s on s.workspace_id=w.id
  where m.workspace_id=v_workspace and m.user_id=v_user;

  if v_role is null then raise exception 'No workspace membership found for this account.'; end if;
  if v_payload is null then raise exception 'Workspace state is missing; ask an admin to sync it.'; end if;
  return jsonb_build_object('workspace_id',v_workspace,'workspace_name',v_name,'role',v_role,'revision',v_revision,'payload',v_payload);
end;
$$;

drop function if exists public.save_brandlens_workspace(uuid, jsonb);

create or replace function public.save_brandlens_workspace(
  p_workspace_id uuid,
  p_payload jsonb,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_old jsonb;
  v_next jsonb;
  v_owner uuid;
  v_revision bigint;
begin
  v_role := public.brandlens_role(p_workspace_id);
  if v_role is null then
    raise exception 'You are not a member of this workspace.';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_payload->'draft') is distinct from 'string'
     or length(p_payload->>'draft') > 30000
     or jsonb_typeof(p_payload->'draftName') is distinct from 'string'
     or length(p_payload->>'draftName') > 100
     or (p_payload ? 'audit' and jsonb_typeof(p_payload->'audit') is distinct from 'array') then
    raise exception 'Workspace payload is invalid or exceeds the draft limits.';
  end if;

  select s.payload, s.owner_id, s.revision
  into v_old, v_owner, v_revision
  from public.workspace_state s
  where s.workspace_id = p_workspace_id
  for update;

  if v_old is null then
    raise exception 'Workspace state was not found.';
  end if;

  if p_expected_revision is distinct from v_revision then
    raise exception 'Workspace changed since your last sync. Reload the latest workspace before saving.'
      using errcode = '40001';
  end if;

  if v_role = 'creator' then
    -- Creators submit draft text only. Shared findings, decisions, evidence,
    -- approvals, and activity remain controlled by Admins and Reviewers.
    v_next := v_old || jsonb_build_object(
      'draft', p_payload->'draft',
      'draftName', p_payload->'draftName'
    );
  else
    if v_role = 'reviewer'
       and coalesce(p_payload->'ruleDecisions','[]'::jsonb) is distinct from coalesce(v_old->'ruleDecisions','[]'::jsonb) then
      raise exception 'Only an Admin can record guideline owner decisions.';
    end if;
    -- Snapshot saves can never insert, rewrite, or delete audit entries. New
    -- shared events go through the server-stamped append-only audit RPC below.
    v_next := p_payload || jsonb_build_object('audit',coalesce(v_old->'audit','[]'::jsonb));
  end if;

  update public.workspace_state
  set payload = v_next,
      revision = v_revision + 1,
      updated_at = now()
  where workspace_id = p_workspace_id
    and owner_id = v_owner;

  return jsonb_build_object('revision', v_revision + 1, 'payload', v_next);
end;
$$;

drop function if exists public.invite_brandlens_member(uuid,text,text);

create or replace function public.invite_brandlens_member(
  p_workspace_id uuid,
  p_email text,
  p_role text,
  p_invite_code_hash text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if public.brandlens_role(p_workspace_id) <> 'admin' then raise exception 'Only an admin can invite members.'; end if;
  if p_role not in ('reviewer','creator') then raise exception 'Choose Reviewer or Creator for an invite.'; end if;
  if lower(trim(p_email)) = lower(coalesce(auth.jwt()->>'email','')) then raise exception 'You already have workspace access.'; end if;
  if coalesce(trim(p_email),'') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email address.'; end if;
  if coalesce(trim(p_invite_code_hash),'') !~ '^[0-9a-fA-F]{64}$' then raise exception 'Invitation code digest is invalid.'; end if;
  insert into public.workspace_invitations(workspace_id,email,role,invited_by,invite_code_hash,expires_at)
  values(p_workspace_id,lower(trim(p_email)),p_role,auth.uid(),lower(trim(p_invite_code_hash)),now()+interval '7 days')
  on conflict(workspace_id,email) do update set role=excluded.role,invited_by=excluded.invited_by,
    invite_code_hash=excluded.invite_code_hash,expires_at=excluded.expires_at,created_at=now();
end;
$$;

create or replace function public.list_brandlens_team(p_workspace_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare v_result jsonb;
begin
  if public.brandlens_role(p_workspace_id) <> 'admin' then raise exception 'Only an admin can view the full team list.'; end if;
  select jsonb_build_object(
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'created_at',m.created_at) order by m.created_at)
      from public.workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=p_workspace_id),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('email',i.email,'role',i.role,'created_at',i.created_at,
      'expires_at',i.expires_at,'has_invite_code',i.invite_code_hash is not null) order by i.created_at)
      from public.workspace_invitations i where i.workspace_id=p_workspace_id),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.remove_brandlens_member(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if public.brandlens_role(p_workspace_id) <> 'admin' then raise exception 'Only an admin can remove members.'; end if;
  if exists(select 1 from public.workspaces w where w.id=p_workspace_id and w.owner_id=p_user_id) then raise exception 'The workspace owner cannot be removed.'; end if;
  delete from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id;
end;
$$;

revoke all on function public.get_or_create_brandlens_workspace(text,jsonb,text) from public, anon;
revoke all on function public.save_brandlens_workspace(uuid,jsonb,bigint) from public, anon;
revoke all on function public.invite_brandlens_member(uuid,text,text,text) from public, anon;
revoke all on function public.list_brandlens_team(uuid) from public, anon;
revoke all on function public.remove_brandlens_member(uuid,uuid) from public, anon;
grant execute on function public.get_or_create_brandlens_workspace(text,jsonb,text) to authenticated;
grant execute on function public.save_brandlens_workspace(uuid,jsonb,bigint) to authenticated;
grant execute on function public.invite_brandlens_member(uuid,text,text,text) to authenticated;
grant execute on function public.list_brandlens_team(uuid) to authenticated;
grant execute on function public.remove_brandlens_member(uuid,uuid) to authenticated;

-- Canonical shared activity events. Workspace JSON snapshots are not allowed to
-- replace this table; actors and timestamps are assigned by the database.
create table if not exists public.workspace_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_key uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (length(action) between 1 and 80),
  detail text not null check (length(detail) <= 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (workspace_id, event_key)
);

alter table public.workspace_audit_events enable row level security;
drop policy if exists "BrandLens members can read shared audit events" on public.workspace_audit_events;
create policy "BrandLens members can read shared audit events" on public.workspace_audit_events
for select to authenticated using (public.brandlens_is_member(workspace_id));
revoke all on public.workspace_audit_events from anon, authenticated;
grant select on public.workspace_audit_events to authenticated;

create or replace function public.prevent_brandlens_audit_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Shared BrandLens audit events are append-only.';
end;
$$;
drop trigger if exists workspace_audit_events_immutable on public.workspace_audit_events;
create trigger workspace_audit_events_immutable
before update or delete on public.workspace_audit_events
for each row execute function public.prevent_brandlens_audit_mutation();

create or replace function public.append_brandlens_audit_event(p_workspace_id uuid, p_event jsonb)
returns jsonb language plpgsql security definer
set search_path = public, auth, pg_temp as $$
declare
  v_role text := public.brandlens_role(p_workspace_id);
  v_action text := trim(coalesce(p_event->>'action',''));
  v_event_key uuid;
  v_row public.workspace_audit_events%rowtype;
begin
  if v_role is null then raise exception 'You are not a member of this workspace.'; end if;
  if v_action not in (
    'Claim queued for re-review','Past approval queued for re-review','Source version created','Source details saved',
    'Source added','Claim re-reviewed','Approved claim added','Draft reviewed','Optional Qwen review completed',
    'Verified rewrite accepted','Verified rewrite rejected','Finding dismissed','Finding escalated',
    'Finding resolved with evidence','Draft approved by workspace owner','Workspace synced to Supabase',
    'Workspace loaded from Supabase','Source removed','Claim removed','Workspace member removed',
    'Guideline owner decision recorded','Workspace invite created'
  ) then raise exception 'This activity action is not supported.'; end if;
  if v_role = 'creator' and v_action not in (
    'Draft reviewed','Verified rewrite accepted','Verified rewrite rejected',
    'Workspace synced to Supabase','Workspace loaded from Supabase'
  ) then raise exception 'Creators cannot append reviewer, approval, source, or policy decisions.'; end if;
  if v_role <> 'admin' and v_action = 'Guideline owner decision recorded' then
    raise exception 'Only an Admin can append a guideline owner decision.';
  end if;
  if v_role <> 'admin' and v_action in ('Workspace invite created','Workspace member removed') then
    raise exception 'Only an Admin can append workspace access events.';
  end if;
  if jsonb_typeof(p_event) is distinct from 'object'
     or jsonb_typeof(p_event->'metadata') not in ('object','null')
     or length(coalesce(p_event->>'detail','')) > 2000 then
    raise exception 'Audit event payload is invalid.';
  end if;
  begin v_event_key := (p_event->>'event_key')::uuid;
  exception when others then raise exception 'Audit event key must be a UUID.'; end;

  insert into public.workspace_audit_events(workspace_id,event_key,actor_id,action,detail,metadata)
  values(p_workspace_id,v_event_key,auth.uid(),v_action,coalesce(p_event->>'detail',''),coalesce(p_event->'metadata','{}'::jsonb))
  on conflict(workspace_id,event_key) do nothing;
  select * into v_row from public.workspace_audit_events
  where workspace_id=p_workspace_id and event_key=v_event_key;
  return jsonb_build_object('id',v_row.id,'event_key',v_row.event_key,'workspace_id',v_row.workspace_id,
    'actor_id',v_row.actor_id,'action',v_row.action,'detail',v_row.detail,'metadata',v_row.metadata,'created_at',v_row.created_at);
end;
$$;

create or replace function public.list_brandlens_audit_events(p_workspace_id uuid, p_limit integer default 200)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_events jsonb;
begin
  if not public.brandlens_is_member(p_workspace_id) then raise exception 'You are not a member of this workspace.'; end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]'::jsonb)
  into v_events from (
    select id,event_key,workspace_id,actor_id,action,detail,metadata,created_at
    from public.workspace_audit_events where workspace_id=p_workspace_id
    order by created_at desc,id desc limit greatest(1,least(coalesce(p_limit,200),500))
  ) e;
  return v_events;
end;
$$;

revoke all on function public.append_brandlens_audit_event(uuid,jsonb) from public, anon;
revoke all on function public.list_brandlens_audit_events(uuid,integer) from public, anon;
grant execute on function public.append_brandlens_audit_event(uuid,jsonb) to authenticated;
grant execute on function public.list_brandlens_audit_events(uuid,integer) to authenticated;
