const QUANTITY_RE = /(?:([$₹])\s*)?(\d[\d,]*(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|thirty)\s*[- ]?\s*(%|days?|weeks?|months?|years?|hours?|minutes?|participants?|people|customers|orders|ml|USD|INR|EUR|GBP|dollars?|rupees?)?(?!\w)/gi;
const NUMBER_WORDS = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, fourteen:14, thirty:30 };

function quantityValue(match) {
  const number = NUMBER_WORDS[String(match[2]).toLowerCase()] ?? Number(String(match[2]).replaceAll(',', ''));
  const rawUnit = (match[3] || (match[1]==='$'?'USD':match[1]==='₹'?'INR':'')).toLowerCase().replace(/s$/, '');
  if (rawUnit === 'week') return { value: number * 7, unit: 'day', display: match[0] };
  if (rawUnit === 'participant' || rawUnit === 'person' || rawUnit === 'people') return { value: number, unit: 'person', display: match[0] };
  return { value: number, unit: rawUnit, display: match[0] };
}

export function extractKeyValues(text = '') {
  QUANTITY_RE.lastIndex = 0;
  return [...String(text).matchAll(QUANTITY_RE)].map(match => quantityValue(match)).filter(item=>item.unit);
}

export function snapshotSource(source) {
  return {
    version: Number(source.version || 1),
    title: source.title || '', type: source.type || '', owner: source.owner || '',
    expiry: source.expiry || '', content: source.content || '', updated: source.updated || ''
  };
}

export function updateSourceVersion(source, patch, at = new Date().toISOString()) {
  const prior = snapshotSource(source);
  const next = { ...source, ...patch };
  const changed = ['title','type','owner','expiry','content'].some(key => String(next[key] || '') !== String(prior[key] || ''));
  if (!changed) return { source: next, changed: false, previous: prior };
  next.versions = [...(Array.isArray(source.versions) ? source.versions : []), prior];
  next.version = prior.version + 1;
  next.updated = at;
  return { source: next, changed: true, previous: prior };
}

export function migrateClaim(claim, source) {
  if (!claim || !source) return claim;
  return {
    ...claim,
    sourceVersion: Number(claim.sourceVersion || source.version || 1),
    supportingExcerpt: String(claim.supportingExcerpt || source.content || ''),
    keyValues: Array.isArray(claim.keyValues) ? claim.keyValues : extractKeyValues(claim.supportingExcerpt || source.content || ''),
    expiryDate: claim.expiryDate || claim.reviewDate || source.expiry || '',
    status: claim.status === 'expired' ? 're-review' : (claim.status || 'approved'),
    history: Array.isArray(claim.history) ? claim.history : []
  };
}

export function claimReviewReasons(claim, sources, today = new Date().toISOString().slice(0,10)) {
  const source = sources.find(item => item.id === claim.sourceId);
  const reasons = [];
  if (!source) reasons.push('Supporting source is missing.');
  else {
    if (Number(claim.sourceVersion || 1) !== Number(source.version || 1)) reasons.push(`Source changed from version ${claim.sourceVersion || 1} to ${source.version || 1}.`);
    if (source.expiry && source.expiry < today) reasons.push(`Source review date passed on ${source.expiry}.`);
  }
  if (claim.expiryDate && claim.expiryDate < today) reasons.push(`Claim review date passed on ${claim.expiryDate}.`);
  if (claim.status !== 'approved' && claim.status !== 're-review') reasons.push('Claim is not currently approved.');
  if (claim.status === 're-review' && !reasons.length) reasons.push(claim.staleReason || 'A reviewer requested renewed substantiation.');
  return reasons;
}

