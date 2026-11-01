import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { generateInviteCode, hashInviteCode, isInviteCode } from '../public/invite-security.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('generateInviteCode_returns_256_bit_hex_token', () => {
  const code = generateInviteCode(webcrypto);
  assert.equal(code.length, 64);
  assert.match(code, /^[0-9a-f]{64}$/);
});

test('hashInviteCode_returns_stable_sha256_hex_digest', async () => {
  const code = 'abcdef0123456789'.repeat(4);
  const digest = await hashInviteCode(code, webcrypto);
  assert.equal(digest.length, 64);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(await hashInviteCode(code, webcrypto), digest);
  assert.equal(await hashInviteCode(code.toUpperCase(), webcrypto), digest);
  assert.notEqual(digest, code);
});

test('isInviteCode_rejects_missing_malformed_and_wrong_length_values', () => {
  for (const value of [null, undefined, '', 'not-a-code', 'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(64)}\n`, `\n${'a'.repeat(64)}`]) {
    assert.equal(isInviteCode(value), false, `expected ${String(value)} to be rejected`);
  }
  assert.equal(isInviteCode('a'.repeat(64)), true);
  assert.equal(isInviteCode('A'.repeat(64)), true);
});

test('signup_and_signin_pass_optional_invite_code_to_workspace_rpc', () => {
  assert.match(app, /name="inviteCode"/);
  assert.match(app, /pendingInviteCode\s*=\s*\(data\.inviteCode/);
  assert.match(app, /syncWorkspace\(mode='load',\s*inviteCode=pendingInviteCode\)/);
  assert.match(app, /p_invite_code\s*:\s*inviteCode\s*\|\|\s*null/);
});

test('signed_in_invitee_can_enter_code_after_returning_with_restored_session', () => {
  assert.match(app, /function\s+inviteCodeModal\s*\(/);
  assert.match(app, /id="invite-code-form"/);
  assert.match(app, /form\.id==='invite-code-form'/);
  assert.match(app, /!\$\('#invite-code-form'\)[\s\S]*?inviteCodeModal\(\)/);
});

test('non_invitation_sync_errors_do_not_turn_login_into_invite_retry', () => {
  assert.match(app, /const invitationRejected\s*=\s*\/invitation code\|pending invitation matches\/i\.test\(error\.message\)/);
  assert.match(app, /if\(invitationRejected\)\{showInviteRetryMode\(\)/);
});

test('sign_out_clears_unsaved_invitation_code_from_memory', () => {
  assert.match(app, /pendingInviteCode\s*=\s*'';session=null/);
});

test('admin_invite_sends_digest_and_displays_raw_code_once', () => {
  assert.match(app, /const inviteCode\s*=\s*generateInviteCode\s*\(\s*\)/);
  assert.match(app, /hashInviteCode\s*\(\s*inviteCode\s*\)/);
  assert.match(app, /p_invite_code_hash\s*:/);
  assert.match(app, /invite-code-once/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*inviteCode/i);
});

test('team_listing_does_not_render_digest', () => {
  const teamRenderer = app.slice(app.indexOf('async function renderTeam'), app.indexOf('function renderAll'));
  assert.match(teamRenderer, /has_invite_code/);
  assert.match(teamRenderer, /expires_at/);
  assert.doesNotMatch(teamRenderer, /invite_code_hash/i);
});
