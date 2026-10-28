import { analyzeDraft } from "./review-engine.js";
const STORAGE_KEY = 'brandlens.round2.workspace.v1';
const SESSION_KEY = 'brandlens.supabase.session.v1';
const THEME_KEY = 'brandlens.theme.v2';
const today = new Date().toISOString().slice(0, 10);
const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const iso = () => new Date().toISOString();
const fmtDate = value => value ? new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '—';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sampleState = () => {
  const facts = { id:id(), title:'Approved product facts — Dewdrop Serum', type:'Product facts', owner:'Hariom Thakur', expiry:'2026-12-31', updated:iso(), content:'A 28-day consumer use test with 30 participants found improved skin hydration. The study did not evaluate pigmentation, acne, or effects within three days.' };
  const guide = { id:id(), title:'Brand voice and claims guide', type:'Brand guideline', owner:'Hariom Thakur', expiry:'2027-03-31', updated:iso(), content:'Use clear, warm, evidence-led language. Avoid guarantees, “clinically proven”, “erase”, and unsupported timeframes. Replace “whitening” with “brightening”. Use at most one exclamation mark per post.' };
  const old = { id:id(), title:'Historical customer count export', type:'Claim evidence', owner:'Hariom Thakur', expiry:'2026-06-30', updated:iso(), content:'An old store export recorded 50,000 customer orders. It is not independently audited and is past its review date; it must not be used as current proof of customer popularity.' };
  return {
    workspace:'Luma Botanics', sources:[facts,guide,old],
    claims:[
      {id:id(), wording:'In a 28-day consumer use test, participants showed improved skin hydration.', sourceId:facts.id, owner:'Hariom Thakur', reviewDate:'2026-12-31', status:'approved'},
      {id:id(), wording:'Loved by 50,000 customers', sourceId:old.id, owner:'Hariom Thakur', reviewDate:'2026-06-30', status:'expired'}
    ],
    draftName:'Spring launch — social post',
    draft:'Clinically proven to erase dark spots in 3 days! Loved by 50,000 customers!!!',
    findings:[], audit:[{id:id(),action:'Demo workspace opened',detail:'Fictional sample sources loaded in this browser.',at:iso()}],
    reviews:0, approvals:0, reviewed:false
  };
};
let state;
try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || sampleState(); } catch { state = sampleState(); }
state.sources ||= []; state.claims ||= []; state.findings ||= []; state.audit ||= []; state.reviews ||= 0; state.approvals ||= 0;
state.reviewedDraft ??= state.reviewed ? (state.draft || '') : null;
const reviewSignature = () => JSON.stringify([state.draft, state.sources.map(({id,title,type,expiry,content})=>[id,title,type,expiry,content]), state.claims.map(({id,wording,sourceId,reviewDate,status})=>[id,wording,sourceId,reviewDate,status])]);
state.reviewedSignature ??= state.reviewed ? reviewSignature() : null;
let config = {supabaseUrl:'',supabaseAnonKey:'',ollamaReady:false,ollamaModel:''};
let session = null;
let workspaceId = null;
let workspaceName = "";
let workspaceRole = null;
let workspaceRevision = null;
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