export function refreshEvidenceLifecycle(state, today = new Date().toISOString().slice(0,10)) {
  state.claims = (state.claims || []).map(claim => migrateClaim(claim, state.sources.find(s => s.id === claim.sourceId)) || claim);
  const staleClaims = [];
  for (const claim of state.claims) {
    const reasons = claimReviewReasons(claim, state.sources, today);
    if (reasons.length) {
      if (claim.status === 'approved') claim.status = 're-review';
      claim.staleReason = reasons.join(' ');
      staleClaims.push({ claim, reasons });
    } else {
      delete claim.staleReason;
    }
  }
  state.approvalRecords ||= [];
  for (const approval of state.approvalRecords) {
    if (approval.status === 're-review') continue;
    const sourceChanged = (approval.sourceRefs || []).some(ref => {
      const source = state.sources.find(item => item.id === ref.sourceId);
      return !source || Number(source.version || 1) !== Number(ref.version || 1) || Boolean(source.expiry && source.expiry < today);
    });
    const claimChanged = (approval.claimRefs || []).some(ref => {
      const claimId = typeof ref === 'string' ? ref : ref?.claimId;
      const claim = state.claims.find(item => item.id === claimId);
      if (!claim || claimReviewReasons(claim, state.sources, today).length > 0) return true;
      // Older approvals stored only claim IDs. Conservatively re-review these
      // when the claim has since acquired a version history.
      if (typeof ref === 'string') return Number(claim.version || 1) > 1;
      return Number(ref.version || 1) !== Number(claim.version || 1)
        || Number(ref.sourceVersion || 1) !== Number(claim.sourceVersion || 1);
    });
    if (sourceChanged || claimChanged) {
      approval.status = 're-review';
      approval.staleAt = new Date().toISOString();
      approval.staleReason = sourceChanged ? 'A source version or source review date changed.' : 'A supporting claim needs renewed review.';
    }
  }
  return {
    claims: staleClaims,
    approvals: state.approvalRecords.filter(item => item.status === 're-review')
  };
}

function canonicalRuleKey(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,80) || 'unspecified-rule';
}

function thresholdRules(source) {
  const text = `${source.title || ''}. ${source.content || ''}`;
  const patterns = [
    { re: /\b(?:at most|no more than|maximum of|max(?:imum)?(?: of)?)\s+(one|two|three|\d+)\s+([a-z -]+?)(?:\s+(?:per|in|for)\s+([a-z -]+))?(?:[.!?,;]|$)/gi, direction:'max' },
    { re: /\b(?:at least|no fewer than|minimum of|min(?:imum)?(?: of)?)\s+(one|two|three|\d+)\s+([a-z -]+?)(?:\s+(?:per|in|for)\s+([a-z -]+))?(?:[.!?,;]|$)/gi, direction:'min' }
  ];
  const wordNumbers = { one:1, two:2, three:3 };
  const found = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.re)) {
      const value = wordNumbers[match[1].toLowerCase()] ?? Number(match[1]);
      const subject = `${match[2]} ${match[3] || ''}`.toLowerCase().replace(/\b(the|a|an|each|all|brand|guideline|rule)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).map(word=>word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word).join(' ');
      if (Number.isFinite(value) && subject) found.push({ sourceId:source.id, sourceTitle:source.title, owner:source.owner, direction:pattern.direction, value, subject, excerpt:match[0].trim(), key:`conflict:${canonicalRuleKey(subject)}` });
    }
  }
  return found;
}

