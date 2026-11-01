import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

function functionBody(name) {
  const pattern = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\)\\s*[\\s\\S]*?as\\s+\\$\\$([\\s\\S]*?)\\$\\$;`, 'i');
  const match = sql.match(pattern);
  assert.ok(match, `expected public.${name} function in schema`);
  return { signature: match[1], body: match[2] };
}

test('workspace_invitation_requires_matching_digest_and_unexpired_code', () => {
  const workspace = functionBody('get_or_create_brandlens_workspace');
  assert.match(sql, /invite_code_hash\s+text/i);
  assert.match(sql, /expires_at\s+timestamptz/i);
  assert.match(workspace.signature, /p_invite_code\s+text/i);
  assert.match(workspace.body, /from\s+pg_extension\s+e\s+join\s+pg_namespace\s+n/i);
  assert.match(workspace.body, /execute\s+format\s*\(\s*'select\s+encode\s*\(%i\.digest/i);
  assert.match(workspace.body, /'sha256'/i);
  assert.match(workspace.body, /lower\s*\(\s*trim\s*\(\s*p_invite_code\s*\)\s*\)/i);
  assert.match(workspace.body, /lower\s*\(\s*i\.email\s*\)\s*=\s*v_email/i);
  assert.match(workspace.body, /v_email\s+text\s*:=\s*lower\s*\(\s*trim\s*\(\s*coalesce\s*\(\s*auth\.jwt\(\)->>'email',''\s*\)\s*\)\s*\)/i);
  assert.match(workspace.body, /i\.expires_at\s*>\s*now\s*\(\s*\)/i);
  assert.match(workspace.body, /delete\s+from\s+public\.workspace_invitations\s+where\s+id\s*=\s*v_invite\.id/i);
});

test('legacy_invitation_without_digest_is_not_accepted', () => {
  const { body } = functionBody('get_or_create_brandlens_workspace');
  assert.match(body, /i\.invite_code_hash\s+is\s+not\s+null/i);
  assert.match(body, /i\.expires_at\s+is\s+not\s+null/i);
});

test('pending_invite_without_code_does_not_create_an_unrelated_workspace', () => {
  const { body } = functionBody('get_or_create_brandlens_workspace');
  const pendingBranch = body.indexOf('if v_has_invitation');
  const missingCodeGuard = body.indexOf('p_invite_code', pendingBranch);
  const reject = body.indexOf('raise exception', missingCodeGuard);
  const workspaceCreation = body.indexOf('insert into public.workspaces', pendingBranch);
  assert.ok(pendingBranch >= 0, 'pending invitation branch exists');
  assert.ok(missingCodeGuard > pendingBranch, 'pending branch checks the submitted code');
  assert.ok(reject > missingCodeGuard, 'invalid or missing code is rejected');
  assert.ok(workspaceCreation > reject, 'workspace creation happens only after pending invite handling');
});

test('stale_code_without_pending_invite_does_not_create_a_new_workspace', () => {
  const { body } = functionBody('get_or_create_brandlens_workspace');
  assert.match(body, /if\s+nullif\s*\(\s*trim\s*\(\s*p_invite_code\s*\)\s*,\s*''\s*\)\s+is\s+not\s+null\s+then\s+raise\s+exception\s+'No pending invitation matches this code\.'/i);
  const staleCodeRejection = body.indexOf('No pending invitation matches this code.');
  const workspaceCreation = body.indexOf('insert into public.workspaces');
  assert.ok(staleCodeRejection >= 0 && staleCodeRejection < workspaceCreation);
});

test('existing_member_and_first_admin_do_not_need_a_code', () => {
  const { body } = functionBody('get_or_create_brandlens_workspace');
  const existingMember = body.indexOf('from public.workspace_members m where m.user_id = v_user');
  const inviteRedemption = body.indexOf('if v_has_invitation');
  const firstWorkspace = body.indexOf('insert into public.workspaces');
  assert.ok(existingMember >= 0 && existingMember < inviteRedemption, 'existing membership is checked before invite redemption');
  assert.ok(firstWorkspace > inviteRedemption, 'first workspace creation remains the no-pending-invite path');
  assert.match(body, /if v_workspace is null then[\s\S]*?insert into public\.workspace_members/i);
});

test('expired_or_consumed_invites_cannot_be_redeemed_again', () => {
  const { body } = functionBody('get_or_create_brandlens_workspace');
  assert.match(body, /i\.expires_at\s*>\s*now\s*\(\s*\)/i);
  const consume = body.indexOf('delete from public.workspace_invitations where id = v_invite.id');
  const memberInsert = body.indexOf('insert into public.workspace_members', body.indexOf('if v_has_invitation'));
  assert.ok(consume > memberInsert, 'the matched invitation is consumed in the membership branch');
});

test('privileged_audit_labels_are_admin_only', () => {
  const { body } = functionBody('append_brandlens_audit_event');
  assert.match(body, /if\s+v_role\s*<>\s*'admin'\s+and\s+v_action\s+in\s*\([\s\S]*?'Workspace invite created'[\s\S]*?'Workspace member removed'[\s\S]*?\)\s+then/i);
  assert.match(body, /v_role\s*<>\s*'admin'[\s\S]*?v_action\s*=\s*'Guideline owner decision recorded'/i);
});

test('team_listing_never_returns_invite_digest', () => {
  const { body } = functionBody('list_brandlens_team');
  assert.doesNotMatch(body, /'invite_code_hash'\s*,/i);
  assert.match(body, /expires_at/i);
  assert.match(body, /has_invite_code/i);
});
