import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDraft } from '../public/review-engine.js';
import {
  collectGuidelineInsights, detectGuidelineConflicts, extractKeyValues,
  proposeVerifiedRewrite, refreshEvidenceLifecycle, updateSourceVersion, wordDiff
} from '../public/workflow.js';

test('extracts exact quantities and normalizes weeks to days', () => {
  assert.deepEqual(extractKeyValues('A 2-week study with 30 participants found 15% improvement.'), [
    { value:14, unit:'day', display:'2-week' },
    { value:30, unit:'person', display:'30 participants' },
    { value:15, unit:'%', display:'15%' }
  ]);
  assert.deepEqual(extractKeyValues('The grant was ₹12,500.'),[{value:12500,unit:'inr',display:'₹12,500'}]);
});

test('source edits preserve the prior version and stale dependent claims and approvals', () => {
  const source={id:'source-1',title:'Study',type:'Claim evidence',owner:'Hariom',expiry:'2027-01-01',content:'A 14-day study.',version:1,updated:'2026-10-01'};
  const claim={id:'claim-1',wording:'In a 14-day study',alternativeWording:'In a two-week study',sourceId:source.id,sourceVersion:1,supportingExcerpt:source.content,expiryDate:'2027-01-01',status:'approved'};
  const state={sources:[source],claims:[claim],approvalRecords:[{id:'approval-1',status:'approved',sourceRefs:[{sourceId:source.id,version:1}],claimRefs:[claim.id]}],audit:[]};
  const update=updateSourceVersion(source,{content:'A 21-day study.'},'2026-11-01T12:00:00Z');
  assert.equal(update.changed,true);
  state.sources[0]=update.source;
  assert.equal(state.sources[0].version,2);
  assert.equal(state.sources[0].versions[0].content,'A 14-day study.');
  const queue=refreshEvidenceLifecycle(state,'2026-11-01');
  assert.equal(queue.claims.length,1);
  assert.equal(state.claims[0].status,'re-review');
  assert.equal(queue.approvals.length,1);
});

test('claim edits invalidate prior approvals even when the source version is unchanged', () => {
  const source={id:'source-1',title:'Study',type:'Claim evidence',expiry:'2027-01-01',content:'A 14-day study found improved hydration.',version:1};
  const claim={id:'claim-1',version:2,wording:'Hydration improved in 14 days.',sourceId:source.id,sourceVersion:1,supportingExcerpt:source.content,expiryDate:'2027-01-01',status:'approved'};
  const state={sources:[source],claims:[claim],approvalRecords:[{id:'approval-1',status:'approved',sourceRefs:[{sourceId:source.id,version:1}],claimRefs:[{claimId:claim.id,version:1,sourceVersion:1}]}],audit:[]};
  const queue=refreshEvidenceLifecycle(state,'2026-11-01');
  assert.equal(queue.approvals.length,1);
  assert.match(queue.approvals[0].staleReason,/claim/);
});

test('expired sources and claim dates enter the re-review queue', () => {
  const state={sources:[{id:'s',version:1,expiry:'2026-10-31',content:'Hydration result'}],claims:[{id:'c',sourceId:'s',sourceVersion:1,wording:'Hydration improved',supportingExcerpt:'Hydration result',expiryDate:'2026-10-30',status:'approved'}],approvalRecords:[]};
  assert.equal(refreshEvidenceLifecycle(state,'2026-11-01').claims.length,1);
  assert.match(state.claims[0].staleReason,/Source review date passed/);
});

test('detects and surfaces conflicting guideline thresholds', () => {
  const sources=[
    {id:'g1',type:'Brand guideline',title:'Voice guide',owner:'Brand owner',content:'Use at most one exclamation mark per post.'},
    {id:'g2',type:'Brand guideline',title:'Social exception',owner:'Campaign owner',content:'Use at least two exclamation marks per post.'}
  ];
  const conflicts=detectGuidelineConflicts(sources);
  assert.equal(conflicts.length,1);
  assert.equal(conflicts[0].examples.length,2);
});