export function detectGuidelineConflicts(sources = [], claims = []) {
  const rules = sources.filter(s => /guideline|rule/i.test(`${s.type} ${s.title}`)).flatMap(thresholdRules);
  const conflicts = [];
  for (let i=0; i<rules.length; i++) for (let j=i+1; j<rules.length; j++) {
    const a=rules[i], b=rules[j];
    if (a.subject !== b.subject || a.sourceId === b.sourceId) continue;
    const inconsistent = (a.direction==='max' && b.direction==='min' && a.value < b.value) || (b.direction==='max' && a.direction==='min' && b.value < a.value);
    if (inconsistent) conflicts.push({ key:`conflict:${canonicalRuleKey(a.subject)}`, subject:a.subject, examples:[a,b], summary:`These sources set incompatible limits for ${a.subject}.` });
  }
  const guides=sources.filter(s=>/guideline|rule/i.test(`${s.type} ${s.title}`));
  for(const guide of guides){
    const avoidBlocks=[...String(guide.content||'').matchAll(/\bavoid\s+([^.;]+)/gi)].flatMap(match=>match[1].replace(/[“”"']/g,'').split(/,|\band\b/i).map(term=>term.trim().replace(/\bunsupported\b/gi,'').trim()).filter(term=>term.length>3));
    for(const claim of claims.filter(item=>item.status==='approved')){
      const wording=String(claim.wording||'').toLowerCase();const prohibited=avoidBlocks.find(term=>term&&wording.includes(term.toLowerCase()));
      if(prohibited)conflicts.push({key:`claim-conflict:${claim.id}:${guide.id}`,subject:prohibited,examples:[{sourceId:guide.id,sourceTitle:guide.title,excerpt:`Avoid ${prohibited}.`},{sourceId:claim.sourceId,sourceTitle:`Approved claim: ${claim.wording}`,excerpt:claim.wording}],summary:`An approved claim may conflict with the “${prohibited}” restriction in ${guide.title}.`});
    }
  }
  return conflicts;
}

export function collectGuidelineInsights(state) {
  const audit = state.audit || [];
  const grouped = new Map();
  for (const event of audit) {
    const decision = event.decision || '';
    if (!['dismissed','override','escalated'].includes(decision)) continue;
    const key = event.insightKey || event.ruleKey || canonicalRuleKey(event.ruleType || event.action || 'finding');
    if (!grouped.has(key)) grouped.set(key, { key, ruleType:event.ruleType || 'Guideline finding', category:event.category || 'guidance', events:[] });
    const group=grouped.get(key); group.events.push(event); group.ruleType=event.ruleType || group.ruleType; group.category=event.category || group.category;
  }
  const patterns=[];
  for (const group of grouped.values()) {
    const dismissed=group.events.filter(e=>e.decision==='dismissed').length;
    const overridden=group.events.filter(e=>e.decision==='override').length;
    const escalated=group.events.filter(e=>e.decision==='escalated').length;
    const relevant=dismissed+overridden+escalated;
    if (relevant < 2) continue;
    const latestDecision=(state.ruleDecisions||[]).filter(d=>d.insightKey===group.key).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0];
    const after=latestDecision ? group.events.filter(e=>String(e.at||'')>String(latestDecision.at||'') && ['dismissed','override'].includes(e.decision)) : [];
    patterns.push({ key:group.key, ruleType:group.ruleType, category:group.category, dismissed, overridden, escalated, total:group.events.length, dismissalRate: (dismissed+overridden) / group.events.length, examples:group.events.slice(-3), latestDecision, afterCount:after.length, afterDismissalRate:after.length ? after.filter(e=>e.decision==='dismissed').length/after.length : null, summary:escalated>=2 ? `${escalated} escalations recorded for this rule.` : `${dismissed+overridden} dismissals or accepted edits recorded for this rule.` });
  }
  return { patterns, conflicts:detectGuidelineConflicts(state.sources || [],state.claims || []) };
}

function tokenSegments(text) { return String(text).match(/\s+|[^\s]+/g) || []; }
export function wordDiff(before, after) {
  const a=tokenSegments(before), b=tokenSegments(after); let prefix=0;
  while(prefix<a.length && prefix<b.length && a[prefix]===b[prefix]) prefix++;
  let suffix=0;
  while(suffix<a.length-prefix && suffix<b.length-prefix && a[a.length-1-suffix]===b[b.length-1-suffix]) suffix++;
  return { beforePrefix:a.slice(0,prefix).join(''), beforeChange:a.slice(prefix,a.length-suffix).join(''), beforeSuffix:suffix?a.slice(a.length-suffix).join(''):'', afterPrefix:b.slice(0,prefix).join(''), afterChange:b.slice(prefix,b.length-suffix).join(''), afterSuffix:suffix?b.slice(b.length-suffix).join(''):'' };
}

function urls(text) { return String(text).match(/https?:\/\/[^\s)]+/gi) || []; }
function numericTokens(text) { return String(text).match(/(?:[$₹]\s*)?\b\d[\d,.]*%?\b|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|thirty)\b/gi) || []; }
function protectedNames(text) {
  const tokens=String(text).match(/\b[A-Z][a-z]+\b/g)||[];
  return [...new Set(tokens.filter(word=>!['The','A','An','This','That','In','For','Our','Your','Use','Avoid','Replace','Review','BrandLens','However','But','And','Or','If','When','It','I','We','He','She','They','My','His','Her','Their'].includes(word)))];
}

export function validateRewrite({ before, after, finding, sourceQuote = '' }) {
  if (!before || !after || before === after) return { ok:false, reason:'No meaningful replacement was generated.' };
  if (urls(before).some(url=>!urls(after).includes(url))) return { ok:false, reason:'The rewrite would remove or change a link.' };
  const numbersBefore=numericTokens(before).map(v=>v.toLowerCase());
  const numbersAfter=numericTokens(after).map(v=>v.toLowerCase());
  const valuesBefore=extractKeyValues(before).map(v=>`${v.value}:${v.unit}`);
  const valuesAfter=extractKeyValues(after).map(v=>`${v.value}:${v.unit}`);
  const supportedValues=extractKeyValues(sourceQuote).map(v=>`${v.value}:${v.unit}`);
  const claimFinding=finding?.category==='claim';
  if (!claimFinding && (numbersBefore.some(v=>!numbersAfter.includes(v))||valuesBefore.some(v=>!valuesAfter.includes(v)))) return { ok:false, reason:'The rewrite would change a number outside a claim correction.' };
  if (claimFinding && (numbersAfter.some(v=>!numericTokens(sourceQuote).map(n=>n.toLowerCase()).includes(v))||valuesAfter.some(v=>!supportedValues.includes(v)))) return { ok:false, reason:'A number or its unit in the replacement is not present in the supporting excerpt.' };
  if (protectedNames(before).some(name=>!after.includes(name))) return { ok:false, reason:'The rewrite would remove a name.' };
  return { ok:true, diff:wordDiff(before,after) };
}

