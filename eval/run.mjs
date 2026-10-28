import { readFile } from 'node:fs/promises';
import { analyzeDraft } from '../public/review-engine.js';
const data = JSON.parse(await readFile(new URL('./drafts.json', import.meta.url), 'utf8'));
const perCategory = new Map();
let cleanCount = 0, cleanFalseAlarms = 0, tp = 0, fp = 0, fn = 0;
for (const item of data.drafts) {
  const expected = new Set(item.expectedCategories);
  const predicted = new Set(analyzeDraft(item.draft, { sources: data.sources, claims: data.claims, today:'2026-10-28' }).map(f => f.category === 'claim' && f.type === 'Expired claim evidence' ? 'expired_claim_evidence' : f.category === 'claim' && f.type === 'Numeric conflict' ? 'numeric_conflict' : f.category === 'claim' ? 'claim_needs_evidence' : f.category));
  if (expected.size === 0) { cleanCount++; if (predicted.size) cleanFalseAlarms++; }
  for (const label of new Set([...expected, ...predicted])) {
    if (!perCategory.has(label)) perCategory.set(label,{tp:0,fp:0,fn:0});
    const m=perCategory.get(label);
    if(expected.has(label)&&predicted.has(label)){tp++;m.tp++;}
    else if(predicted.has(label)){fp++;m.fp++;}
    else {fn++;m.fn++;}
  }
}
const precision=tp/(tp+fp)||0, recall=tp/(tp+fn)||0;
const pct = n => `${(n*100).toFixed(1)}%`;
console.log(`Drafts: ${data.drafts.length}; clean drafts: ${cleanCount}`);
console.log(`Micro precision: ${pct(precision)}; recall: ${pct(recall)}; clean false-alarm rate: ${pct(cleanFalseAlarms/cleanCount)}`);
console.log('| Category | TP | FP | FN | Precision | Recall |');
console.log('|---|---:|---:|---:|---:|---:|');
for(const [name,m] of [...perCategory].sort((a,b)=>a[0].localeCompare(b[0]))) console.log(`| ${name} | ${m.tp} | ${m.fp} | ${m.fn} | ${pct(m.tp/(m.tp+m.fp)||0)} | ${pct(m.tp/(m.tp+m.fn)||0)} |`);
console.log(`Totals: TP ${tp}, FP ${fp}, FN ${fn}`);