function audit(action, detail) { state.audit.push({id:id(),action,detail,at:iso()}); }
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  $('#storage-status').innerHTML = `<i></i> ${session ? 'Supabase connected' : 'Local demo'}`;
  $('#storage-description').textContent = session ? `Signed in as ${session.user?.email || 'workspace member'} (${workspaceRole || 'loading role'}). Use Sync workspace to save changes for the shared team.` : 'Local demo mode stores your workspace in this browser only. No account or cloud sync is active.';
  const hint=$('#workspace-hint'); if(hint) hint.innerHTML=`<span class="pulse-dot"></span> ${session&&workspaceId?'Shared with your workspace team':'Drafts stay private in this browser'}`;
}
function sourceById(sourceId) { return state.sources.find(item => item.id === sourceId); }
function openFindings() { return state.findings.filter(f => f.status === 'open' || f.status === 'escalated'); }
function reviewIsCurrent() { return Boolean(state.reviewed && state.reviewedDraft === state.draft && state.reviewedSignature === reviewSignature()); }
function renderStats() {
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
    return `<article class="panel resource-card"><div class="resource-head"><span class="resource-type">▤ &nbsp;${esc(s.type)}</span><button class="danger-button" data-delete-source="${esc(s.id)}" ${state.claims.some(c=>c.sourceId===s.id)?'disabled title="A claim uses this source"':''}>Remove</button></div><h2>${esc(s.title)}</h2><p>${esc(s.content)}</p><div class="resource-meta"><span>Owner: ${esc(s.owner || 'Unassigned')}</span><span class="${expired?'expired':''}">${expired?'Expired':'Review by'} ${fmtDate(s.expiry)}</span></div></article>`;
  }).join('') || '<div class="panel empty-table">No sources yet. Add approved guidance or evidence.</div>';
}
function renderClaims() {
  $('#claims-table').innerHTML = state.claims.map(c=>{
    const source = sourceById(c.sourceId); const expired = c.status==='expired' || (c.reviewDate && c.reviewDate < today);
    return `<tr><td>${esc(c.wording)}</td><td>${esc(source?.title || 'Source removed')}</td><td>${esc(c.owner || 'Unassigned')}</td><td>${fmtDate(c.reviewDate)}</td><td><span class="status-tag ${expired?'expired':''}">${expired?'Review required':'Approved'}</span></td><td><button class="danger-button" data-delete-claim="${esc(c.id)}">Remove</button></td></tr>`;
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
    if (f.suggestion) actions += `<button class="mini-action primary" data-finding-action="apply" data-id="${esc(f.id)}">Accept edit</button>`; actions += `<button class="mini-action" data-finding-action="edit" data-id="${esc(f.id)}">Edit draft</button>`;
    if (isClaim && canManageLibrary()) actions += `<button class="mini-action" data-finding-action="resolve" data-id="${esc(f.id)}">Resolve with evidence</button>`;
    if (canManageLibrary()) {
      actions += `<button class="mini-action" data-finding-action="escalate" data-id="${esc(f.id)}">Escalate</button>`;
      if (!isClaim) actions += `<button class="mini-action" data-finding-action="dismiss" data-id="${esc(f.id)}">Dismiss</button>`;
    }
  }
  return `<article class="finding-card ${sev}"><div class="finding-top"><span class="finding-type">${esc(f.type)}</span><span class="severity ${sev}">${esc(sev)} risk</span></div><div class="finding-body"><p class="quote">${highlighted(state.draft,f.quote)}</p><p>${esc(f.reason)}</p><div class="source-cite"><b>Related source · ${esc(sourceTitle)}</b>${esc(sourceQuote)}</div>${f.suggestion?`<p><b>Suggested edit:</b> “${esc(f.suggestion)}”</p>`:''}</div><div class="finding-actions">${actions}${statusLabel}</div></article>`;
}
function renderFindings() {
  $('#finding-total').textContent = state.findings.length;
  $('#findings-list').innerHTML = state.findings.map(findingCard).join('');
  $('#findings-empty').hidden = state.findings.length > 0;
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
  $('#activity-list').innerHTML = state.audit.length ? [...state.audit].reverse().map(item=>`<article class="activity-item"><div class="activity-icon">✓</div><div><b>${esc(item.action)}</b><p>${esc(item.detail)}</p></div><time>${new Date(item.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time></article>`).join('') : '<div class="empty-table">No decisions recorded yet.</div>';
}
function canManageLibrary() { return !session || ['admin','reviewer'].includes(workspaceRole); }
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
  renderStats(); renderSources(); renderClaims(); renderFindings(); renderActivity(); renderTeam();
  $('#add-source').hidden = !canManageLibrary(); $('#add-claim').hidden = !canManageLibrary();
  $('#clear-activity').hidden = Boolean(session && workspaceRole !== 'admin');
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
  const names = {review:'Review draft',sources:'Facts & rules',claims:'Approved claims',activity:'Activity log',settings:'Settings',team:'Team'};
  $('#crumb-page').textContent = names[next] || 'Review draft';
  window.scrollTo({top:0,behavior:'smooth'});
}
function makeFinding({type,category='claim',severity='high',quote,sourceId=null,reason,suggestion}) {
  const source=sourceById(sourceId);
  return {id:id(),type,category,severity,quote,sourceId,sourceTitle:source?.title||'',sourceQuote:source?.content||'',reason,suggestion,status:'open',createdAt:iso()};
}
function deterministicReview(draft) {
  return analyzeDraft(draft, { sources: state.sources, claims: state.claims, today })
    .map(finding => ({ ...finding, id: id(), createdAt: iso(), status: 'open' }));
}
async function runReview() {
  const draft=$('#draft-text').value.trim();
  if (!draft) return toast('Add draft text before running a review.',true);
  state.draft=draft; state.draftName=$('#draft-name').value.trim() || 'Untitled draft';
  state.findings=deterministicReview(draft); state.reviews+=1; state.reviewed=true; state.reviewedDraft=draft; state.reviewedSignature=reviewSignature();
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
        const category=/claim|evidence/i.test(f.type||'')?'claim':'tone';const linkedClaim=state.claims.find(c=>f.quote.toLowerCase().includes(String(c.wording).toLowerCase()));const safeSuggestion=category==='claim'?(linkedClaim?.alternativeWording||''):String(f.suggestion||'').slice(0,500);state.findings.push({id:id(),type:String(f.type||'AI suggestion').slice(0,50),category,severity:['high','medium','low'].includes(f.severity)?f.severity:'medium',quote:f.quote,sourceId:source?.id||null,sourceTitle:source?.title||'No matching approved source',sourceQuote:exactQuote,reason:String(f.reason||'Advisory model suggestion.').slice(0,500),suggestion:safeSuggestion,status:'open',createdAt:iso(),model:payload.model}); added++;
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
function addSourceModal(){
 showModal('Add approved source','SOURCE LIBRARY',`<form id="source-form" class="form-stack"><label>Source title<input name="title" required maxlength="120" placeholder="e.g. Approved product facts"></label><div class="form-row"><label>Source type<select name="type"><option>Product facts</option><option>Brand guideline</option><option>Claim evidence</option><option>Approved asset list</option></select></label><label>Review date<input name="expiry" type="date"></label></div><label>Owner<input name="owner" value="Hariom Thakur" maxlength="80"></label><label>Approved source text<textarea name="content" required maxlength="12000" placeholder="Paste the approved passage or guidance"></textarea></label><p class="modal-help">Only add information you are authorised to use. The demo stores it in this browser unless Supabase is configured.</p><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary">Save source</button></div></form>`);
}
function addClaimModal(){
 const options=state.sources.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
 showModal('Add approved claim','CLAIM LEDGER',`<form id="claim-form" class="form-stack"><label>Approved wording<textarea name="wording" required maxlength="800" placeholder="Use the exact wording that has been approved"></textarea></label><label>Pre-approved alternative wording (optional)<textarea name="alternativeWording" maxlength="800" placeholder="A safe replacement a creator may use"></textarea></label><label>Supporting source<select name="sourceId" required>${options||'<option value="">Add a source first</option>'}</select></label><div class="form-row"><label>Owner<input name="owner" value="Hariom Thakur" maxlength="80"></label><label>Next review date<input name="reviewDate" type="date"></label></div><p class="modal-help">A claim is not approved by BrandLens. Add only wording that has already been approved by your reviewer.</p><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary" ${options?'':'disabled'}>Save claim</button></div></form>`);
}
function actionModal(action,finding){
 pendingAction={action,findingId:finding.id};
 if(action==='dismiss') return showModal('Dismiss tone finding','REVIEWER ACTION',`<form id="action-form" class="form-stack"><p class="modal-help">Dismissal applies to tone or readability suggestions only. It does not erase the audit history.</p><label>Reason<input name="reason" required maxlength="300" placeholder="e.g. Intentional emphasis for this channel"></label><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary">Record dismissal</button></div></form>`);
 if(action==='escalate') return showModal('Escalate finding','REVIEWER ACTION',`<form id="action-form" class="form-stack"><p class="modal-help">Escalation records the concern and keeps the draft from being approved.</p><label>Reason for escalation<input name="reason" required maxlength="300" placeholder="What needs reviewer attention?"></label><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary">Escalate</button></div></form>`);
 const options=state.sources.map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
 showModal('Resolve with supporting evidence','REVIEWER ACTION',`<form id="action-form" class="form-stack"><p class="modal-help">Attach the source that supports the final wording and record why the reviewer resolved this finding.</p><label>Supporting source<select name="sourceId" required>${options||'<option value="">Add a source first</option>'}</select></label><label>Resolution reason<input name="reason" required maxlength="300" placeholder="Explain how the source supports the revised claim"></label><div class="modal-actions"><button type="button" class="button button-outline" data-modal-close>Cancel</button><button class="button button-primary" ${options?'':'disabled'}>Resolve finding</button></div></form>`);
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
  if(action==='apply'){const start=state.draft.indexOf(f.quote);if(start<0)return toast('The quoted text has changed; run the review again.',true);if(!f.suggestion)return toast('No pre-approved replacement is available. Edit the draft directly or ask a Reviewer to add approved alternative wording.',true);state.draft=state.draft.slice(0,start)+f.suggestion+state.draft.slice(start+f.quote.length);f.status='updated';f.resolutionReason='Creator accepted the suggested edit.';state.findings=deterministicReview(state.draft);state.reviews+=1;state.reviewed=true;state.reviewedDraft=state.draft;state.reviewedSignature=reviewSignature();audit('Suggested edit rechecked',`${f.type}: the replacement was checked against the active deterministic rules.`);renderAll({draft:true});return toast('Edit applied and checked again. Review any remaining findings before approval.');}
  if(action==='edit'){go('review');$('#draft-text').focus();$('#draft-text').scrollIntoView({behavior:'smooth',block:'center'});return;}
  actionModal(action,f);return;
 }
 const delSource=event.target.closest('[data-delete-source]');if(delSource){if(session&&!canManageLibrary())return toast('Only Admins and Reviewers can change approved facts and rules.',true);const sourceId=delSource.dataset.deleteSource;if(state.claims.some(c=>c.sourceId===sourceId))return toast('Remove or update linked claims first.',true);if(confirm('Remove this source from the demo workspace?')){state.sources=state.sources.filter(s=>s.id!==sourceId);audit('Source removed','A source was removed from this workspace.');renderAll();}return;}
 const delClaim=event.target.closest('[data-delete-claim]');if(delClaim&&session&&!canManageLibrary())return toast('Only Admins and Reviewers can change approved claims.',true);if(delClaim&&confirm('Remove this claim from the ledger?')){state.claims=state.claims.filter(c=>c.id!==delClaim.dataset.deleteClaim);audit('Claim removed','A claim was removed from the ledger.');renderAll();return;}
 const removeMember=event.target.closest('[data-remove-member]');if(removeMember&&confirm('Remove this member from the shared workspace?')){try{await rpcRequest('remove_brandlens_member',{p_workspace_id:workspaceId,p_user_id:removeMember.dataset.removeMember});audit('Workspace member removed','A member lost access to this workspace.');await renderTeam();toast('Member removed.');}catch(error){toast(error.message,true);}return;}
 if(event.target.closest('#clear-activity')&&confirm('Clear the local activity log?')){state.audit=[];renderAll();return;}
 if(event.target.closest('#approve-button')){if(session&&workspaceRole==='creator')return toast('Creators cannot record approvals. Ask a Reviewer or Admin.',true);if(!reviewIsCurrent())return toast('The draft changed. Run review again before approval.',true);const unresolved=state.findings.some(f=>['open','escalated'].includes(f.status));if(unresolved)return toast('Resolve or dismiss each finding before approval.',true);if(confirm('Record a human approval for this draft version?')){state.approvals+=1;audit('Draft approved by workspace owner',`Human approval recorded for “${state.draftName}”.`);renderAll();toast('Human approval recorded. Nothing was published.');}return;}
});