function replacementFromGuide(finding, sources) {
  const guides=sources.filter(s=>/guideline|rule/i.test(`${s.type} ${s.title}`));
  for (const source of guides) {
    const re=/replace\s+[“"']([^”"']+)[”"']\s+with\s+[“"']([^”"']+)[”"']/gi;
    for (const match of source.content.matchAll(re)) {
      const from=match[1], to=match[2];
      if (new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(finding.quote)) return { replacement:finding.quote.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i'),to), source, rationale:`Approved terminology replacement: “${from}” → “${to}”.` };
    }
  }
  return null;
}

function findRelatedClaim(finding, claims, sources, today) {
  const words=value=>new Set(String(value).toLowerCase().match(/[a-z]{4,}/g)||[]);
  const draftWords=words(finding.quote);
  let best=null, score=0;
  for (const raw of claims) {
    const claim=migrateClaim(raw,sources.find(s=>s.id===raw.sourceId));
    if (!claim || claim.status!=='approved' || claimReviewReasons(claim,sources,today).length) continue;
    const common=[...words(claim.wording)].filter(word=>draftWords.has(word)).length;
    const ratio=common/Math.max(1,words(claim.wording).size);
    if (ratio>score) {best=claim;score=ratio;}
  }
  return score>=0.45 ? best : null;
}

export function proposeVerifiedRewrite({ draft, finding, sources = [], claims = [], today = new Date().toISOString().slice(0,10), aiSuggestion = '', analyzeDraft }) {
  const start=String(draft).indexOf(finding.quote);
  if (start<0) return null;
  let candidate=null, source=null, rationale='', provenance='approved-guideline', supportingExcerpt='';
  if (finding.category==='claim') {
    const claim=findRelatedClaim(finding,claims,sources,today);
    const linkedSource=claim&&sources.find(s=>s.id===claim.sourceId);
    const alt=String(claim?.alternativeWording||'').trim();
    if (claim && alt) {
      candidate=alt; source=linkedSource; supportingExcerpt=claim.supportingExcerpt||linkedSource?.content||''; rationale='Replacement wording was explicitly approved in the claim ledger.'; provenance='claim-ledger';
    }
  } else {
    const guided=replacementFromGuide(finding,sources);
    if (guided) { candidate=guided.replacement; source=guided.source; rationale=guided.rationale; }
    else if (finding.model && aiSuggestion) {
      candidate=String(aiSuggestion).slice(0,500); source=sources.find(s=>s.id===finding.sourceId); provenance='optional-ai-tone'; rationale='Optional AI tone suggestion; it must pass the same deterministic review before use.';
    } else if (finding.suggestion) {
      const sourceId=finding.sourceId; source=sources.find(s=>s.id===sourceId);
      candidate=finding.suggestion;
      rationale='Deterministic wording adjustment; the changed draft is checked again before approval.';
    }
  }
  if (!candidate) return null;
  const checked=validateRewrite({before:finding.quote,after:candidate,finding,sourceQuote:finding.category==='claim'?supportingExcerpt:(source?.content||finding.sourceQuote||'')});
  if (!checked.ok) return null;
  const rewritten=String(draft).slice(0,start)+candidate+String(draft).slice(start+finding.quote.length);
  const beforeFindings=findingSignaturesForSpan([finding]);
  if (typeof analyzeDraft==='function') {
    const next=analyzeDraft(rewritten,{sources,claims,today});
    const newLocal=next.filter(item=>rewritten.indexOf(item.quote)>=start && rewritten.indexOf(item.quote)<start+candidate.length);
    if (newLocal.some(item=>item.type===finding.type&&item.category===finding.category)) return null;
    if (newLocal.some(item=>!beforeFindings.has(`${item.type}|${item.category}`))) return null;
    if (finding.category==='claim' && newLocal.some(item=>item.category==='claim')) return null;
  }
  return { replacement:candidate, sourceId:source?.id||finding.sourceId||null, sourceTitle:source?.title||finding.sourceTitle||'', sourceQuote:source?.content||finding.sourceQuote||'', rationale, provenance, diff:checked.diff, verifiedAt: new Date().toISOString() };
}

function findingSignaturesForSpan(findings) { return new Set(findings.map(item=>`${item.type}|${item.category}`)); }
