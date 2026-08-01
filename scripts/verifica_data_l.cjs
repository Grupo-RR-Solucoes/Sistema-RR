const fs=require("fs"),cp=require("child_process");
const out=cp.execSync(`grep -rn "<Table" app/ --include=*.tsx | grep " cards" | grep -v TableState`,{encoding:"utf8"}).trim().split("\n");
let falhas=0;
console.log("TABELA".padEnd(50)+"cel  dataL  cspan  falta  VEREDITO");
console.log("-".repeat(92));
for(const ln of out){
  const m=ln.match(/^([^:]+):(\d+):/); if(!m) continue;
  const [,f,lRaw]=m; const l=+lRaw;
  const src=fs.readFileSync(f,"utf8").split("\n");
  let end=l; while(end<src.length && !src[end-1].includes("</Table>")) end++;
  const blk=src.slice(l-1,end).join("\n");
  // abre a tag literal <td ou <Num e vai ate o > que a fecha
  const tags=[...blk.matchAll(/<(td|Num)\b[^>]*>/g)].map(x=>x[0]);
  const cel=tags.length;
  const comDataL=tags.filter(t=>/\bdata-l=/.test(t)).length;
  const comColSpan=tags.filter(t=>/\bcolSpan=/.test(t)).length;
  const falta=cel-comDataL;
  const ok=falta===comColSpan;
  if(!ok)falhas++;
  console.log((f.replace("app/","")+":"+l).padEnd(50)+String(cel).padStart(3)+String(comDataL).padStart(7)+String(comColSpan).padStart(7)+String(falta).padStart(7)+"  "+(ok?"OK":"FALHA"));
}
console.log("-".repeat(92));
console.log(falhas===0?"VERIFICADOR OK — 0 FALHAS":`VERIFICADOR: ${falhas} FALHA(S)`);
