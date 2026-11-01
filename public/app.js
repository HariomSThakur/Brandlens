import { analyzeDraft } from "./review-engine.js";
import { claimReviewReasons, collectGuidelineInsights, extractKeyValues, migrateClaim, proposeVerifiedRewrite, refreshEvidenceLifecycle, updateSourceVersion, wordDiff } from "./workflow.js";
const STORAGE_KEY = 'brandlens.round2.workspace.v1';
const SESSION_KEY = 'brandlens.supabase.session.v1';
const THEME_KEY = 'brandlens.theme.v3';
const today = new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Kolkata'}).format(new Date());
const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const iso = () => new Date().toISOString();
const fmtDate = value => value ? new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '—';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sampleState = () => {
  const facts = { id:id(), version:1, versions:[], title:'Approved product facts — Dewdrop Serum', type:'Product facts', owner:'Hariom Thakur', expiry:'2026-12-31', updated:iso(), content:'A 28-day consumer use test with 30 participants found improved skin hydration. The study did not evaluate pigmentation, acne, or effects within three days.' };
  const guide = { id:id(), version:1, versions:[], title:'Brand voice and claims guide', type:'Brand guideline', owner:'Hariom Thakur', expiry:'2027-03-31', updated:iso(), content:'Use clear, warm, evidence-led language. Avoid guarantees, “clinically proven”, “erase”, and unsupported timeframes. Replace “whitening” with “brightening”. Use sentence case; avoid all-caps sentences. Use at most one exclamation mark per post.' };
  const conflict = { id:id(), version:1, versions:[], title:'Social campaign caption exception (demo conflict)', type:'Brand guideline', owner:'Hariom Thakur', expiry:'2027-03-31', updated:iso(), content:'Use at least two exclamation marks per post.' };
  const old = { id:id(), version:1, versions:[], title:'Historical customer count export', type:'Claim evidence', owner:'Hariom Thakur', expiry:'2026-06-30', updated:iso(), content:'An old store export recorded 50,000 customer orders. It is not independently audited and is past its review date; it must not be used as current proof of customer popularity.' };
  return {
    workspace:'Luma Botanics', sources:[facts,guide,conflict,old],
    claims:[
      {id:id(), wording:'In a 28-day consumer use test, participants showed improved skin hydration.', alternativeWording:'In a 28-day consumer use test, participants showed improved skin hydration.', sourceId:facts.id, sourceVersion:1, supportingExcerpt:'A 28-day consumer use test with 30 participants found improved skin hydration.', keyValues:extractKeyValues('A 28-day consumer use test with 30 participants found improved skin hydration.'), owner:'Hariom Thakur', reviewDate:'2026-12-31', expiryDate:'2026-12-31', approvedAt:iso(), status:'approved', history:[]},
      {id:id(), wording:'Loved by 50,000 customers', sourceId:old.id, sourceVersion:1, supportingExcerpt:'An old store export recorded 50,000 customer orders.', keyValues:extractKeyValues('An old store export recorded 50,000 customer orders.'), owner:'Hariom Thakur', reviewDate:'2026-06-30', expiryDate:'2026-06-30', status:'re-review', history:[]}
    ],
    draftName:'Spring launch — social post',
    draft:'Clinically proven to erase dark spots in 3 days! Loved by 50,000 customers!!!',
    findings:[], audit:[{id:id(),action:'Demo workspace opened',detail:'Fictional sample sources loaded in this browser.',at:iso()}],
    reviews:0, approvals:0, approvalRecords:[], ruleDecisions:[], rewriteHistory:[], reviewed:false
  };
};
let state;
try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || sampleState(); } catch { state = sampleState(); }
state.sources ||= []; state.sources.forEach(s=>{s.version ||= 1;s.versions ||= [];}); state.claims ||= []; state.claims=state.claims.map(c=>migrateClaim(c,state.sources.find(s=>s.id===c.sourceId))||({...c,status:'re-review'})); state.findings ||= []; state.audit ||= []; state.reviews ||= 0; state.approvals ||= 0; state.approvalRecords ||= []; state.ruleDecisions ||= []; state.rewriteHistory ||= [];
state.reviewedDraft ??= state.reviewed ? (state.draft || '') : null;
const reviewSignature = () => JSON.stringify([state.draft, state.sources.map(({id,version,title,type,expiry,content})=>[id,version,title,type,expiry,content]), state.claims.map(({id,wording,alternativeWording,sourceId,sourceVersion,supportingExcerpt,keyValues,expiryDate,status})=>[id,wording,alternativeWording,sourceId,sourceVersion,supportingExcerpt,keyValues,expiryDate,status])]);
state.reviewedSignature ??= state.reviewed ? reviewSignature() : null;
let config = {supabaseUrl:'',supabaseAnonKey:'',ollamaReady:false,ollamaModel:''};
let session = null;
let workspaceId = null;
let workspaceName = "";
let workspaceRole = null;
let workspaceRevision = null;
let auditRpcAvailable = null;
let teamRequestVersion = 0;
try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch {}
let page = 'review';
let pendingAction = null;
const $ = selector => document.querySelector(selector);
const modal = $('#modal-backdrop');
function setTheme(theme) {
  const value = ['light','dark','blue'].includes(theme) ? theme : 'light';
  document.documentElement.dataset.theme = value;
  localStorage.setItem(THEME_KEY, value);
  const selector = $('#theme-select'); if (selector) selector.value = value;
  const colors = {light:'#f5f8f8',dark:'#0d1217',blue:'#0b1424'};
  $('meta[name=theme-color]')?.setAttribute('content', colors[value]);
}
try { setTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch { setTheme('dark'); }

function audit(action, detail, metadata={}) {
  const item={id:id(),eventKey:id(),action,detail,at:iso(),...metadata,remoteStatus:session&&workspaceId&&auditRpcAvailable!==false?'pending':'local'};
  state.audit.push(item); localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  if(session&&workspaceId&&auditRpcAvailable!==false) rpcRequest('append_brandlens_audit_event',{p_workspace_id:workspaceId,p_event:{event_key:item.eventKey,action:item.action,detail:item.detail,metadata}})
    .then(remote=>{Object.assign(item,{id:remote.id||item.id,actor_id:remote.actor_id,at:remote.created_at||item.at,remoteStatus:'saved'});renderActivity();})
  .catch(error=>{item.remoteStatus='pending';renderActivity();toast(`Activity event is not in the shared audit yet. Sync again when online. ${error.message}`,true);});
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  $('#storage-status').innerHTML = `<i></i> ${session ? 'Supabase connected' : 'Local demo'}`;
  $('#storage-description').textContent = session ? `Signed in as ${session.user?.email || 'workspace member'} (${workspaceRole || 'loading role'}). Use Sync workspace to save changes for the shared team.` : 'Local demo mode stores your workspace in this browser only. No account or cloud sync is active.';
  const hint=$('#workspace-hint'); if(hint) hint.innerHTML=`<span class="pulse-dot"></span> ${session&&workspaceId?'Shared with your workspace team':'Drafts stay private in this browser'}`;
}
function sourceById(sourceId) { return state.sources.find(item => item.id === sourceId); }
function openFindings() { return state.findings.filter(f => f.status === 'open' || f.status === 'escalated'); }
function reviewIsCurrent() { return Boolean(state.reviewed && state.reviewedOn===today && state.reviewedDraft === state.draft && state.reviewedSignature === reviewSignature()); }
function renderStats() {
  const queue=refreshEvidenceLifecycle(state,today);
  const expired = state.sources.filter(s => s.expiry && s.expiry < today).length;
  const open = openFindings().length;
  $('#stats-grid').innerHTML = [
    ['Drafts reviewed',state.reviews,'In this browser','teal','▤'],
    ['Open findings',open,open ? 'Needs a decision' : 'No open findings','gold','!'],
    ['Sources expiring',expired,expired ? 'Past review date' : 'No expired sources','red','◷'],
    ['Approvals logged',state.approvals,'Human decisions only','blue','✓']
  ].map(([label,value,note,color,icon])=>`<div class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`).join('');
  $('#open-count').textContent = open;
  $('#source-count').textContent = state.sources.length;
  $('#claim-count').textContent = state.claims.length;
}
function renderSources() {
  $('#source-preview').innerHTML = state.sources.slice(0,3).map(s=>`<article class="source-mini"><b>${esc(s.title)}</b><span>${esc(s.type)} · review by ${fmtDate(s.expiry)}</span></article>`).join('') || '<div class="empty-table">Add an approved source to start a review.</div>';
  $('#sources-list').innerHTML = state.sources.map(s=>{
    const expired = s.expiry && s.expiry < today;
    const linked=state.claims.some(c=>c.sourceId===s.id)||state.approvalRecords.some(a=>(a.sourceRefs||[]).some(r=>r.sourceId===s.id));
    const actions=canManageLibrary()?`<div><button class="mini-action" data-edit-source="${esc(s.id)}">Edit / new version</button><button class="danger-button" data-delete-source="${esc(s.id)}" ${linked?'disabled title="A claim or past approval uses this source"':''}>Remove</button></div>`:'<span class="role-badge">Read only</span>';
    return `<article class="panel resource-card"><div class="resource-head"><span class="resource-type">▤ &nbsp;${esc(s.type)} · v${Number(s.version||1)}</span>${actions}</div><h2>${esc(s.title)}</h2><p>${esc(s.content)}</p><div class="resource-meta"><span>Owner: ${esc(s.owner || 'Unassigned')}</span><span class="${expired?'expired':''}">${expired?'Expired':'Review by'} ${fmtDate(s.expiry)}</span></div>${(s.versions||[]).length?`<details class="history-details"><summary>${s.versions.length} earlier source version(s)</summary>${s.versions.slice().reverse().map(v=>`<div class="history-entry"><b>Version ${esc(v.version)} · ${fmtDate(v.updated)}</b><p>${esc(v.title)} — ${esc(v.content)}</p></div>`).join('')}</details>`:''}</article>`;
  }).join('') || '<div class="panel empty-table">No sources yet. Add approved guidance or evidence.</div>';
}
function renderClaims() {
  $('#claims-table').innerHTML = state.claims.map(c=>{
    const source = sourceById(c.sourceId); const reasons=claimReviewReasons(c,state.sources,today); const expired = reasons.length>0;
    const actions=canManageLibrary()?`<button class="mini-action" data-edit-claim="${esc(c.id)}">${expired?'Re-review':'Edit'}</button><button class="danger-button" data-delete-claim="${esc(c.id)}">Remove</button>`:'<span class="role-badge">Read only</span>';
    return `<tr class="${expired?'stale-row':''}"><td><b>${esc(c.wording)}</b><details class="evidence-details"><summary>Evidence · source v${esc(c.sourceVersion||1)}</summary><p>${esc(c.supportingExcerpt||'No supporting excerpt saved.')}</p><span>Key values: ${esc((c.keyValues||[]).map(v=>`${v.display} (${v.value} ${v.unit})`).join(', ')||'none recorded')}</span>${c.alternativeWording?`<p>Approved alternative: ${esc(c.alternativeWording)}</p>`:''}</details></td><td>${esc(source?.title || 'Source removed')}</td><td>${esc(c.owner || 'Unassigned')}</td><td>${fmtDate(c.expiryDate||c.reviewDate)}</td><td><span class="status-tag ${expired?'expired':''}">${expired?'Re-review required':'Approved'}</span>${expired?`<small class="stale-reason">${esc(reasons.join(' '))}</small>`:''}</td><td>${actions}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-table">No approved claims yet. Add one with a linked source.</td></tr>';
}
function highlighted(draft, quote) {
  const start = draft.indexOf(quote);
  if (start < 0) return esc(quote);
  return `${esc(draft.slice(0,start))}<mark class="highlight">${esc(quote)}</mark>${esc(draft.slice(start+quote.length))}`;
}
function findingCard(f) {
  const sev = ['high','medium','low'].includes(f.severity) ? f.severity : 'medium';
  const source = sourceById(f.sourceId);
  const sourceTitle = f.sourceTitle || source?.title || 'No approved source matched';
  const sourceQuote = f.sourceQuote || source?.content || 'Add or link an approved source to support this finding.';
  const isClaim = f.category === 'claim';
  const actionable = ['open','escalated'].includes(f.status);
  const statusLabel = actionable ? '' : `<span class="finding-status">${esc(f.status === 'updated' ? 'Edit accepted' : f.status)}</span>`;
  let actions = '';
  if (actionable) {
    actions += `<button class="mini-action" data-finding-action="edit" data-id="${esc(f.id)}">Edit draft</button>`;
    if (isClaim && canManageLibrary()) actions += `<button class="mini-action" data-finding-action="resolve" data-id="${esc(f.id)}">Resolve with evidence</button>`;
    if (canManageLibrary()) {
      actions += `<button class="mini-action" data-finding-action="escalate" data-id="${esc(f.id)}">Escalate</button>`;
      if (!isClaim) actions += `<button class="mini-action" data-finding-action="dismiss" data-id="${esc(f.id)}">Dismiss</button>`;
    }
  }
  const rewrite=f.rewriteProposal;
  const rewritePanel=rewrite?`<div class="rewrite-panel"><div class="section-kicker">VERIFIED MINIMAL EDIT · ${esc(rewrite.provenance.replaceAll('-',' '))}</div><div class="word-diff"><span>${esc(rewrite.diff.beforePrefix)}</span><del>${esc(rewrite.diff.beforeChange)}</del><span>${esc(rewrite.diff.beforeSuffix)}</span><span class="diff-arrow">→</span><span>${esc(rewrite.diff.afterPrefix)}</span><ins>${esc(rewrite.diff.afterChange)}</ins><span>${esc(rewrite.diff.afterSuffix)}</span></div><small>From ${esc(rewrite.sourceTitle||'the approved guideline or claim ledger')}. This edit is checked again before approval.</small>${actionable&&f.rewriteStatus!=='rejected'?`<div class="rewrite-actions"><button class="mini-action primary" data-rewrite-action="accept" data-id="${esc(f.id)}">Accept this edit</button><button class="mini-action" data-rewrite-action="reject" data-id="${esc(f.id)}">Reject edit</button></div>`:actionable?'<span class="finding-status">Rewrite rejected · edit manually</span>':`<span class="finding-status">${esc(f.rewriteStatus||'Edit decision pending')}</span>`}</div>`:`<div class="rewrite-panel unavailable"><b>No verified rewrite available</b><small>Nothing in the current ledger supports a safe replacement. Edit manually or ask a Reviewer to update the approved wording.</small></div>`;
  return `<article class="finding-card ${sev}"><div class="finding-top"><span class="finding-type">${esc(f.type)}</span><span class="severity ${sev}">${esc(sev)} risk</span></div><div class="finding-body"><p class="quote">${highlighted(state.draft,f.quote)}</p><p>${esc(f.reason)}</p><div class="source-cite"><b>Related source · ${esc(sourceTitle)}</b>${esc(sourceQuote)}</div>${rewritePanel}</div><div class="finding-actions">${actions}${statusLabel}</div></article>`;
}
function renderFindings() {
  $('#finding-total').textContent = state.findings.length;
  $('#findings-list').innerHTML = state.findings.map(findingCard).join('');
  $('#findings-empty').hidden = state.findings.length > 0;
  $('#edit-history').innerHTML=state.rewriteHistory.length?`<details><summary>Verified edit history · ${state.rewriteHistory.length}</summary>${state.rewriteHistory.slice(0,8).map(r=>`<div class="history-entry"><b>${esc(r.ruleType)} · ${fmtDate(r.at)}</b><div class="word-diff"><del>${esc(r.diff.beforeChange)}</del><span class="diff-arrow">→</span><ins>${esc(r.diff.afterChange)}</ins></div><small>Source: ${esc(sourceById(r.sourceId)?.title||'approved rule or ledger')}</small></div>`).join('')}</details>`:'';
  const summary = $('#review-summary');
  if (state.reviewed) {
    const canApprove = (!session || ['admin','reviewer'].includes(workspaceRole)) && state.findings.every(f => !['open','escalated'].includes(f.status));
    const current = reviewIsCurrent();
    summary.hidden = false;
    const message = !current ? 'The draft changed after this review. Run review again before approval.' : session && workspaceRole === 'creator' ? 'A Reviewer or Admin must record approval for this draft.' : canApprove ? 'All findings have a recorded decision. A person can record approval.' : `${openFindings().length} finding${openFindings().length===1?'':'s'} still need a decision before approval.`;
    summary.innerHTML = `<div>${message}</div><button class="button button-small ${canApprove&&current?'button-primary':'button-outline'}" id="approve-button" ${canApprove&&current?'':'disabled'}>Record human approval</button>`;
  } else { summary.hidden = true; summary.textContent=''; }
}
function renderActivity() {
  $('#activity-list').innerHTML = state.audit.length ? [...state.audit].reverse().map(item=>`<article class="activity-item"><div class="activity-icon">✓</div><div><b>${esc(item.action)}</b><p>${esc(item.detail)}</p>${item.remoteStatus==='pending'?'<small class="stale-reason">Pending secure sync</small>':item.remoteStatus==='local'&&session?'<small class="stale-reason">Local only · latest audit schema required for shared history</small>':item.remoteStatus==='legacy'&&session?'<small class="stale-reason">Legacy snapshot · not in the append-only audit stream</small>':''}</div><time>${new Date(item.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time></article>`).join('') : '<div class="empty-table">No decisions recorded yet.</div>';
}
function canManageLibrary() { return !session || ['admin','reviewer'].includes(workspaceRole); }
function canDecideGuidelines() { return !session || workspaceRole==='admin'; }
function refreshLifecycle() {
  const oldClaims=new Map(state.claims.map(c=>[c.id,c.status]));
  const oldApprovals=new Map(state.approvalRecords.map(a=>[a.id,a.status]));
  const queue=refreshEvidenceLifecycle(state,today);
  for(const {claim,reasons} of queue.claims) if(oldClaims.get(claim.id)==='approved'&&claim.status==='re-review') audit('Claim queued for re-review',`${claim.wording}: ${reasons.join(' ')}`,{insightKey:`claim:${claim.id}`,claimId:claim.id,decision:'source_changed'});
  for(const approval of queue.approvals) if(oldApprovals.get(approval.id)==='approved') audit('Past approval queued for re-review',`${approval.draftName||'Draft'}: ${approval.staleReason}`,{approvalId:approval.id,decision:'source_changed'});
  return queue;
}
function renderQueue() {
  const queue=refreshEvidenceLifecycle(state,today); const node=$('#queue-content');
  const claimCards=queue.claims.map(({claim,reasons})=>`<article class="panel queue-card"><div class="section-kicker">CLAIM · SOURCE VERSION ${esc(claim.sourceVersion||1)}</div><h2>${esc(claim.wording)}</h2><p>${esc(reasons.join(' '))}</p><blockquote>${esc(claim.supportingExcerpt||'No saved supporting excerpt.')}</blockquote><button class="button button-outline" data-edit-claim="${esc(claim.id)}">Review evidence and update claim</button></article>`);
  const approvalCards=queue.approvals.map(a=>`<article class="panel queue-card"><div class="section-kicker">PAST APPROVAL · ${fmtDate(a.createdAt)}</div><h2>${esc(a.draftName||'Previously approved draft')}</h2><p>${esc(a.staleReason||'A supporting source or claim changed.')}</p><button class="button button-primary" data-load-approval="${esc(a.id)}">Load saved draft and review again</button></article>`);
  node.innerHTML=claimCards.length||approvalCards.length?`${claimCards.length?`<div class="queue-section"><div class="section-kicker">CLAIMS NEEDING EVIDENCE REVIEW · ${claimCards.length}</div>${claimCards.join('')}</div>`:''}${approvalCards.length?`<div class="queue-section"><div class="section-kicker">PAST APPROVALS NEEDING A NEW REVIEW · ${approvalCards.length}</div>${approvalCards.join('')}</div>`:''}`:'<div class="panel empty-table">The queue is clear. Changes to a source or its review date will place dependent claims and approvals here.</div>';
  $('#queue-count').textContent=queue.claims.length+queue.approvals.length;
}
function renderInsights() {
  const {patterns,conflicts}=collectGuidelineInsights(state); const node=$('#insights-content');
  const decisionFor=key=>(state.ruleDecisions||[]).filter(d=>d.insightKey===key).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0];
  const actions=key=>canDecideGuidelines()?`<div class="insight-actions"><button class="mini-action" data-insight-action="clarify" data-insight-key="${esc(key)}">Clarify</button><button class="mini-action" data-insight-action="exception" data-insight-key="${esc(key)}">Add exception</button><button class="mini-action" data-insight-action="retire" data-insight-key="${esc(key)}">Retire</button></div>`:'<small class="fine-print">Only the workspace Admin can record the owner decision.</small>';
  const conflictCards=conflicts.map(conflict=>{const d=decisionFor(conflict.key);return `<article class="panel insight-card high"><div class="section-kicker">POSSIBLE SOURCE CONFLICT</div><h2>${esc(conflict.summary)}</h2><div class="insight-examples">${conflict.examples.map(x=>`<blockquote><b>${esc(x.sourceTitle)}</b><br>${esc(x.excerpt)}</blockquote>`).join('')}</div>${d?`<p class="decision-record">Latest owner decision: <b>${esc(d.action)}</b> · ${esc(d.rationale)} · ${fmtDate(d.at)}</p>`:''}${actions(conflict.key)}</article>`;}).join('');
  const patternCards=patterns.map(pattern=>{const d=pattern.latestDecision;const latestRate=pattern.afterDismissalRate===null?'No outcomes recorded since the last decision':`${Math.round(pattern.afterDismissalRate*100)}% dismissal rate across ${pattern.afterCount} later outcomes`;return `<article class="panel insight-card"><div class="section-kicker">REPEATED TEAM OUTCOME · ${esc(pattern.category)}</div><h2>${esc(pattern.ruleType)}</h2><p>${esc(pattern.summary)} Dismissal / accepted-edit rate: ${Math.round(pattern.dismissalRate*100)}% (${pattern.dismissed+pattern.overridden} of ${pattern.total} recorded outcomes).</p><div class="insight-examples">${pattern.examples.map(e=>`<blockquote>${esc(e.quote||e.detail||'Finding outcome recorded.')}</blockquote>`).join('')}</div>${d?`<p class="decision-record">Since “${esc(d.action)}”: ${esc(latestRate)}. This is a signal, not proof that the rule improved.</p>`:''}${actions(pattern.key)}</article>`;}).join('');
  node.innerHTML=conflictCards+patternCards||'<div class="panel empty-table">No repeated outcomes yet. As reviewers dismiss, override, or escalate findings, BrandLens will summarize patterns here. No policy is changed automatically.</div>';
}
async function renderTeam() {
  const node = $('#team-content'); if (!node) return;
  const request = ++teamRequestVersion;
  if (!session) { node.innerHTML = '<div class="panel team-card"><h2>Sign in to manage workspace access</h2><p>Connect Supabase and sign in. Each collaborator uses their own account.</p><button class="button button-primary" data-page="settings">Open settings</button></div>'; return; }
  if (!workspaceId) { node.innerHTML = '<div class="panel team-card"><h2>Workspace not loaded</h2><p>Sync your workspace first to load team permissions.</p></div>'; return; }
  if (workspaceRole !== 'admin') { node.innerHTML = `<div class="panel team-card"><span class="role-badge">${esc(workspaceRole || 'member')}</span><h2>Your workspace role</h2><p>${workspaceRole === 'reviewer' ? 'You can review drafts, maintain approved facts and claims, and record decisions.' : 'You can write drafts and use review suggestions. Sync saves your draft text; shared review findings, evidence, activity, and approvals are managed by Admins and Reviewers.'}</p><p class="fine-print">Ask a workspace Admin to manage invitations or membership.</p></div>`; return; }
  node.innerHTML = '<div class="panel team-card"><h2>Loading team…</h2></div>';
  try {
    const result = await rpcRequest('list_brandlens_team', {p_workspace_id: workspaceId});
    if (request !== teamRequestVersion) return;
    const members = result.members || [], invites = result.invitations || [];
    node.innerHTML = `<div class="panel team-card"><div class="panel-head"><div><div class="section-kicker">INVITE COLLABORATORS</div><h2>Workspace team</h2></div><span class="role-badge">Admin</span></div><form id="invite-form" class="invite-form"><label>Email address<input name="email" type="email" required placeholder="teammate@example.com"></label><label>Role<select name="role"><option value="reviewer">Reviewer</option><option value="creator">Creator</option></select></label><button class="button button-primary">Create invite</button></form><p class="fine-print">Supabase stores the invite but does not send email. Share the invite with the person; they must create/sign in using this exact email. Each account can join one BrandLens workspace in this version.</p></div><div class="panel team-card"><div class="section-kicker">CURRENT MEMBERS</div><h2>People with access</h2><div class="team-list">${members.map(m=>`<div class="team-row"><div class="team-avatar">${esc((m.email||'User').slice(0,1).toUpperCase())}</div><div class="team-person"><b>${esc(m.email||'Account')}</b><small>${fmtDate(m.created_at)}</small></div><span class="role-badge">${esc(m.role)}</span>${m.role==='admin'?'<span class="fine-print">Owner</span>':`<button class="danger-button" data-remove-member="${esc(m.user_id)}">Remove</button>`}</div>`).join('')||'<p class="fine-print">No members yet.</p>'}</div>${invites.length?`<div class="section-kicker invite-heading">PENDING INVITES</div><div class="team-list">${invites.map(i=>`<div class="team-row"><div class="team-person"><b>${esc(i.email)}</b><small>Created ${fmtDate(i.created_at)}</small></div><span class="role-badge">${esc(i.role)}</span></div>`).join('')}</div>`:''}</div>`;
  } catch(error) { if (request === teamRequestVersion) node.innerHTML = `<div class="panel team-card"><h2>Could not load team</h2><p>${esc(error.message)}</p></div>`; }
}
function renderAll({draft=false}={}) {
  refreshLifecycle(); renderStats(); renderSources(); renderClaims(); renderQueue(); renderInsights(); renderFindings(); renderActivity(); renderTeam();
  $('#add-source').hidden = !canManageLibrary(); $('#add-claim').hidden = !canManageLibrary();
  $('#clear-activity').hidden = Boolean(session);
  if (draft) { $('#draft-name').value = state.draftName; $('#draft-text').value = state.draft; updateCharCount(); }
  save();
}
function updateCharCount() { $('#char-count').textContent = `${$('#draft-text').value.length.toLocaleString()} characters`; }
function toast(message, error=false) {
  const node = document.createElement('div'); node.className = `toast${error?' error':''}`; node.textContent = message; $('#toast-stack').append(node); setTimeout(()=>node.remove(),4300);
}
function go(next) {
  page = next;
  document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${next}`));
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===next));
  const names = {review:'Review draft',sources:'Facts & rules',claims:'Approved claims',queue:'Re-review queue',insights:'Guideline health',activity:'Activity log',settings:'Settings',team:'Team'};
  $('#crumb-page').textContent = names[next] || 'Review draft';
  window.scrollTo({top:0,behavior:'smooth'});
}
function makeFinding({type,category='claim',severity='high',quote,sourceId=null,reason,suggestion}) {
  const source=sourceById(sourceId);
  return {id:id(),type,category,severity,quote,sourceId,sourceTitle:source?.title||'',sourceQuote:source?.content||'',reason,suggestion,status:'open',createdAt:iso()};
}
function deterministicReview(draft) {
  return analyzeDraft(draft, { sources: state.sources, claims: state.claims, today })
    .map(finding => {
      const item={ ...finding, id: id(), createdAt: iso(), status: 'open', ruleKey:`rule:${String(finding.type).toLowerCase().replace(/[^a-z0-9]+/g,'-')}` };
      item.rewriteProposal=proposeVerifiedRewrite({draft,finding:item,sources:state.sources,claims:state.claims,today,aiSuggestion:item.model?item.suggestion:'',analyzeDraft});
      return item;
    });
}
async function runReview() {
  const draft=$('#draft-text').value.trim();
  if (!draft) return toast('Add draft text before running a review.',true);
  state.draft=draft; state.draftName=$('#draft-name').value.trim() || 'Untitled draft';
  state.findings=deterministicReview(draft); state.reviews+=1; state.reviewed=true; state.reviewedOn=today; state.reviewedDraft=draft; state.reviewedSignature=reviewSignature();
  audit('Draft reviewed',`${state.findings.length} deterministic finding(s) created for “${state.draftName}”.`);
  renderAll();
  $('#ai-status').innerHTML = config.ollamaReady ? '<i></i> Adding optional Qwen review…' : '<i></i> Deterministic rules only';
  toast(`${state.findings.length} finding${state.findings.length===1?'':'s'} created from the approved rules and source dates.`);
  if (config.ollamaReady) {
    try {
      const result=await fetch('/api/ai-review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draft,sources:state.sources.map(s=>({title:s.title,content:s.content}))})});
      const payload=await result.json(); if(!result.ok) throw new Error(payload.error||'AI review unavailable');
      let added=0;
      for(const f of payload.findings||[]) {
        if(!draft.includes(f.quote)||state.findings.some(x=>x.quote===f.quote&&x.type===f.type)) continue;
        const source=state.sources.find(s=>s.title===f.sourceTitle)||state.sources.find(s=>f.sourceQuote&&s.content.includes(f.sourceQuote));
        const exactQuote=source&&f.sourceQuote&&source.content.includes(f.sourceQuote)?f.sourceQuote:source?.content||'';
        const category=/claim|evidence/i.test(f.type||'')?'claim':'tone';const safeSuggestion=category==='claim'?'':String(f.suggestion||'').slice(0,500);const item={id:id(),type:String(f.type||'AI suggestion').slice(0,50),category,severity:['high','medium','low'].includes(f.severity)?f.severity:'medium',quote:f.quote,sourceId:source?.id||null,sourceTitle:source?.title||'No matching approved source',sourceQuote:exactQuote,reason:String(f.reason||'Advisory model suggestion.').slice(0,500),suggestion:safeSuggestion,status:'open',createdAt:iso(),model:payload.model,ruleKey:`rule:${String(f.type||'AI suggestion').toLowerCase().replace(/[^a-z0-9]+/g,'-')}`};item.rewriteProposal=proposeVerifiedRewrite({draft,finding:item,sources:state.sources,claims:state.claims,today,aiSuggestion:item.suggestion,analyzeDraft});state.findings.push(item); added++;
      }
      if(added){audit('Optional Qwen review completed',`${added} additional advisory finding(s) added.`);renderAll();}
      $('#ai-status').innerHTML=`<i></i> Qwen · ${esc(payload.model)}`;
      if(added) toast(`Optional Qwen review added ${added} advisory finding(s).`);
    } catch(error) { $('#ai-status').innerHTML='<i></i> Deterministic rules only'; toast(`Qwen review unavailable; deterministic results remain. ${error.message}`,true); }
  }
}
function showModal(title, kicker, html) {
  $('#modal-title').textContent=title; $('#modal-kicker').textContent=kicker; $('#modal-body').innerHTML=html; modal.hidden=false;
  modal.querySelector('input,textarea,select,button')?.focus();
}
function closeModal(){modal.hidden=true;pendingAction=null;}
function addSourceModal(source=null){
 const editing=Boolean(source); const types=['Product facts','Brand guideline','Claim evidence','Approved asset list'];
 showModal(editing?'Create a source version':'Add approved source','SOURCE LIBRARY',`<form id="source-form" class="form-stack"><input type="hidden" name="sourceId" value="${esc(source?.id||'')}"><label>Source title<input name="title" required maxlength="120" placeholder="e.g. Approved product facts" value="${esc(source?.title||'')}"></label><div class="form-row"><label>Source type<select name="type">${types.map(type=>`<option ${source?.type===type?'selected':''}>${type}</option>`).join('')}</select></label><label>Review date<input name="expiry" type="date" value="${esc(source?.expiry||'')}"></label></div><label>Owner<input name="owner" value="${esc(source?.owner||session?.user?.email||'Hariom Thakur')}" maxlength="80"></label><label>Approved source text<textarea name="content" required maxlength="12000" placeholder="Paste the approved passage or guidance">${esc(source?.content||'')}</textarea></label><p class="modal-help">${editing?`Saving creates source version ${Number(source.version||1)+1}. Linked claims and past approvals will enter the re-review queue.`:'Only add information you are authorised to use. The demo stores it in this browser unless Supabase is configured.'}</p><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary">${editing?'Save new version':'Save source'}</button></div></form>`);
}
function addClaimModal(claim=null){
 const editing=Boolean(claim);
 const options=state.sources.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
 const picked=claim?.sourceId||state.sources[0]?.id||'';
 showModal(editing?'Re-review approved claim':'Add approved claim','EVIDENCE-BACKED CLAIM LEDGER',`<form id="claim-form" class="form-stack"><input type="hidden" name="claimId" value="${esc(claim?.id||'')}"><label>Approved wording<textarea name="wording" required maxlength="800" placeholder="Use the exact reviewer-approved wording">${esc(claim?.wording||'')}</textarea></label><label>Approved alternative wording (optional)<textarea name="alternativeWording" maxlength="800" placeholder="A safe phrase BrandLens may suggest">${esc(claim?.alternativeWording||'')}</textarea></label><label>Supporting source<select name="sourceId" required>${state.sources.map(s=>`<option value="${esc(s.id)}" ${s.id===picked?'selected':''}>${esc(s.title)} · v${Number(s.version||1)}</option>`).join('')||'<option value="">Add a source first</option>'}</select></label><label>Exact supporting excerpt<textarea name="supportingExcerpt" required maxlength="4000" placeholder="Paste an exact excerpt from the selected source">${esc(claim?.supportingExcerpt||sourceById(picked)?.content||'')}</textarea></label><div class="key-value-preview" id="key-value-preview">Key values: ${(claim?.keyValues||extractKeyValues(claim?.supportingExcerpt||sourceById(picked)?.content||'')).map(v=>`${esc(v.display)} (${esc(v.value)} ${esc(v.unit)})`).join(', ')||'none detected'}</div><div class="form-row"><label>Evidence owner<input name="owner" value="${esc(claim?.owner||session?.user?.email||'Hariom Thakur')}" required maxlength="80"></label><label>Expiry / re-review date<input name="reviewDate" type="date" value="${esc(claim?.expiryDate||claim?.reviewDate||'')}" required></label></div><p class="modal-help">The excerpt must exactly match the source. BrandLens extracts key numbers and stores the source version used. Adding a claim records an existing human approval; BrandLens does not approve claims.</p><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary" ${options?'':'disabled'}>${editing?'Save reviewed claim':'Save claim'}</button></div></form>`);
}
function actionModal(action,finding){
 pendingAction={action,findingId:finding.id};
 if(action==='dismiss') return showModal('Dismiss tone finding','REVIEWER ACTION',`<form id="action-form" class="form-stack"><p class="modal-help">Dismissal applies to tone or readability suggestions only. It does not erase the audit history.</p><label>Reason<input name="reason" required maxlength="300" placeholder="e.g. Intentional emphasis for this channel"></label><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary">Record dismissal</button></div></form>`);
 if(action==='escalate') return showModal('Escalate finding','REVIEWER ACTION',`<form id="action-form" class="form-stack"><p class="modal-help">Escalation records the concern and keeps the draft from being approved.</p><label>Reason for escalation<input name="reason" required maxlength="300" placeholder="What needs reviewer attention?"></label><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary">Escalate</button></div></form>`);
 const options=state.sources.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
 showModal('Resolve with supporting evidence','REVIEWER ACTION',`<form id="action-form" class="form-stack"><p class="modal-help">Attach the source that supports the final wording and record why the reviewer resolved this finding.</p><label>Supporting source<select name="sourceId" required>${options||'<option value="">Add a source first</option>'}</select></label><label>Resolution reason<input name="reason" required maxlength="300" placeholder="Explain how the source supports the revised claim"></label><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary" ${options?'':'disabled'}>Resolve finding</button></div></form>`);
}
function insightDecisionModal(insightKey,action){
 if(!canDecideGuidelines())return toast('Only the workspace Admin can record a guideline owner decision.',true);
 pendingAction={action:'insight',insightKey,insightAction:action};
 const label={clarify:'Clarify rule',exception:'Add exception',retire:'Retire rule'}[action]||'Record owner decision';
 showModal(label.toUpperCase(),'OWNER DECISION · NO AUTOMATIC POLICY EDIT',`<form id="insight-form" class="form-stack"><p class="modal-help">This records your decision and rationale. BrandLens will not edit, deactivate, or remove the source automatically.</p><label>Decision rationale<textarea name="rationale" required maxlength="600" placeholder="What should the owner or content team change, and why?"></textarea></label><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary">Record decision</button></div></form>`);
}
function recordRewrite(f,accept){
 if(!f?.rewriteProposal)return toast('There is no verified replacement for this finding.',true);
 if(!accept){f.rewriteStatus='rejected';audit('Verified rewrite rejected',`${f.type}: the creator chose to edit the draft manually.`,{findingId:f.id,ruleKey:f.ruleKey,ruleType:f.type,category:f.category,decision:'override',quote:f.quote});renderFindings();save();return toast('Rewrite rejected. Edit the wording manually or ask a Reviewer for help.');}
 const proposal=f.rewriteProposal; const start=state.draft.indexOf(f.quote);
 if(start<0)return toast('The quoted text changed. Run a fresh review before applying this edit.',true);
 const verification=proposeVerifiedRewrite({draft:state.draft,finding:f,sources:state.sources,claims:state.claims,today,aiSuggestion:f.model?proposal.replacement:'',analyzeDraft});
 if(!verification||verification.replacement!==proposal.replacement)return toast('The proposed edit no longer passes verification. Run the review again.',true);
 const before=state.draft; const after=before.slice(0,start)+proposal.replacement+before.slice(start+f.quote.length);
 const checked=analyzeDraft(after,{sources:state.sources,claims:state.claims,today});
 const newIssue=checked.some(item=>item.category==='claim'&&item.quote.includes(proposal.replacement)&&!state.findings.some(old=>old.type===item.type&&old.quote===item.quote));
 if(newIssue)return toast('The replacement still triggers a claim finding. Edit manually and review again.',true);
 const revision={id:id(),findingId:f.id,ruleType:f.type,ruleKey:f.ruleKey,sourceId:proposal.sourceId,before:f.quote,after:proposal.replacement,diff:wordDiff(f.quote,proposal.replacement),draftBefore:before,draftAfter:after,at:iso(),by:session?.user?.email||'Local demo user',provenance:proposal.provenance};
 state.rewriteHistory.unshift(revision); state.draft=after; state.findings=deterministicReview(after); state.reviews+=1;state.reviewed=true;state.reviewedDraft=after;state.reviewedSignature=reviewSignature();
 audit('Verified rewrite accepted',`${f.type}: the draft was re-checked after a ledger- or rule-backed edit.`,{findingId:f.id,ruleKey:f.ruleKey,ruleType:f.type,category:f.category,decision:'override',quote:f.quote,replacement:proposal.replacement,provenance:proposal.provenance});
 renderAll({draft:true});return toast('Edit applied and checked again. Review every remaining finding before approval.');
}
function sessionHeaders(extra={}) { return {apikey:config.supabaseAnonKey,authorization:`Bearer ${session?.access_token||config.supabaseAnonKey}`,...extra}; }
function authModal(){
 if(!config.supabaseUrl||!config.supabaseAnonKey) return showModal('Connect Supabase','OPTIONAL CLOUD SYNC',`<div class="form-stack"><p>Supabase is optional. The project works in local demo mode now. To enable cloud accounts, set <code>SUPABASE_URL</code> and <code>SUPABASE_PUBLISHABLE_KEY</code> in your server’s <code>.env</code>, apply <code>supabase/schema.sql</code>, and restart the app.</p><p class="modal-help">Use only the publishable key in this app. Never expose a secret or service-role key.</p><div class="modal-actions"><button class="button button-outline" data-modal-close>Close</button></div></div>`);
 showModal('Sign in to sync','SUPABASE WORKSPACE',`<form id="auth-form" class="form-stack"><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" required minlength="6" autocomplete="current-password"></label><p class="modal-help">For a new account, use Create account. Email confirmation may be required by your Supabase project settings.</p><div class="modal-actions"><button type="button" class="button button-outline" data-auth-signup>Create account</button><button class="button button-primary">Sign in</button></div></form>`);
}
async function authRequest(pathname,body){
 const response=await fetch(`${config.supabaseUrl.replace(/\/$/,'')}/auth/v1/${pathname}`,{method:'POST',headers:{apikey:config.supabaseAnonKey,'content-type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new Error(data.msg||data.message||data.error_description||'Supabase authentication failed.');return data;
}
async function rpcRequest(name,args={}) {
 const response=await fetch(`${config.supabaseUrl.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers:sessionHeaders({'content-type':'application/json'}),body:JSON.stringify(args)});
 const text=await response.text(); let data=null; try{data=text?JSON.parse(text):null;}catch{}
 if(!response.ok)throw new Error(data?.message||data?.details||data?.hint||'Supabase request failed. Apply the latest supabase/schema.sql and try again.');
 return data;
}
async function syncAuditEvents() {
 try{
  for(const item of state.audit.filter(row=>row.remoteStatus==='pending'&&row.eventKey)){
   const remote=await rpcRequest('append_brandlens_audit_event',{p_workspace_id:workspaceId,p_event:{event_key:item.eventKey,action:item.action,detail:item.detail,metadata:Object.fromEntries(Object.entries(item).filter(([key])=>!['id','eventKey','action','detail','at','remoteStatus','actor_id'].includes(key)))}});Object.assign(item,{id:remote.id||item.id,at:remote.created_at||item.at,actor_id:remote.actor_id,remoteStatus:'saved'});
  }
  const rows=await rpcRequest('list_brandlens_audit_events',{p_workspace_id:workspaceId,p_limit:300});
  const keepLocal=state.audit.filter(row=>['local','legacy'].includes(row.remoteStatus));
  const remoteRows=(Array.isArray(rows)?rows:[]).map(row=>({...row.metadata,id:row.id,eventKey:row.event_key,actor_id:row.actor_id,action:row.action,detail:row.detail,at:row.created_at,remoteStatus:'saved'}));
  const byKey=new Map(remoteRows.map(row=>[row.eventKey,row]));
  for(const row of state.audit.filter(item=>item.remoteStatus==='pending'))if(row.eventKey&&!byKey.has(row.eventKey))byKey.set(row.eventKey,row);
  state.audit=[...keepLocal,...byKey.values()];auditRpcAvailable=true;
 }catch(error){auditRpcAvailable=false;state.audit=state.audit.map(row=>({...row,remoteStatus:row.remoteStatus||'legacy'}));toast(`Workspace data synced, but shared append-only audit is unavailable. Apply the latest supabase/schema.sql. ${error.message}`,true);}
}
async function syncWorkspace(mode='load'){
 if(!config.supabaseUrl||!config.supabaseAnonKey)return authModal();
 if(!session)return authModal();
 try{
  if(mode==='save' && workspaceId){
   const saved=await rpcRequest('save_brandlens_workspace',{p_workspace_id:workspaceId,p_payload:state,p_expected_revision:workspaceRevision});
   workspaceRevision=Number(saved.revision);
   state={...sampleState(),...(saved.payload||{})};
   if(workspaceRole==='creator') toast('Draft saved. A Reviewer or Admin must run and save the shared review.');
  } else {
   const cloud=await rpcRequest('get_or_create_brandlens_workspace',{p_name:state.workspace||'BrandLens Workspace',p_initial_payload:state});
   workspaceId=cloud.workspace_id; workspaceName=cloud.workspace_name||'BrandLens Workspace'; workspaceRole=cloud.role; workspaceRevision=Number(cloud.revision);
   state={...sampleState(),...(cloud.payload||{})};
  }
  await syncAuditEvents();
  state.workspace=workspaceName||state.workspace;
  const ws=$('.side-workspace'); if(ws) ws.innerHTML=`<span class="workspace-dot"></span><span><b>${esc(state.workspace)}</b><small>${esc(workspaceRole)} workspace</small></span><span class="chevron">⌄</span>`;
  const profile=$('.profile-row'); if(profile){profile.querySelector('b').textContent=session.user?.email||'Signed-in member';profile.querySelector('small').textContent=`${workspaceRole} · shared workspace`;}
  localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  audit(mode==='save'?'Workspace synced to Supabase':'Workspace loaded from Supabase',mode==='save'?'Shared workspace is up to date.':'Cloud workspace loaded into this browser.');
  renderAll({draft:true}); if(!(mode==='save'&&workspaceRole==='creator'))toast(mode==='save'?'Workspace saved to Supabase.':'Workspace loaded from Supabase.');
 }catch(error){toast(error.message,true);}
}
async function exportBackup(){
 const blob=new Blob([JSON.stringify({exportedAt:iso(),workspace:state},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`brandlens-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);toast('Workspace backup downloaded.');
}

$('#draft-text').value=state.draft||'';$('#draft-name').value=state.draftName||'';updateCharCount();renderAll();
fetch('/api/config').then(r=>r.json()).then(async data=>{config=data; if(data.ollamaReady){$('#ai-status').innerHTML=`<i></i> Rules + Ollama · ${esc(data.ollamaModel)}`;$('#model-chip').textContent=`Configured · ${data.ollamaModel}`;$('#model-description').textContent='A Qwen model is configured through the server-side Ollama connection. Model review is optional; deterministic checks remain active.';} if(data.supabaseUrl&&data.supabaseAnonKey){$('#sync-button').textContent=session?'Sync workspace':'Sign in to sync';$('#settings-sync').textContent=session?'Sync workspace':'Sign in to sync';$('#storage-description').textContent='Supabase is configured. Sign in to sync this workspace across your team.';}else{$('#sync-button').textContent='Configure Supabase';$('#settings-sync').textContent='Configure Supabase';$('#storage-description').textContent='Supabase is not configured on this server yet. Add the project URL and publishable key in Render → Environment to enable accounts and cloud sync.';} if(session){$('#storage-status').innerHTML='<i></i> Supabase connected';if(data.supabaseUrl&&data.supabaseAnonKey)await syncWorkspace('load');}}).catch(()=>{$('#ai-status').innerHTML='<i></i> Deterministic rules only';});

document.addEventListener('click',async event=>{
 const pageButton=event.target.closest('[data-page]');if(pageButton){go(pageButton.dataset.page);return;}
 if(event.target.closest('#review-button')){await runReview();return;}
 if(event.target.closest('#add-source')){addSourceModal();return;}
 if(event.target.closest('#add-claim')){addClaimModal();return;}
 const editSource=event.target.closest('[data-edit-source]');if(editSource){if(session&&!canManageLibrary())return toast('Only Admins and Reviewers can version approved sources.',true);addSourceModal(sourceById(editSource.dataset.editSource));return;}
 const editClaim=event.target.closest('[data-edit-claim]');if(editClaim){if(session&&!canManageLibrary())return toast('Only Admins and Reviewers can update approved claims.',true);const claim=state.claims.find(c=>c.id===editClaim.dataset.editClaim);if(claim)addClaimModal(claim);return;}
 const rewrite=event.target.closest('[data-rewrite-action]');if(rewrite){recordRewrite(state.findings.find(f=>f.id===rewrite.dataset.id),rewrite.dataset.rewriteAction==='accept');return;}
 const insightAction=event.target.closest('[data-insight-action]');if(insightAction){insightDecisionModal(insightAction.dataset.insightKey,insightAction.dataset.insightAction);return;}
 const loadApproval=event.target.closest('[data-load-approval]');if(loadApproval){const record=state.approvalRecords.find(a=>a.id===loadApproval.dataset.loadApproval);if(!record)return;state.draft=record.draft||'';state.draftName=record.draftName||'Previously approved draft';state.reviewed=false;state.reviewedOn=null;state.findings=[];renderAll({draft:true});go('review');if(state.draft)await runReview();return;}
 if(event.target.closest('#sync-button')||event.target.closest('#settings-sync')){if(session)await syncWorkspace('save');else authModal();return;}
 if(event.target.closest('#export-button')){await exportBackup();return;}
 if(event.target.closest('#reset-demo')){if(confirm('Reset this browser to the fictional Luma Botanics demo workspace? This replaces its current local data.')){state=sampleState();renderAll({draft:true});go('review');toast('Fictional demo workspace restored.');}return;}
 if(event.target.closest('#modal-close')||event.target.closest('[data-modal-close]')){closeModal();return;}
 if(event.target.closest('[data-auth-signup]')){const form=$('#auth-form');const data=Object.fromEntries(new FormData(form));try{const result=await authRequest('signup',{email:data.email,password:data.password});if(result.access_token){session=result;sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));closeModal();toast('Account created.');await syncWorkspace();}else toast('Check your email to confirm the account, then sign in.');}catch(error){toast(error.message,true);}return;}
 if(event.target.closest('#account-button')){
  if(session&&confirm(`Sign out ${session.user?.email||'of this workspace'}?`)){try{await fetch(`${config.supabaseUrl.replace(/\/$/,'')}/auth/v1/logout`,{method:'POST',headers:sessionHeaders()});}catch{}session=null;workspaceId=null;workspaceRole=null;workspaceName='';workspaceRevision=null;sessionStorage.removeItem(SESSION_KEY);$('#sync-button').textContent='Sign in to sync';$('#storage-status').innerHTML='<i></i> Local demo';toast('Signed out. Local browser data remains available.');renderAll();}
  else if(!session)go('settings');return;
 }
 const act=event.target.closest('[data-finding-action]');if(act){const f=state.findings.find(x=>x.id===act.dataset.id);if(!f)return;const action=act.dataset.findingAction;if(session&&['resolve','dismiss','escalate'].includes(action)&&!canManageLibrary())return toast('Only Admins and Reviewers can record finding decisions.',true);if(session&&action==='dismiss'&&f.category==='claim')return toast('Claim findings cannot be dismissed.',true);
  if(action==='edit'){go('review');$('#draft-text').focus();$('#draft-text').scrollIntoView({behavior:'smooth',block:'center'});return;}
  actionModal(action,f);return;
 }
 const delSource=event.target.closest('[data-delete-source]');if(delSource){if(session&&!canManageLibrary())return toast('Only Admins and Reviewers can change approved facts and rules.',true);const sourceId=delSource.dataset.deleteSource;if(state.claims.some(c=>c.sourceId===sourceId)||state.approvalRecords.some(a=>(a.sourceRefs||[]).some(r=>r.sourceId===sourceId)))return toast('This source is linked to claims or past approvals. Version it instead of deleting it.',true);if(confirm('Remove this source from the demo workspace?')){state.sources=state.sources.filter(s=>s.id!==sourceId);audit('Source removed','A source was removed from this workspace.');renderAll();}return;}
 const delClaim=event.target.closest('[data-delete-claim]');if(delClaim&&session&&!canManageLibrary())return toast('Only Admins and Reviewers can change approved claims.',true);if(delClaim&&confirm('Remove this claim from the ledger? Past approvals using it will enter re-review.')){state.claims=state.claims.filter(c=>c.id!==delClaim.dataset.deleteClaim);audit('Claim removed','A claim was removed from the ledger.',{claimId:delClaim.dataset.deleteClaim,decision:'source_changed'});renderAll();return;}
 const removeMember=event.target.closest('[data-remove-member]');if(removeMember&&confirm('Remove this member from the shared workspace?')){try{await rpcRequest('remove_brandlens_member',{p_workspace_id:workspaceId,p_user_id:removeMember.dataset.removeMember});audit('Workspace member removed','A member lost access to this workspace.');await renderTeam();toast('Member removed.');}catch(error){toast(error.message,true);}return;}
 if(event.target.closest('#clear-activity')&&confirm('Clear the local activity log?')){if(session)return toast('Shared audit history is append-only and cannot be cleared.');state.audit=[];renderAll();return;}
  if(event.target.closest('#approve-button')){if(session&&workspaceRole==='creator')return toast('Creators cannot record approvals. Ask a Reviewer or Admin.',true);if(!reviewIsCurrent())return toast('The draft or evidence changed. Run review again before approval.',true);const unresolved=state.findings.some(f=>['open','escalated'].includes(f.status));if(unresolved)return toast('Resolve or dismiss each finding before approval.',true);if(confirm('Record a human approval for this draft version?')){state.approvals+=1;const linkedClaims=state.claims.filter(c=>state.draft.toLowerCase().includes(String(c.wording).toLowerCase()));const sourceIds=new Set([...state.findings.map(f=>f.sourceId),...linkedClaims.map(c=>c.sourceId)].filter(Boolean));const approval={id:id(),draftName:state.draftName,draft:state.draft,status:'approved',createdAt:iso(),sourceRefs:[...sourceIds].map(sourceId=>({sourceId,version:Number(sourceById(sourceId)?.version||1)})),claimRefs:linkedClaims.map(c=>({claimId:c.id,version:Number(c.version||1),sourceVersion:Number(c.sourceVersion||1)}))};for(const prior of state.approvalRecords.filter(a=>a.status==='re-review'&&a.draft===state.draft)){prior.status='re-reviewed';prior.replacedBy=approval.id;prior.reReviewedAt=approval.createdAt;}state.approvalRecords.unshift(approval);audit('Draft approved by workspace owner',`Human approval recorded for “${state.draftName}”.`,{approvalId:approval.id,decision:'approved',sourceRefs:approval.sourceRefs,claimRefs:approval.claimRefs});renderAll();toast('Human approval recorded. Nothing was published.');}return;}
});

document.addEventListener('submit',async event=>{
 event.preventDefault();const form=event.target;const data=Object.fromEntries(new FormData(form));
 if(form.id==='source-form'){
  if(session&&!canManageLibrary())return toast('Only Admins and Reviewers can change approved facts and rules.',true);
  const values={title:data.title.trim(),type:data.type,owner:data.owner.trim(),expiry:data.expiry||'',content:data.content.trim()};
  if(data.sourceId){const current=sourceById(data.sourceId);if(!current)return toast('This source was removed. Reload the page and try again.',true);const result=updateSourceVersion(current,values,iso());state.sources=state.sources.map(s=>s.id===data.sourceId?result.source:s);if(result.changed){for(const claim of state.claims.filter(c=>c.sourceId===data.sourceId)){claim.status='re-review';claim.staleReason=`Source version ${current.version||1} changed to ${result.source.version}.`;}}audit(result.changed?'Source version created':'Source details saved',result.changed?`“${values.title}” is now version ${result.source.version}. Linked claims and prior approvals must be re-reviewed.`:`“${values.title}” details were saved without changing the source version.`,{sourceId:data.sourceId,sourceVersion:result.source.version,decision:result.changed?'source_changed':'updated'});closeModal();renderAll();toast(result.changed?'New source version saved. Linked claims and approvals are queued for re-review.':'Source details saved.');return;}
  const source={id:id(),version:1,versions:[],...values,updated:iso()};state.sources.unshift(source);audit('Source added',`“${values.title}” was added to the source library.`,{sourceId:source.id,sourceVersion:1});closeModal();renderAll();toast('Approved source added.');return;
 }
 if(form.id==='claim-form'){
  if(session&&!canManageLibrary())return toast('Only Admins and Reviewers can change approved claims.',true);
  const source=sourceById(data.sourceId);if(!source)return toast('Choose a supporting source.',true);
  const excerpt=data.supportingExcerpt.trim();if(!excerpt||!source.content.includes(excerpt))return toast('The supporting excerpt must exactly match text inside the selected source.',true);
  const values=extractKeyValues(excerpt);const valueKeys=new Set(values.map(v=>`${v.value}:${v.unit}`));
  const wordingValues=extractKeyValues(`${data.wording} ${data.alternativeWording}`);if(wordingValues.some(v=>!valueKeys.has(`${v.value}:${v.unit}`)))return toast('The claim or alternative uses a number that is not present in its exact supporting excerpt.',true);
  const now=iso();const existing=state.claims.find(c=>c.id===data.claimId);const history=existing?[...(existing.history||[]),{version:existing.version||1,wording:existing.wording,alternativeWording:existing.alternativeWording||'',sourceId:existing.sourceId,sourceVersion:existing.sourceVersion,supportingExcerpt:existing.supportingExcerpt,keyValues:existing.keyValues,owner:existing.owner,expiryDate:existing.expiryDate,status:existing.status,updated:existing.updated||existing.approvedAt||''}]:[];
  const claim={...(existing||{}),id:existing?.id||id(),version:Number(existing?.version||0)+1,wording:data.wording.trim(),alternativeWording:data.alternativeWording.trim(),sourceId:source.id,sourceVersion:Number(source.version||1),supportingExcerpt:excerpt,keyValues:values,owner:data.owner.trim(),reviewDate:data.reviewDate,expiryDate:data.reviewDate,approvedAt:now,updated:now,status:'approved',history,staleReason:''};
  if(existing)state.claims=state.claims.map(c=>c.id===existing.id?claim:c);else state.claims.unshift(claim);
  audit(existing?'Claim re-reviewed':'Approved claim added',`“${claim.wording}” is linked to ${source.title} version ${claim.sourceVersion}; ${values.length} key value(s) recorded.`,{claimId:claim.id,sourceId:source.id,sourceVersion:claim.sourceVersion,decision:'claim_approved'});closeModal();renderAll();toast(existing?'Claim evidence refreshed and approved by a human.':'Claim added to the ledger after human approval.');return;
 }
 if(form.id==='action-form'){
  const f=state.findings.find(x=>x.id===pendingAction?.findingId);if(!f)return closeModal();
  const action=pendingAction.action;
  if(session&&['resolve','dismiss','escalate'].includes(action)&&!canManageLibrary())return toast('Only Admins and Reviewers can record finding decisions.',true);
  if(action==='dismiss'&&f.category==='claim')return toast('Claim findings cannot be dismissed.',true);
  f.status=action==='dismiss'?'dismissed':action==='escalate'?'escalated':'resolved';f.resolutionReason=data.reason.trim();
  if(action==='resolve'){f.sourceId=data.sourceId;const source=sourceById(data.sourceId);f.sourceTitle=source?.title||'';f.sourceQuote=source?.content||'';}
  const decision=action==='dismiss'?'dismissed':action==='escalate'?'escalated':'resolved';const actionLabel={dismiss:'Finding dismissed',escalate:'Finding escalated',resolve:'Finding resolved with evidence'}[action];audit(actionLabel,`${f.type}: ${f.resolutionReason}`,{findingId:f.id,ruleKey:f.ruleKey,ruleType:f.type,category:f.category,decision,quote:f.quote,sourceId:f.sourceId});closeModal();renderAll();toast(`${actionLabel}.`);return;
 }
 if(form.id==='insight-form'){
  if(!canDecideGuidelines())return toast('Only the workspace Admin can record a guideline owner decision.',true);
  const {insightKey,insightAction}=pendingAction||{};if(!insightKey||!['clarify','exception','retire'].includes(insightAction))return closeModal();
  const decision={id:id(),insightKey,action:insightAction,rationale:data.rationale.trim(),by:session?.user?.email||'Local workspace owner',at:iso()};state.ruleDecisions.push(decision);
  audit('Guideline owner decision recorded',`${insightAction}: ${decision.rationale}`,{insightKey,decision:'owner_decision',ownerAction:insightAction});closeModal();renderAll();toast('Owner decision recorded. The source and rule were not changed automatically.');return;
 }
 if(form.id==='invite-form'){
  try{await rpcRequest('invite_brandlens_member',{p_workspace_id:workspaceId,p_email:data.email,p_role:data.role});audit('Workspace invite created',`${data.email} was invited as ${data.role}.`);await renderTeam();toast('Invite created. Share the exact email and sign-in instructions with your teammate.');}catch(error){toast(error.message,true);}return;
 }
 if(form.id==='auth-form'){
  try{session=await authRequest('token?grant_type=password',{email:data.email,password:data.password});sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));closeModal();$('#sync-button').textContent='Sync workspace';$('#storage-status').innerHTML='<i></i> Supabase connected';toast('Signed in. Syncing workspace…');await syncWorkspace('load');}
  catch(error){toast(error.message,true);}return;
 }
});

$('#theme-select').addEventListener('change', event => setTheme(event.target.value));

$('#draft-text').addEventListener('input',()=>{state.draft=$('#draft-text').value;state.draftName=$('#draft-name').value;updateCharCount();renderFindings();localStorage.setItem(STORAGE_KEY,JSON.stringify(state));});
$('#draft-name').addEventListener('input',()=>{state.draftName=$('#draft-name').value;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));});
$('#file-input').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>120000){toast('This file is too large. Import a text file under 120 KB.',true);event.target.value='';return;}try{const imported=await file.text();if(imported.length>30000){toast('This file is longer than the 30,000 character draft limit.',true);event.target.value='';return;}state.draft=imported;state.draftName=file.name.replace(/\.(txt|md)$/i,'');$('#draft-text').value=state.draft;$('#draft-name').value=state.draftName;updateCharCount();renderFindings();localStorage.setItem(STORAGE_KEY,JSON.stringify(state));toast(`${file.name} imported. Run review to check the text.`);}catch{toast('Could not read this text file.',true);}event.target.value='';});
modal.addEventListener('click',event=>{if(event.target===modal)closeModal();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)closeModal();});

