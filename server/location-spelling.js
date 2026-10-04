// Conservative spelling correction: unique candidate, small edit distance,
// a clear gap to alternatives, and identical numeric/roman identifiers.
const romans = Object.fromEntries(['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'].map((r,i)=>[r,String(i+1)]));
export const locationWords = value => String(value || '').normalize('NFKD').toUpperCase()
  .replace(/\b(?:PRY|PRI)\b/g,'PRIMARY').replace(/\b(?:SCH|SCHL)\b/g,'SCHOOL');
export const locationKey = value => locationWords(value).replace(/[^A-Z0-9]/g,'');
export const locationIdentifiers = value => (locationWords(value).match(/\d+|\b[IVX]+\b/g) || [])
  .map(v => romans[v] || String(Number(v))).join('|');

export function editDistance(a,b) {
  const matrix=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++)matrix[i][0]=i;
  for(let j=0;j<=b.length;j++)matrix[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++) {
    matrix[i][j]=Math.min(matrix[i-1][j]+1,matrix[i][j-1]+1,matrix[i-1][j-1]+Number(a[i-1]!==b[j-1]));
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])matrix[i][j]=Math.min(matrix[i][j],matrix[i-2][j-2]+1);
  }
  return matrix[a.length][b.length];
}

export function uniqueSpellingMatch(value, choices) {
  const key=locationKey(value);if(key.length<5)return null;
  const ids=locationIdentifiers(value),scores=new Map();
  for(const choice of choices)for(const alias of choice.aliases) {
    if(locationIdentifiers(alias)!==ids)continue;
    const other=locationKey(alias);
    if(Math.abs(key.length-other.length)>2)continue;
    const distance=editDistance(key,other);
    const length=Math.min(key.length,other.length);
    const limit=length>=10?2:1;
    if(length<5||distance>limit||distance/length>(length>=10?0.15:0.2))continue;
    if(!scores.has(choice.value)||distance<scores.get(choice.value))scores.set(choice.value,distance);
  }
  const ranked=[...scores].sort((a,b)=>a[1]-b[1]);
  // Consider all nearby alternatives, including candidates just beyond the
  // correction threshold. This prevents a barely better guess being accepted.
  if(!ranked.length)return null;
  const [best,score]=ranked[0];
  for(const choice of choices)if(choice.value!==best)for(const alias of choice.aliases) {
    if(locationIdentifiers(alias)!==ids)continue;
    const other=locationKey(alias);
    if(Math.abs(key.length-other.length)>score+1)continue;
    if(editDistance(key,other)<score+2)return null;
  }
  return best;
}