document.addEventListener('submit',async event=>{
 event.preventDefault();const form=event.target;const data=Object.fromEntries(new FormData(form));
 if(form.id==='source-form'){
  if(session&&!canManageLibrary())return toast('Only Admins and Reviewers can change approved facts and rules.',true);
  state.sources.unshift({id:id(),title:data.title.trim(),type:data.type,owner:data.owner.trim(),expiry:data.expiry||'',updated:iso(),content:data.content.trim()});audit('Source added',`“${data.title.trim()}” was added to the source library.`);closeModal();renderAll();toast('Approved source added.');return;
 }
 if(form.id==='claim-form'){
  if(session&&!canManageLibrary())return toast('Only Admins and Reviewers can change approved claims.',true);
  state.claims.unshift({id:id(),wording:data.wording.trim(),alternativeWording:data.alternativeWording.trim(),sourceId:data.sourceId,owner:data.owner.trim(),reviewDate:data.reviewDate||'',status:'approved'});audit('Approved claim added',`“${data.wording.trim()}” was linked to a source.`);closeModal();renderAll();toast('Claim added to the ledger.');return;
 }
 if(form.id==='action-form'){
  const f=state.findings.find(x=>x.id===pendingAction?.findingId);if(!f)return closeModal();
  const action=pendingAction.action;
  if(session&&['resolve','dismiss','escalate'].includes(action)&&!canManageLibrary())return toast('Only Admins and Reviewers can record finding decisions.',true);
  if(action==='dismiss'&&f.category==='claim')return toast('Claim findings cannot be dismissed by creators.',true);
  f.status=action==='dismiss'?'dismissed':action==='escalate'?'escalated':'resolved';f.resolutionReason=data.reason.trim();
  if(action==='resolve'){f.sourceId=data.sourceId;const source=sourceById(data.sourceId);f.sourceTitle=source?.title||'';f.sourceQuote=source?.content||'';}
  const actionLabel={dismiss:'Finding dismissed',escalate:'Finding escalated',resolve:'Finding resolved with evidence'}[action];audit(actionLabel,`${f.type}: ${f.resolutionReason}`);closeModal();renderAll();toast(`${actionLabel}.`);return;
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