test('flags an approved claim that uses wording restricted by a guideline', () => {
  const sources=[{id:'g',type:'Brand guideline',title:'Claims guide',content:'Avoid “erase” and guarantees.'}];
  const claims=[{id:'c',sourceId:'s',status:'approved',wording:'Erase dark spots in 14 days.'}];
  const conflicts=detectGuidelineConflicts(sources,claims);
  assert.equal(conflicts.length,1);
  assert.match(conflicts[0].summary,/restriction/);
});

test('guideline insight groups repeated dismissals and reports post-decision follow-up', () => {
  const state={sources:[],ruleDecisions:[{id:'d',insightKey:'rule:all-caps',action:'clarify',at:'2026-10-20T00:00:00Z'}],audit:[
    {ruleKey:'rule:all-caps',ruleType:'All-caps text',category:'readability',decision:'dismissed',at:'2026-10-18T00:00:00Z'},
    {ruleKey:'rule:all-caps',ruleType:'All-caps text',category:'readability',decision:'override',at:'2026-10-19T00:00:00Z'},
    {ruleKey:'rule:all-caps',ruleType:'All-caps text',category:'readability',decision:'dismissed',at:'2026-10-21T00:00:00Z'}
  ]};
  const result=collectGuidelineInsights(state);
  assert.equal(result.patterns.length,1);
  assert.equal(result.patterns[0].dismissed,2);
  assert.equal(result.patterns[0].afterCount,1);
  assert.equal(result.patterns[0].afterDismissalRate,1);
});

test('verified rewrite uses an approved terminology mapping and creates a word-level diff', () => {
  const guide={id:'guide',type:'Brand guideline',title:'Terminology guide',content:'Replace “whitening” with “brightening”.'};
  const draft='Our whitening serum is here.';
  const finding={type:'Terminology',category:'terminology',quote:'whitening',suggestion:'brightening',sourceId:guide.id,sourceTitle:guide.title,sourceQuote:guide.content};
  const proposal=proposeVerifiedRewrite({draft,finding,sources:[guide],analyzeDraft});
  assert.equal(proposal.replacement,'brightening');
  assert.equal(proposal.provenance,'approved-guideline');
  assert.equal(proposal.diff.beforeChange,'whitening');
  assert.equal(proposal.diff.afterChange,'brightening');
});

test('rewrites refuse to remove links or invent numbers for a claim', () => {
  const guide={id:'g',type:'Brand guideline',title:'Guide',content:'Replace “short” with “clear”.'};
  const unsafe=proposeVerifiedRewrite({draft:'Read https://example.test/whitening',finding:{type:'Terminology',category:'terminology',quote:'https://example.test/whitening',suggestion:'clear'},sources:[guide],analyzeDraft});
  assert.equal(unsafe,null);
  const claim={id:'c',wording:'Hydration improved in 14 days',alternativeWording:'Hydration improved by 20% in 14 days',sourceId:'s',sourceVersion:1,supportingExcerpt:'A 14-day study found improved hydration.',expiryDate:'2027-01-01',status:'approved'};
  const source={id:'s',version:1,expiry:'2027-01-01',content:claim.supportingExcerpt};
  const proposal=proposeVerifiedRewrite({draft:'Hydration improved in 3 days',finding:{type:'Numeric conflict',category:'claim',quote:'Hydration improved in 3 days'},sources:[source],claims:[claim],today:'2026-11-01',analyzeDraft});
  assert.equal(proposal,null);
});

test('word diff keeps unchanged edges visible', () => {
  assert.deepEqual(wordDiff('Use whitening today','Use brightening today'),{
    beforePrefix:'Use ',beforeChange:'whitening',beforeSuffix:' today',
    afterPrefix:'Use ',afterChange:'brightening',afterSuffix:' today'
  });
});
