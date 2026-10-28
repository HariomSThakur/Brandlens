// Shared deterministic rules for the browser UI and the frozen evaluation set.
export function analyzeDraft(draft, { sources = [], claims = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const findings = [];
  const sourceFact = sources.find(s => /product facts|fact sheet|study/i.test(`${s.type} ${s.title}`)) || sources[0];
  const guide = sources.find(s => /guideline/i.test(`${s.type} ${s.title}`));
  const sentences = [...draft.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g)].map(m => m[0].trim()).filter(Boolean);
  const add = (type, category, severity, quote, reason, suggestion = '', source = sourceFact) => findings.push({ type, category, severity, quote, reason, suggestion, sourceId: source?.id || null, sourceTitle: source?.title || '', sourceQuote: source?.content || '' });
  const quantity = /\b(\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|thirty)\s*[- ]?\s*(%|days?|weeks?|months?|years?|hours?|minutes?|participants?|people|customers|orders|ml|\$|₹)(?!\w)/gi;
  const numberValue = value => ({zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,fourteen:14,thirty:30}[String(value).toLowerCase()] ?? Number(value));
  const normalizedQuantity = m => { const n=numberValue(m[1]); const u=m[2].toLowerCase().replace(/s$/, ''); if(u==='week')return [n*7,'day']; if(u==='participant'||u==='person'||u==='people')return [n,'person']; return [n,u]; };
  for (const text of sentences) {
    const norm = text.toLowerCase();
    const oldClaim = claims.find(c => norm.includes(String(c.wording).toLowerCase()));
    const linkedSource = oldClaim && sources.find(s => s.id === oldClaim.sourceId);
    const claimExpired = oldClaim && (oldClaim.status !== 'approved' || (oldClaim.reviewDate && oldClaim.reviewDate < today) || (linkedSource?.expiry && linkedSource.expiry < today));
    if (claimExpired) add('Expired claim evidence', 'claim', 'high', text, `This wording matches a claim whose review date passed on ${oldClaim.reviewDate || 'its review date'}. Refresh and approve its evidence before reuse.`, oldClaim.alternativeWording || '', linkedSource);
    else if (!oldClaim && (/\b(clinically proven|clinically tested|guarantee(?:d)?|erase|cure|permanent)\b/i.test(text) || /\b100\s*%/i.test(text) || /\b\d[\d,]*\+?\s*(?:%|ml|customers|families|users|people|days?|weeks?|months?)(?!\w)/i.test(text))) add('Claim needs evidence', 'claim', 'high', text, 'This sentence makes a performance, timeframe or quantified claim. Verify that the approved source supports the exact result and scope before use.', '', sourceFact);
    if (sourceFact?.content) {
      quantity.lastIndex=0;
      const sourceQuantities = [...sourceFact.content.matchAll(quantity)].filter(m => { const start=sourceFact.content.lastIndexOf('.',m.index)+1; return !/did not evaluate/i.test(sourceFact.content.slice(start,m.index)); }).map(normalizedQuantity).map(([n,u]) => `${n}:${u}`);
      quantity.lastIndex=0;
      for (const m of text.matchAll(quantity)) {
        const [n,u] = normalizedQuantity(m);
        const key = `${n}:${u}`;
        const family = key.split(':')[1];
        if (sourceQuantities.some(q => q.split(':')[1] === family) && !sourceQuantities.includes(key)) {
          add('Numeric conflict', 'claim', 'high', text, `The draft states ${m[0]}, but the approved source has a different ${family} value. Check the exact number and timeframe against the source before use.`, '', sourceFact);
          break;
        }
      }
    }
    const banned = text.match(/\b(whitening|bleaching)\b/i);
    if (banned) add('Terminology', 'terminology', 'medium', banned[0], 'The writing guide asks creators to use approved brand terminology.', 'brightening', guide);
    if (/!{2,}/.test(text)) add('Tone', 'tone', 'low', text, 'The writing guide allows at most one exclamation mark per post.', text.replace(/!{2,}/g, '!'), guide);
    if (/^[A-Z\d\s.,!?'-]{18,}$/.test(text) && /[A-Z]/.test(text)) add('Readability', 'readability', 'low', text, 'This all-caps text may be harder to scan. Review the casing.', text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()), guide);
    if (text.split(/\s+/).length > 38) add('Readability', 'readability', 'low', text, 'This sentence is long. Consider splitting it so readers can scan it more easily.', '', guide);
  }
  return findings;
}
