// Redesign (.rrlogin): tela de login no padrao novo (stage navy full-screen,
// card branco). Injetado em page.tsx; o LoginForm renderiza dentro do escopo.
export const RRLOGIN_CSS = `
.rrlogin{
  --navy:#0F1F4A; --navy-deep:#0B1838;
  --yellow:#FFF000; --gold:#D6A13F; --blue:#0d4de3;
  --card:#FFFFFF; --bd:#E4E7EC; --bd-soft:#EEF0F4;
  --ink:#16203A; --ink-2:#4B5468; --ink-3:#838B9C;
  --danger:#C0392B; --danger-bg:#FCEFEC; --danger-bd:#F2C9C0;
  --amber-bg:#FBF1DC; --amber-bd:#EAD7A6; --amber-tx:#6B5316;
  --r-lg:20px; --r-md:16px; --r-sm:11px;
  color:var(--ink);font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.45;
}
.rrlogin *{box-sizing:border-box;}

/* STAGE full-screen navy */
.rrlogin .stage{
  min-height:100vh;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:40px 20px;
  background:
    radial-gradient(1100px 620px at 50% -8%, #1A2F63 0%, rgba(26,47,99,0) 60%),
    radial-gradient(900px 700px at 88% 116%, #13285C 0%, rgba(19,40,92,0) 55%),
    linear-gradient(160deg,#0F1F4A 0%, #0B1838 100%);
}
.rrlogin .stage::before{
  content:"";position:absolute;inset:0;
  background-image:radial-gradient(rgba(255,255,255,.045) 1px, transparent 1.4px);
  background-size:26px 26px;
  -webkit-mask-image:radial-gradient(1000px 700px at 50% 30%, #000 0%, transparent 78%);
  mask-image:radial-gradient(1000px 700px at 50% 30%, #000 0%, transparent 78%);
  pointer-events:none;
}
.rrlogin .stage::after{
  content:"";position:absolute;left:0;right:0;top:0;height:3px;
  background:linear-gradient(90deg, rgba(214,161,63,0), var(--gold) 45%, var(--gold) 55%, rgba(214,161,63,0));
  opacity:.6;
}

/* CARD */
.rrlogin .auth{position:relative;z-index:2;width:100%;max-width:440px;display:flex;flex-direction:column;}
.rrlogin .card{background:var(--card);border-radius:var(--r-lg);box-shadow:0 1px 2px rgba(0,0,0,.10), 0 24px 60px rgba(7,16,42,.45);padding:34px 36px 28px;}

/* LOGO */
.rrlogin .brandmark{display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:22px;}

/* HEADINGS */
.rrlogin .head{text-align:center;margin-bottom:22px;}
.rrlogin .head h1{font-size:22px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--ink);}
.rrlogin .head p{font-size:13px;color:var(--ink-3);margin:7px 0 0;}

/* ALERTS */
.rrlogin .alert{display:flex;align-items:flex-start;gap:11px;border-radius:var(--r-sm);padding:12px 14px;margin-bottom:20px;font-size:13px;line-height:1.4;}
.rrlogin .alert .ai{flex:none;width:18px;height:18px;margin-top:1px;}
.rrlogin .alert.err{background:var(--danger-bg);border:1px solid var(--danger-bd);color:#8A2A1C;}
.rrlogin .alert.err b{color:#6E1F14;font-weight:600;}
.rrlogin .alert.warn{background:var(--amber-bg);border:1px solid var(--amber-bd);color:var(--amber-tx);}
.rrlogin .alert.warn b{color:#4A3A0C;font-weight:600;}

/* FORM */
.rrlogin .field{margin-bottom:17px;}
.rrlogin .field label{display:block;font-size:12.5px;font-weight:600;color:var(--ink-2);margin:0 0 7px;}
.rrlogin .control{position:relative;}
.rrlogin .control .lead{position:absolute;left:13px;top:50%;transform:translateY(-50%);width:18px;height:18px;color:var(--ink-3);pointer-events:none;}
.rrlogin .control input{width:100%;height:48px;border:1px solid var(--bd);border-radius:var(--r-md);background:#FBFCFE;padding:0 14px 0 42px;font-family:inherit;font-size:14.5px;color:var(--ink);transition:border-color .15s, box-shadow .15s, background .15s;}
.rrlogin .control input::placeholder{color:#AEB5C4;}
.rrlogin .control input:hover{border-color:#CDD3DE;}
.rrlogin .control input:focus{outline:none;border-color:var(--blue);background:#fff;box-shadow:0 0 0 4px rgba(13,77,227,.13);}
.rrlogin .control input:disabled{opacity:.7;cursor:default;}
.rrlogin .field.pw .control input{padding-right:46px;}
.rrlogin .reveal{position:absolute;right:7px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:none;background:transparent;border-radius:9px;cursor:pointer;color:var(--ink-3);display:grid;place-items:center;transition:background .14s,color .14s;}
.rrlogin .reveal:hover{background:#F1F3F7;color:var(--ink-2);}
.rrlogin .reveal:focus-visible{outline:2px solid var(--blue);outline-offset:1px;}
.rrlogin .reveal svg{width:18px;height:18px;display:block;}
.rrlogin .alert.err ~ .field .control input,.rrlogin .field.err .control input{border-color:var(--danger-bd);background:#FFFBFA;}

/* BUTTON */
.rrlogin .btn{width:100%;height:50px;margin-top:6px;border:none;border-radius:var(--r-md);background:var(--yellow);color:var(--navy);font-family:inherit;font-size:15px;font-weight:700;letter-spacing:.01em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 2px 0 rgba(184,176,0,.55), 0 8px 18px rgba(255,240,0,.18);transition:transform .12s, box-shadow .14s, filter .14s, opacity .14s;}
.rrlogin .btn:hover{filter:brightness(.98);box-shadow:0 2px 0 rgba(184,176,0,.55), 0 10px 22px rgba(255,240,0,.26);}
.rrlogin .btn:active{transform:translateY(1px);box-shadow:0 1px 0 rgba(184,176,0,.55);}
.rrlogin .btn:focus-visible{outline:3px solid rgba(13,77,227,.5);outline-offset:2px;}
.rrlogin .btn[disabled]{cursor:default;opacity:.6;filter:saturate(.5);box-shadow:none;}
.rrlogin .btn .spin{width:18px;height:18px;flex:none;border:2.5px solid rgba(15,31,74,.30);border-top-color:var(--navy);border-radius:50%;animation:rrloginspin .7s linear infinite;}
@keyframes rrloginspin{to{transform:rotate(360deg);}}

/* CARD FOOTER */
.rrlogin .resethint{margin-top:22px;padding-top:18px;border-top:1px solid var(--bd-soft);text-align:center;font-size:12.5px;color:var(--ink-3);line-height:1.5;}
.rrlogin .resethint b{color:var(--ink-2);font-weight:600;}

/* PAGE FOOTER over navy */
.rrlogin .pagefoot{margin-top:26px;text-align:center;font-size:11.5px;font-weight:500;letter-spacing:.04em;color:rgba(201,210,232,.62);display:flex;align-items:center;justify-content:center;gap:9px;}
.rrlogin .pagefoot .dot{width:5px;height:5px;border-radius:50%;background:var(--gold);opacity:.9;}

@media (max-width:520px){
  .rrlogin .card{padding:28px 22px 24px;}
}
`;
