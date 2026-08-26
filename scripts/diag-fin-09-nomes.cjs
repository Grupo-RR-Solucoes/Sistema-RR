require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async()=>{
  const { data } = await sb.from("promoters").select("*").limit(1);
  console.log("colunas de promoters: " + Object.keys(data[0]||{}).join(", "));
  const { data: all } = await sb.from("promoters").select("*");
  console.log("total de promotores: " + all.length);
  const campos = Object.keys(all[0]).filter(c=>/name|nome/i.test(c));
  console.log("campos de nome: " + campos.join(", ") + "\n");
  const ALVOS=["FABIANA","LETICIA","LETÍCIA","CAMILA","KETLEY","KETLEN","KETILY"];
  const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase();
  for (const a of ALVOS) {
    const hits=all.filter(p=>campos.some(c=>norm(p[c]).includes(norm(a))));
    console.log(`${a.padEnd(10)} -> ${hits.length} achado(s)` + (hits.length? ": "+hits.map(h=>campos.map(c=>h[c]).filter(Boolean)[0]).join(" ; ") : ""));
  }
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
