import { useState, useEffect, useRef } from "react";

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const C = {
  bg:"#FAF8F5", text:"#2C2C2C", muted:"#9B8E85",
  border:"#E8E0D8", card:"#FFFFFF", accent:"#C4957A", accentLight:"#FBF6EE",
};

// ─── SKIN ERAS ────────────────────────────────────────────────────────────────
const ERAS = {
  barrier_healing:  { id:"barrier_healing",  emoji:"🌿", name:"Barrier Healing Era",   tagline:"Your skin is not broken — it's asking for gentleness.",       affirmation:"I give my skin permission to heal at its own pace.", color:"#7A9E6E", bg:"#F2F6EF" },
  acne_reset:       { id:"acne_reset",        emoji:"🧊", name:"Acne Reset Era",         tagline:"Your skin isn't struggling — it's communicating.",             affirmation:"I listen to my skin instead of fighting it.",         color:"#6A98B0", bg:"#EEF4F8" },
  burnout_recovery: { id:"burnout_recovery",  emoji:"😴", name:"Burnout Recovery Era",   tagline:"Your skin is tired because you are. That's valid.",            affirmation:"Rest is part of my skincare routine.",               color:"#9B85B8", bg:"#F5F2F8" },
  glow_building:    { id:"glow_building",     emoji:"✨", name:"Glow Building Era",      tagline:"Your foundation is ready. Now we build radiance.",             affirmation:"I nourish my skin with intention, not urgency.",     color:"#B8924A", bg:"#FBF6EE" },
  repair_restore:   { id:"repair_restore",    emoji:"🌙", name:"Repair & Restore Era",   tagline:"Aging is not the enemy — neglect is.",                         affirmation:"I invest in my skin's future, one day at a time.",   color:"#B07860", bg:"#FAF3EF" },
};

function fallbackEra(a) {
  const c = a.concerns || [];
  if (c.includes("sensitive")||c.includes("dryness")) return ERAS.barrier_healing;
  if (c.includes("acne"))                              return ERAS.acne_reset;
  if (a.smoke==="yes"||a.age==="45+")                  return ERAS.burnout_recovery;
  if (c.includes("dullness")||c.includes("pores"))     return ERAS.glow_building;
  if (c.includes("wrinkles")||a.age==="35-44")         return ERAS.repair_restore;
  return ERAS.barrier_healing;
}

// ─── AI ENGINE ────────────────────────────────────────────────────────────────
async function analyzeWithAI(answers) {
  const PLABELS = { cleanser:"Cleanser", moisturizer:"Moisturizer", serum:"Serum", treatments:"Active treatments (acne/anti-aging)", spf:"Sunscreen", none:"No products currently" };
  const CLABELS = { acne:"Breakouts & acne", wrinkles:"Fine lines & aging", pigmentation:"Dark spots", sensitive:"Sensitive & reactive", dryness:"Dryness & dehydration", pores:"Enlarged pores" };
  const ALABELS = { cosmetics:"Cosmetics", iodine:"Iodine", foods:"Foods", fragrance:"Fragrances", sunscreen:"Sunscreens", meds:"Medications", animals:"Animals" };

  const products  = (answers.routine_products||[]).map(p=>PLABELS[p]||p).join(", ") || "None";
  const concerns  = (answers.concerns||[]).map(c=>CLABELS[c]||c).join(", ")         || "None specified";
  const allergies = (answers.allergies||[]).filter(a=>a!=="none").map(a=>ALABELS[a]||a).join(", ") || "None";
  const photos    = ["photo_right","photo_left","photo_front"].filter(k=>answers[k]).length;
  const shelf     = (answers.shelf_photos||[]).length;

  const system = `You are a clinical cosmetologist with 20 years of experience in skin analysis and personalized routine building. You analyze a client's complete profile — skin condition, lifestyle, health history, and current products — and return precise, science-backed recommendations.

Rules:
- Flag products that conflict with the client's skin concerns (e.g. harsh acids on a compromised barrier)
- Consider health flags: smoking accelerates aging and impairs healing; diabetes affects wound healing and sensitivity; pregnancy restricts retinoids, salicylic acid, high-dose Vitamin C, essential oils
- Build routines that are realistic — not overwhelming
- Be specific, not generic
- Return ONLY valid JSON with no extra text, no markdown fences`;

  const user = `Analyze this client and return a complete skin profile:

PROFILE:
- Gender: ${answers.gender||"not specified"}
- Age: ${answers.age||"not specified"}  
- Skin tone (Fitzpatrick): Type ${answers.tone||"not specified"}
- Concerns: ${concerns}
- Current products: ${products}
- Smokes: ${answers.smoke||"no"}
- Diabetes: ${answers.diabetes||"no"}
- Allergies: ${allergies}
- Pregnant/TTC: ${answers.pregnant||"no"}
- Goals: ${answers.goals||"not stated"}
- Photos uploaded: ${photos} selfies + ${shelf} shelf photos

RETURN exactly this JSON structure:
{
  "eraId": "barrier_healing",
  "skinAnalysis": "2-3 sentence clinical analysis specific to this client",
  "keyInsights": ["specific insight 1","specific insight 2","specific insight 3"],
  "productAudit": {
    "keep":    [{"product":"...","reason":"..."}],
    "remove":  [{"product":"...","reason":"..."}],
    "replace": [{"from":"...","to":"...","reason":"..."}],
    "add":     [{"product":"...","reason":"...","priority":"essential|recommended"}]
  },
  "routine": {
    "am": [{"name":"...","description":"..."},{"name":"...","description":"..."},{"name":"...","description":"..."},{"name":"...","description":"..."},{"name":"...","description":"..."}],
    "pm": [{"name":"...","description":"..."},{"name":"...","description":"..."},{"name":"...","description":"..."},{"name":"...","description":"..."}]
  },
  "affirmation": "first-person affirmation specific to this era"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      model:"claude-sonnet-4-20250514", max_tokens:1000,
      system, messages:[{role:"user",content:user}],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const raw  = data.content.find(b=>b.type==="text")?.text||"";
  const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
  parsed.era = ERAS[parsed.eraId] || fallbackEra(answers);
  return parsed;
}

function buildFallback(answers) {
  const era  = fallbackEra(answers);
  const hasProd = (answers.routine_products||[]).filter(p=>p!=="none").length > 0;
  return {
    eraId: era.id, era,
    skinAnalysis: "Based on your assessment, your skin is showing signs of stress and barrier disruption. The combination of your concerns and lifestyle factors points to a skin system that needs support and simplification before active treatment.",
    keyInsights: [
      "Your skin's current reactivity suggests a compromised barrier — this is the first thing to address",
      "Lifestyle factors are directly amplifying your skin concerns and need to be managed alongside your routine",
      hasProd ? "Some of your current products may be working against your skin right now — the audit will flag these" : "Starting with a clean, minimal routine will reset your skin baseline effectively",
    ],
    productAudit: {
      keep:    hasProd ? [{product:"Moisturizer", reason:"Hydration is always appropriate — keep this as your anchor product"}] : [],
      remove:  hasProd ? [{product:"Active treatments (retinol, acids)", reason:"Too aggressive for a stressed barrier — pause these until skin stabilizes"}] : [],
      replace: hasProd ? [{from:"Current cleanser", to:"pH-balanced gentle cleanser (e.g. La Roche-Posay Toleriane)", reason:"Harsh cleansers strip the barrier daily, undoing all other work"}] : [],
      add: [
        {product:"Ceramide serum or moisturizer", reason:"The single most important product for barrier repair", priority:"essential"},
        {product:"Mineral SPF 30+", reason:"UV damage is the #1 barrier aggressor — non-negotiable daily", priority:"essential"},
        {product:"Centella asiatica essence", reason:"Powerfully anti-inflammatory, speeds barrier recovery", priority:"recommended"},
      ],
    },
    routine: {
      am:[
        {name:"Cool water rinse",        description:"Skip cleanser in AM — let your skin keep its overnight oils"},
        {name:"Alcohol-free toner",      description:"Pat gently into damp skin with fingertips, don't wipe"},
        {name:"Ceramide serum",          description:"2-3 drops while skin is still slightly damp for best absorption"},
        {name:"Barrier moisturizer",     description:"Apply generously — don't be afraid of richness in the morning"},
        {name:"Mineral SPF 30+",         description:"Finish every morning without fail. UV undoes all healing work"},
      ],
      pm:[
        {name:"Oil cleanse",             description:"Massage gently to dissolve SPF and daily buildup — no friction"},
        {name:"pH-balanced gel cleanser",description:"Rinse with lukewarm water. Hot water strips the barrier"},
        {name:"Centella or oat essence", description:"Anti-inflammatory calm — this is your skin's reset moment"},
        {name:"Barrier repair cream",    description:"Apply generously. Overnight is when skin rebuilds most actively"},
      ],
    },
    affirmation: era.affirmation,
  };
}

// ─── LOCATION + PRODUCT HELPERS ──────────────────────────────────────────────
async function detectLocation() {
  try {
    const r = await fetch("https://ipapi.co/json/");
    const d = await r.json();
    return { country: d.country_name||"United States", code: d.country_code||"US", city: d.city||"", currency: d.currency||"USD" };
  } catch {
    return { country:"United States", code:"US", city:"", currency:"USD" };
  }
}

async function fetchProductRecsOld(addItems, replaceItems, location) {
  const needs = [
    ...addItems.map((i,idx) => ({ key:`add_${idx}`, type:"add", desc:i.product, priority:i.priority||"recommended" })),
    ...replaceItems.map((i,idx) => ({ key:`replace_${idx}`, type:"replace", desc:`Replace "${i.from}" with: ${i.to}` })),
  ];
  if (!needs.length) return {};

  const list = needs.map(n=>`[${n.key}] [${n.type.toUpperCase()}] ${n.desc}`).join("\n");
  const loc = `${location.city ? location.city+", " : ""}${location.country}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      model:"claude-sonnet-4-20250514",
      max_tokens:1000,
      tools:[{ type:"web_search_20250305", name:"web_search" }],
      system:`You are a professional skincare product buyer and cosmetologist specialising in the ${location.country} market. Search for real, purchasable skincare products available in ${location.country} for each need listed. Return ONLY valid JSON, no markdown fences, no extra text.`,
      messages:[{ role:"user", content:`User is in ${loc}. Find 1-2 specific purchasable professional skincare products for each of these needs. Use web search to find real product pages with current availability in ${location.country}:

${list}

Return ONLY this JSON (no markdown):
{
  "location": "${loc}",
  "recs": {
    "add_0": [{ "brand":"", "brandDomain":"brand.com", "name":"", "price":"with local currency symbol", "url":"real product page URL", "retailer":"" }],
    "replace_0": [...]
  }
}` }],
    }),
  });

  const data = await res.json();
  const raw = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  const clean = raw.replace(/```json|```/g,"").trim();
  const parsed = JSON.parse(clean);
  return parsed.recs || {};
}

// Product card component
function ProductCardOld({ product, color }) {
  const [logoErr, setLogoErr] = useState(false);
  const initial = (product.brand||"?")[0].toUpperCase();
  return (
    <a href={product.url} target="_blank" rel="noopener noreferrer" style={{
      display:"flex", alignItems:"center", gap:11,
      background:C.card, borderRadius:11, padding:"11px 13px",
      border:`1px solid ${color}25`, textDecoration:"none",
      transition:"border-color 0.15s",
    }}>
      {/* Brand logo / fallback */}
      <div style={{ width:40, height:40, borderRadius:9, flexShrink:0, background:"#F8F8F8", border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
        {!logoErr ? (
          <img src={`https://logo.clearbit.com/${product.brandDomain}`} alt={product.brand}
            style={{ width:"100%", height:"100%", objectFit:"contain" }}
            onError={()=>setLogoErr(true)} />
        ) : (
          <span style={{ fontSize:17, fontWeight:700, color }}>{initial}</span>
        )}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:10, color:C.muted, marginBottom:1 }}>{product.brand}</p>
        <p style={{ fontSize:13, color:C.text, fontWeight:500, lineHeight:1.35 }}>{product.name}</p>
        <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:2 }}>
          {product.price&&<span style={{ fontSize:11, color, fontWeight:600 }}>{product.price}</span>}
          {product.price&&product.retailer&&<span style={{ fontSize:10, color:C.muted }}>·</span>}
          {product.retailer&&<span style={{ fontSize:11, color:C.muted }}>{product.retailer}</span>}
        </div>
      </div>
      <span style={{ fontSize:12, color, flexShrink:0, fontWeight:500 }}>Shop →</span>
    </a>
  );
}

// ─── QUIZ DATA ────────────────────────────────────────────────────────────────
const SKIN_TONES = [
  {value:"I",   label:"Porcelain Glow",   sub:"Very fair, burns easily",   swatch:"#FDE8D8"},
  {value:"II",  label:"Fair & Sensitive", sub:"Fair, usually burns",        swatch:"#F5C9A0"},
  {value:"III", label:"Warm Beige",        sub:"Medium, sometimes burns",   swatch:"#D4956A"},
  {value:"IV",  label:"Golden Olive",      sub:"Olive toned, tans easily",  swatch:"#B07040"},
  {value:"V",   label:"Rich Bronze",       sub:"Brown, rarely burns",       swatch:"#7B4A20"},
  {value:"VI",  label:"Deep Ebony",        sub:"Dark brown/black",          swatch:"#3D1F0A"},
];
const QUESTIONS = [
  {id:"gender",          type:"single",   emoji:"👋", section:"The Vibe Check",           question:"How do you identify?",                                     options:[{value:"she",label:"She / Her"},{value:"he",label:"He / Him"}]},
  {id:"age",             type:"single",   emoji:"⏳",                                      question:"What era are you in?",                                     options:[{value:"18-24",label:"18–24",sub:"main character energy era"},{value:"25-34",label:"25–34",sub:"glow up era"},{value:"35-44",label:"35–44",sub:"skin wisdom era"},{value:"45+",label:"45+",sub:"timeless queen era"}]},
  {id:"tone",            type:"tone",     emoji:"🌈",                                      question:"Let's find your skin tone",         hint:"Every skin tone has its own glow story"},
  {id:"concerns",        type:"multi",    emoji:"🔍", section:"Your Skin's Current Mood",  question:"What's your skin going through rn?",hint:"Select all that feel true",options:[{value:"acne",label:"🔥 Breakout era",sub:"acne"},{value:"wrinkles",label:"🌙 Fine lines",sub:"aging"},{value:"pigmentation",label:"🎭 Dark spots",sub:"uneven tone"},{value:"sensitive",label:"🧊 Sensitive & reactive"},{value:"dryness",label:"🏜️ Thirsty skin"},{value:"pores",label:"🔍 Pores doing too much"}]},
  {id:"routine_products",type:"multi",    emoji:"🧴",                                      question:"What's in your current rotation?", hint:"No judgment — tap all you use",          options:[{value:"cleanser",label:"🧴 Cleanser"},{value:"moisturizer",label:"💧 Moisturizer"},{value:"serum",label:"✨ Serum"},{value:"treatments",label:"🎯 Treatments"},{value:"spf",label:"☀️ Sunscreen"},{value:"none",label:"🚫 Honestly? Not much rn"}]},
  {id:"smoke",           type:"single",   emoji:"💨", section:"The Real Talk",sectionSub:"A few health questions so we can keep you safe 💗", question:"Do you smoke?",                 options:[{value:"no",label:"No"},{value:"sometimes",label:"Sometimes"},{value:"yes",label:"Yes"}]},
  {id:"diabetes",        type:"single",   emoji:"🩺",                                      question:"Do you have diabetes?",                                    options:[{value:"no",label:"No"},{value:"yes",label:"Yes"},{value:"unsure",label:"Not sure"}]},
  {id:"allergies",       type:"multi",    emoji:"⚠️",                                      question:"Any known allergies or sensitivities?", hint:"Select all that apply — we'll never recommend these", options:[{value:"cosmetics",label:"Cosmetics / skincare"},{value:"iodine",label:"Iodine"},{value:"foods",label:"Certain foods"},{value:"fragrance",label:"Fragrances"},{value:"sunscreen",label:"Sunscreens"},{value:"meds",label:"Medications"},{value:"animals",label:"Animals"},{value:"none",label:"None I know of"}]},
  {id:"pregnant",        type:"single",   emoji:"🤍",                                      question:"Pregnant or trying to conceive?",   hint:"Some ingredients aren't pregnancy-safe — we want to look out for you", options:[{value:"no",label:"No"},{value:"yes",label:"Yes"},{value:"skip",label:"Prefer not to say"}]},
  {id:"photos",          type:"photos",   emoji:"📸", section:"Show Us Your Skin",         question:"Time for your skin selfies",        hint:"No filters, just you. Good lighting is your bestie here."},
  {id:"goals",           type:"textarea", emoji:"💭", section:"Your Skin Goals",            question:"Tell us your dream skin era",       placeholder:"I want to finally understand why my skin does what it does..."},
];
const TOTAL = QUESTIONS.length;
const MOODS = [{emoji:"✨",label:"Glowing"},{emoji:"🌿",label:"Calm"},{emoji:"😴",label:"Tired"},{emoji:"🔥",label:"Reactive"},{emoji:"🧊",label:"Breaking out"}];

// ─── SHARED UI ────────────────────────────────────────────────────────────────
function Btn({ children, onClick, disabled, bg }) {
  return <button onClick={onClick} disabled={disabled} style={{ width:"100%", padding:"15px 0", borderRadius:13, border:"none", background:disabled?"#D4CBC4":(bg||"#2C2C2C"), color:"#FAF8F5", fontSize:15, fontWeight:500, letterSpacing:0.4, cursor:disabled?"not-allowed":"pointer", fontFamily:"inherit", transition:"all 0.2s" }}>{children}</button>;
}

// ─── QUIZ SCREEN ──────────────────────────────────────────────────────────────
function QuizScreen({ onComplete }) {
  const [idx, setIdx]           = useState(0);
  const [answers, setAnswers]   = useState({});
  const [sel, setSel]           = useState(null);
  const [multi, setMulti]       = useState([]);
  const [anim, setAnim]         = useState(true);
  const q      = QUESTIONS[idx];
  const isLast = idx === TOTAL - 1;

  useEffect(() => {
    if (q.type==="multi") setMulti(answers[q.id]||[]);
    else setSel(answers[q.id]||null);
  }, [idx]);

  const canNext = q.type==="multi" ? multi.length>0 : (q.type==="photos"||q.type==="textarea") ? true : !!sel;

  function next() {
    const a = {...answers};
    if (q.type==="multi") a[q.id]=multi;
    else if (q.type!=="photos"&&q.type!=="textarea") a[q.id]=sel;
    setAnswers(a);
    if (isLast) { onComplete(a); return; }
    setAnim(false);
    setTimeout(()=>{ setIdx(i=>i+1); setAnim(true); },150);
  }
  const toggleMulti = v => setMulti(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v]);
  const addPhoto    = k => setAnswers(a=>({...a,[k]:"uploaded"}));

  return (
    <div style={{height:"100%",background:C.bg,display:"flex",flexDirection:"column"}}>
      <div style={{padding:"18px 24px 10px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <span style={{fontFamily:"Georgia,serif",fontSize:20,color:C.text,letterSpacing:2}}>Get Pretty</span>
        <span style={{fontSize:11,color:C.muted}}>{idx+1} / {TOTAL}</span>
      </div>
      <div style={{height:2,background:C.border,margin:"0 24px",flexShrink:0}}>
        <div style={{height:2,width:`${(idx/TOTAL)*100}%`,background:C.accent,borderRadius:1,transition:"width 0.4s ease"}}/>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"28px 24px 24px",opacity:anim?1:0,transition:"opacity 0.15s"}}>
        {q.section && <div style={{marginBottom:18}}><p style={{fontSize:10,color:C.muted,letterSpacing:2.5,textTransform:"uppercase",marginBottom:q.sectionSub?2:0}}>{q.section}</p>{q.sectionSub&&<p style={{fontSize:12,color:C.muted,fontStyle:"italic"}}>{q.sectionSub}</p>}</div>}
        <div style={{fontSize:38,marginBottom:14}}>{q.emoji}</div>
        <h2 style={{fontFamily:"Georgia,serif",fontSize:22,color:C.text,lineHeight:1.45,marginBottom:q.hint?4:22,fontWeight:400}}>{q.question}</h2>
        {q.hint&&<p style={{fontSize:12,color:C.muted,fontStyle:"italic",marginBottom:20,lineHeight:1.6}}>{q.hint}</p>}

        {q.type==="single"&&(
          <><div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
            {q.options.map(o=>(
              <button key={o.value} onClick={()=>setSel(o.value)} style={{background:sel===o.value?C.accentLight:C.card,border:`1.5px solid ${sel===o.value?C.accent:C.border}`,borderRadius:13,padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all 0.15s"}}>
                <span><span style={{fontSize:15,color:sel===o.value?C.accent:"#4A4039",fontWeight:sel===o.value?500:400,display:"block"}}>{o.label}</span>{o.sub&&<span style={{fontSize:11,color:C.muted}}>{o.sub}</span>}</span>
                {sel===o.value&&<span style={{color:C.accent,fontWeight:700}}>✓</span>}
              </button>
            ))}
          </div><Btn onClick={next} disabled={!sel}>{isLast?"Create My Profile →":"Continue →"}</Btn><p style={{textAlign:"center",fontSize:11,color:C.muted,marginTop:16,fontStyle:"italic"}}>No wrong answers. Your skin has no judgment.</p></>
        )}

        {q.type==="tone"&&(
          <><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24}}>
            {SKIN_TONES.map(t=>(
              <button key={t.value} onClick={()=>setSel(t.value)} style={{borderRadius:13,padding:"14px 12px",fontFamily:"inherit",cursor:"pointer",border:`2px solid ${sel===t.value?C.accent:C.border}`,background:sel===t.value?C.accentLight:C.card,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:8,transition:"all 0.15s",textAlign:"left"}}>
                <div style={{width:32,height:32,borderRadius:"50%",background:t.swatch,border:"2px solid rgba(0,0,0,0.08)",flexShrink:0}}/>
                <div><p style={{fontSize:13,color:sel===t.value?C.accent:C.text,fontWeight:sel===t.value?500:400,marginBottom:1}}>{t.label}</p><p style={{fontSize:10,color:C.muted,lineHeight:1.4}}>{t.sub}</p></div>
              </button>
            ))}
          </div><Btn onClick={next} disabled={!sel}>Continue →</Btn></>
        )}

        {q.type==="multi"&&(
          <><div style={{display:"flex",flexWrap:"wrap",gap:9,marginBottom:24}}>
            {q.options.map(o=>{const a=multi.includes(o.value);return(
              <button key={o.value} onClick={()=>toggleMulti(o.value)} style={{padding:"10px 16px",borderRadius:22,fontFamily:"inherit",cursor:"pointer",background:a?C.accent:C.card,border:`1.5px solid ${a?C.accent:C.border}`,color:a?"#FFF":"#4A4039",fontSize:13,fontWeight:a?500:400,transition:"all 0.15s"}}>
                {o.label}{o.sub&&<span style={{display:"block",fontSize:10,opacity:0.75}}>{o.sub}</span>}
              </button>
            );})}
          </div><Btn onClick={next} disabled={multi.length===0}>Continue →</Btn></>
        )}

        {q.type==="photos"&&(
          <><div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:24}}>
            {[{label:"Right side of face",hint:"Turn your right cheek toward the light",k:"photo_right"},{label:"Left side of face",hint:"Turn your left cheek toward the light",k:"photo_left"},{label:"Straight on",hint:"Face forward, chin slightly down",k:"photo_front"}].map(p=>{
              const done=!!answers[p.k];
              return(
                <div key={p.k} style={{borderRadius:13,overflow:"hidden",border:`1.5px solid ${done?"#7A9E6E":C.border}`,background:done?"#F2F6EF":C.card,transition:"all 0.15s"}}>
                  <div style={{padding:"12px 16px 8px",display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:36,height:36,borderRadius:8,flexShrink:0,background:done?"#7A9E6E25":"#F0EBE5",border:`1.5px dashed ${done?"#7A9E6E":C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,color:done?"#7A9E6E":C.muted}}>{done?"✓":"🤳"}</div>
                    <div><p style={{fontSize:14,color:done?"#7A9E6E":C.text,fontWeight:500,marginBottom:1}}>{p.label}</p><p style={{fontSize:11,color:C.muted}}>{done?"Photo added ✓":p.hint}</p></div>
                  </div>
                  {!done?(
                    <div style={{display:"flex",borderTop:`1px solid ${C.border}`}}>
                      <button onClick={()=>addPhoto(p.k)} style={{flex:1,padding:"10px 0",background:"none",border:"none",borderRight:`1px solid ${C.border}`,cursor:"pointer",fontSize:12,color:C.accent,fontFamily:"inherit",fontWeight:500}}>📷 Take photo</button>
                      <button onClick={()=>addPhoto(p.k)} style={{flex:1,padding:"10px 0",background:"none",border:"none",cursor:"pointer",fontSize:12,color:C.accent,fontFamily:"inherit",fontWeight:500}}>🖼 Upload photo</button>
                    </div>
                  ):(
                    <div style={{borderTop:"1px solid #7A9E6E30"}}><button onClick={()=>setAnswers(a=>{const n={...a};delete n[p.k];return n;})} style={{width:"100%",padding:"8px 0",background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.muted,fontFamily:"inherit"}}>Remove & retake</button></div>
                  )}
                </div>
              );
            })}
          </div>
          <Btn onClick={next} bg={C.accent}>{Object.keys(answers).some(k=>k.startsWith("photo_"))?"Continue →":"Skip for now →"}</Btn>
          <p style={{textAlign:"center",fontSize:11,color:C.muted,marginTop:14,fontStyle:"italic"}}>We see skin texture, not judgment</p></>
        )}

        {q.type==="textarea"&&(
          <>
            <textarea value={answers[q.id]||""} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))} placeholder={q.placeholder} rows={4} style={{width:"100%",padding:"14px 16px",borderRadius:13,boxSizing:"border-box",border:`1.5px solid ${C.border}`,background:C.card,fontSize:14,color:C.text,fontFamily:"Georgia,serif",resize:"none",lineHeight:1.65,outline:"none",marginBottom:16}}/>
            <div style={{marginBottom:6}}>
              <p style={{fontSize:12,color:C.muted,marginBottom:3}}>Drop pics of your shelf <span style={{fontStyle:"italic"}}>· optional, up to 5</span></p>
              <p style={{fontSize:11,color:C.muted,marginBottom:12,fontStyle:"italic"}}>We're curious, not judgy</p>
            </div>
            {(()=>{
              const shelf=answers.shelf_photos||[];
              return(
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:20}}>
                  {Array.from({length:5}).map((_,i)=>{
                    const filled=i<shelf.length, isNext=i===shelf.length&&shelf.length<5;
                    if(filled) return <div key={i} style={{aspectRatio:"1",borderRadius:12,background:"#7A9E6E20",border:"1.5px solid #7A9E6E50",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,position:"relative"}}><span style={{fontSize:22}}>🧴</span><span style={{fontSize:10,color:"#7A9E6E"}}>Added</span><button onClick={()=>setAnswers(a=>({...a,shelf_photos:(a.shelf_photos||[]).filter((_,j)=>j!==i)}))} style={{position:"absolute",top:4,right:6,background:"none",border:"none",cursor:"pointer",fontSize:13,color:C.muted}}>✕</button></div>;
                    if(isNext) return <div key={i} style={{aspectRatio:"1",borderRadius:12,border:`1.5px dashed ${C.border}`,background:C.card,display:"flex",flexDirection:"column",overflow:"hidden"}}><button onClick={()=>setAnswers(a=>({...a,shelf_photos:[...(a.shelf_photos||[]),"take"]}))} style={{flex:1,background:"none",border:"none",borderBottom:`1px solid ${C.border}`,cursor:"pointer",fontSize:11,color:C.accent,fontFamily:"inherit"}}>📷 Take</button><button onClick={()=>setAnswers(a=>({...a,shelf_photos:[...(a.shelf_photos||[]),"upload"]}))} style={{flex:1,background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.accent,fontFamily:"inherit"}}>🖼 Upload</button></div>;
                    return <div key={i} style={{aspectRatio:"1",borderRadius:12,border:`1.5px dashed ${C.border}`,background:"#F9F7F4",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:18,opacity:0.2}}>+</span></div>;
                  })}
                </div>
              );
            })()}
            <Btn onClick={next} bg={C.accent}>Create My Skin Profile →</Btn>
          </>
        )}
      </div>
    </div>
  );
}

// ─── LOADING / ANALYSIS SCREEN ────────────────────────────────────────────────
function LoadingScreen({ answers, onDone }) {
  const [step, setStep]   = useState(0);
  const [complete, setComplete] = useState(false);
  const called            = useRef(false);

  const steps = [
    {label:"Reading your skin signals...",          icon:"🔍"},
    {label:"Analysing your uploaded photos...",      icon:"📸"},
    {label:"Auditing your current products...",     icon:"🧴"},
    {label:"Building your personalized routine...", icon:"✨"},
    {label:"Finalizing your Skin Era profile...",   icon:"🌿"},
  ];

  useEffect(()=>{
    if (called.current) return;
    called.current = true;
    steps.forEach((_,i)=>setTimeout(()=>setStep(i), i*900));
    const minWait = steps.length*900 + 500;

    analyzeWithAI(answers)
      .then(result=>{
        setTimeout(()=>{ setComplete(true); setTimeout(()=>onDone(result),700); }, minWait);
      })
      .catch(err=>{
        console.warn("AI fallback:", err.message);
        const fb = buildFallback(answers);
        setTimeout(()=>{ setComplete(true); setTimeout(()=>onDone(fb),700); }, minWait);
      });
  },[]);

  return (
    <div style={{height:"100%",background:"#FAF3EF",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 28px",textAlign:"center"}}>
      <div style={{fontSize:52,marginBottom:18}}>🌿</div>
      <h2 style={{fontFamily:"Georgia,serif",fontSize:21,color:C.text,marginBottom:8,fontWeight:400}}>Analysing your skin story</h2>
      <p style={{fontSize:13,color:C.muted,marginBottom:30,lineHeight:1.6,fontStyle:"italic"}}>Our cosmetology engine is reading every signal you shared</p>
      <div style={{display:"flex",flexDirection:"column",gap:9,width:"100%",marginBottom:28}}>
        {steps.map((s,i)=>{
          const isActive=i===step&&!complete, isDone=i<step||complete;
          return(
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 16px",borderRadius:12,background:isDone||isActive?C.card:"transparent",border:`1px solid ${isDone||isActive?C.border:"transparent"}`,transition:"all 0.4s"}}>
              <div style={{width:26,height:26,borderRadius:"50%",flexShrink:0,background:isDone?"#7A9E6E":isActive?C.accent:"#E8E0D8",display:"flex",alignItems:"center",justifyContent:"center",fontSize:isDone?10:13,color:"#FFF",fontWeight:700,transition:"all 0.4s"}}>
                {isDone?"✓":isActive?s.icon:""}
              </div>
              <span style={{fontSize:13,color:isDone||isActive?C.text:C.muted,textAlign:"left",flex:1,transition:"color 0.4s"}}>{s.label}</span>
              {isActive&&<span style={{fontSize:10,color:C.accent,fontStyle:"italic"}}>in progress</span>}
            </div>
          );
        })}
      </div>
      {complete&&(
        <div style={{background:"#7A9E6E15",border:"1.5px solid #7A9E6E40",borderRadius:14,padding:"13px 20px"}}>
          <p style={{fontSize:13,color:"#7A9E6E",fontWeight:500}}>✓ Analysis complete — revealing your Skin Era</p>
        </div>
      )}
    </div>
  );
}

// ─── PRODUCT RECOMMENDATION ENGINE ───────────────────────────────────────────
const CATEGORY_IMAGES = {
  cleanser:    "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=120&h=120&fit=crop&crop=center",
  moisturizer: "https://images.unsplash.com/photo-1570194065650-d99fb4bedf0a?w=120&h=120&fit=crop&crop=center",
  serum:       "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=120&h=120&fit=crop&crop=center",
  spf:         "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=120&h=120&fit=crop&crop=center",
  toner:       "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=120&h=120&fit=crop&crop=center",
  oil:         "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=120&h=120&fit=crop&crop=center",
  mask:        "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=120&h=120&fit=crop&crop=center",
  eye_cream:   "https://images.unsplash.com/photo-1567721913486-6585f069b3cb?w=120&h=120&fit=crop&crop=center",
  treatment:   "https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?w=120&h=120&fit=crop&crop=center",
};
const DEFAULT_IMG = "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=120&h=120&fit=crop&crop=center";

async function detectCountry() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve("Israel"); return; }
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lon } }) => {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
          const d = await r.json();
          resolve(d.address?.country || "Israel");
        } catch { resolve("Israel"); }
      },
      () => resolve("Israel"),
      { timeout: 6000 }
    );
  });
}

async function fetchProductRecs(productAudit, country, eraName) {
  const replaceItems = productAudit.replace || [];
  const addItems     = productAudit.add     || [];
  if (!replaceItems.length && !addItems.length) return { replace:[], add:[] };

  const system = `You are a professional skincare product specialist with deep knowledge of products available in global retail markets.

Always recommend reputable professional brands: La Roche-Posay, CeraVe, Paula's Choice, The Ordinary, Cetaphil, Vichy, Bioderma, COSRX, Avene, SkinCeuticals, Neutrogena, First Aid Beauty, Drunk Elephant, Medik8, etc.

For the specified country, provide realistic local pricing and correct local retailers:
- Israel: Super-Pharm, iHerb, Castro Beauty, Sephora IL, Hadassah
- US: Sephora, Ulta, Amazon, Dermstore
- UK: Boots, Lookfantastic, Cult Beauty, Space NK
- Australia: Priceline, MECCA, Chemist Warehouse
- EU/France: Marionnaud, Douglas, Sephora FR, FNAC
- Germany: dm, Rossmann, Douglas
- Default: iHerb (ships globally)

Return ONLY valid JSON, no other text.`;

  const user = `Country: ${country}
Skin Era: ${eraName}

Recommend ONE specific purchasable product for each skincare need below.

REPLACE (recommend the "to" product exactly):
${JSON.stringify(replaceItems.map((r,i)=>({index:i,need:r.to,reason:r.reason})))}

ADD (recommend a specific product per need):
${JSON.stringify(addItems.map((a,i)=>({index:i,need:a.product,priority:a.priority,reason:a.reason})))}

Return this exact JSON:
{
  "replace":[{"index":0,"rec":{"brand":"La Roche-Posay","name":"Toleriane Hydrating Gentle Cleanser","price":"₪89","retailer":"Super-Pharm","url":"https://www.super-pharm.co.il/","category":"cleanser"}}],
  "add":[{"index":0,"rec":{"brand":"CeraVe","name":"Moisturizing Cream","price":"₪115","retailer":"Super-Pharm","url":"https://www.super-pharm.co.il/","category":"moisturizer"}}]
}
Category must be one of: cleanser|moisturizer|serum|spf|toner|oil|mask|eye_cream|treatment`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system, messages:[{role:"user",content:user}] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const raw  = data.content.find(b=>b.type==="text")?.text||"";
  return JSON.parse(raw.replace(/```json|```/g,"").trim());
}

function ProductCard({ rec, color }) {
  const img = CATEGORY_IMAGES[rec.category] || DEFAULT_IMG;
  return (
    <a href={rec.url} target="_blank" rel="noopener noreferrer" style={{
      display:"flex", alignItems:"center", gap:12, padding:"11px 13px",
      background:"#FAFAFA", borderRadius:12, border:`1.5px solid ${color}30`,
      textDecoration:"none", marginTop:10,
    }}>
      <div style={{ width:52, height:52, borderRadius:10, overflow:"hidden", flexShrink:0, border:`1px solid ${C.border}`, background:C.bg }}>
        <img src={img} alt={rec.name} style={{ width:"100%", height:"100%", objectFit:"cover" }}
          onError={e => { e.target.style.display="none"; }} />
      </div>
      <div style={{flex:1,minWidth:0}}>
        <p style={{fontSize:10,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:1}}>{rec.brand}</p>
        <p style={{fontSize:13,color:C.text,fontWeight:500,lineHeight:1.35,marginBottom:4}}>{rec.name}</p>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:12,color:color,fontWeight:600}}>{rec.price}</span>
          <span style={{fontSize:10,color:C.muted}}>at {rec.retailer}</span>
        </div>
      </div>
      <div style={{flexShrink:0,padding:"7px 11px",borderRadius:8,background:color,color:"#FFF",fontSize:11,fontWeight:600}}>Shop →</div>
    </a>
  );
}

// ─── PROFILE SCREEN ───────────────────────────────────────────────────────────
function ProfileScreen({ analysis, onContinue }) {
  const era   = analysis.era;
  const audit = analysis.productAudit || {};
  const replaceItems = audit.replace || [];
  const addItems     = audit.add     || [];

  const auditTabs = [
    {key:"remove",  label:"🚫 Remove",  color:"#C44B4B", items:audit.remove||[]},
    {key:"replace", label:"🔄 Replace", color:"#B8924A", items:replaceItems},
    {key:"add",     label:"➕ Add",     color:"#7A9E6E", items:addItems},
    {key:"keep",    label:"✅ Keep",    color:"#6A98B0", items:audit.keep||[]},
  ].filter(t=>t.items.length>0);

  const [auditTab,    setAuditTab]    = useState(auditTabs[0]?.key||"add");
  const [productRecs, setProductRecs] = useState(null);
  const [country,     setCountry]     = useState(null);
  const [loadingRecs, setLoadingRecs] = useState(false);

  useEffect(()=>{
    if (!addItems.length && !replaceItems.length) return;
    setLoadingRecs(true);
    (async()=>{
      try {
        const c   = await detectCountry();
        setCountry(c);
        const recs = await fetchProductRecs(audit, c, era.name);
        setProductRecs(recs);
      } catch(e) { console.warn("Product recs:", e.message); }
      setLoadingRecs(false);
    })();
  },[]);

  // Skeleton loader
  function ProductSkeleton() {
    return (
      <div style={{marginTop:8,padding:"11px 13px",borderRadius:12,background:C.bg,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:11}}>
        <div style={{width:52,height:52,borderRadius:10,background:C.border,flexShrink:0}}/>
        <div style={{flex:1}}>
          <div style={{height:8,background:C.border,borderRadius:4,marginBottom:6,width:"40%"}}/>
          <div style={{height:11,background:C.border,borderRadius:4,marginBottom:5,width:"75%"}}/>
          <div style={{height:8,background:C.border,borderRadius:4,width:"50%"}}/>
        </div>
        <div style={{width:52,height:30,borderRadius:8,background:C.border,flexShrink:0}}/>
      </div>
    );
  }

  // Get product rec for a given tab + item index
  function getRecForItem(tabKey, itemIndex) {
    if (!productRecs) return null;
    return (productRecs[tabKey] || []).find(r => r.index === itemIndex)?.rec || null;
  }

  return (
    <div style={{height:"100%",background:era.bg,overflowY:"auto"}}>
      <div style={{padding:"28px 24px 48px"}}>

        {/* Era */}
        <div style={{textAlign:"center",marginBottom:22}}>
          <div style={{fontSize:54,marginBottom:14}}>{era.emoji}</div>
          <p style={{fontSize:10,color:C.muted,letterSpacing:2.5,textTransform:"uppercase",marginBottom:6}}>Your skin is in</p>
          <h1 style={{fontFamily:"Georgia,serif",fontSize:24,color:era.color,lineHeight:1.3,fontWeight:400}}>{era.name}</h1>
          <p style={{fontFamily:"Georgia,serif",fontSize:14,color:"#6B5E57",fontStyle:"italic",marginTop:8,lineHeight:1.6}}>"{era.tagline}"</p>
        </div>
        <div style={{height:1,background:era.color+"30",marginBottom:20}}/>

        {/* AI Skin Analysis */}
        <div style={{background:C.card,borderRadius:14,padding:"16px 18px",marginBottom:16,border:`1px solid ${C.border}`}}>
          <p style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>🔬 Skin Analysis</p>
          <p style={{fontSize:14,color:"#4A4039",lineHeight:1.78}}>{analysis.skinAnalysis}</p>
        </div>

        {/* Key Insights */}
        <div style={{marginBottom:18}}>
          <p style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>💡 Key Insights</p>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {(analysis.keyInsights||[]).map((ins,i)=>(
              <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{width:20,height:20,borderRadius:"50%",background:era.color+"20",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",marginTop:2}}>
                  <span style={{fontSize:10,color:era.color,fontWeight:700}}>{i+1}</span>
                </div>
                <p style={{fontSize:13,color:"#4A4039",lineHeight:1.68,flex:1}}>{ins}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Product Audit */}
        {auditTabs.length>0&&(
          <div style={{marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <p style={{fontSize:10,color:C.muted,letterSpacing:2,textTransform:"uppercase"}}>🧴 Product Audit</p>
              {country&&(
                <div style={{display:"flex",alignItems:"center",gap:5,background:era.color+"15",borderRadius:10,padding:"3px 9px"}}>
                  <span style={{fontSize:11}}>📍</span>
                  <span style={{fontSize:11,color:era.color,fontWeight:500}}>{country}</span>
                </div>
              )}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
              {auditTabs.map(t=>(
                <button key={t.key} onClick={()=>setAuditTab(t.key)} style={{padding:"5px 11px",borderRadius:18,border:`1.5px solid ${auditTab===t.key?t.color:C.border}`,background:auditTab===t.key?t.color+"18":C.card,color:auditTab===t.key?t.color:C.muted,fontSize:11,fontWeight:auditTab===t.key?600:400,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}}>
                  {t.label} <span style={{opacity:0.65}}>({t.items.length})</span>
                </button>
              ))}
            </div>
            {auditTabs.filter(t=>t.key===auditTab).map(t=>(
              <div key={t.key} style={{display:"flex",flexDirection:"column",gap:12}}>
                {t.items.map((item,i)=>{
                  const rec = (t.key==="replace"||t.key==="add") ? getRecForItem(t.key,i) : null;
                  return (
                    <div key={i}>
                      <div style={{background:C.card,borderRadius:12,padding:"12px 15px",border:`1px solid ${t.color}22`}}>
                        {t.key==="replace"?(
                          <>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5,flexWrap:"wrap"}}>
                              <span style={{fontSize:12,color:"#C44B4B",fontWeight:500,textDecoration:"line-through"}}>{item.from}</span>
                              <span style={{fontSize:11,color:C.muted}}>→</span>
                              <span style={{fontSize:12,color:"#7A9E6E",fontWeight:500}}>{item.to}</span>
                            </div>
                            <p style={{fontSize:12,color:C.muted,lineHeight:1.55}}>{item.reason}</p>
                          </>
                        ) : t.key==="add" ? (
                          <>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                              <p style={{fontSize:13,color:C.text,fontWeight:500,flex:1}}>{item.product}</p>
                              {item.priority&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:8,fontWeight:500,flexShrink:0,marginLeft:8,background:item.priority==="essential"?"#C44B4B18":"#B8924A15",color:item.priority==="essential"?"#C44B4B":"#B8924A"}}>{item.priority}</span>}
                            </div>
                            <p style={{fontSize:12,color:C.muted,lineHeight:1.55}}>{item.reason}</p>
                          </>
                        ) : (
                          <>
                            <p style={{fontSize:13,color:C.text,fontWeight:500,marginBottom:4}}>{item.product||item.from}</p>
                            <p style={{fontSize:12,color:C.muted,lineHeight:1.55}}>{item.reason}</p>
                          </>
                        )}
                      </div>
                      {/* Product card for Replace + Add */}
                      {(t.key==="replace"||t.key==="add") && (
                        rec
                          ? <ProductCard rec={rec} color={t.color}/>
                          : loadingRecs && <ProductSkeleton/>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Affirmation */}
        <div style={{border:`1.5px solid ${era.color}50`,borderRadius:16,padding:18,marginBottom:24,textAlign:"center"}}>
          <p style={{fontSize:10,color:C.muted,letterSpacing:2.5,marginBottom:8}}>YOUR AFFIRMATION</p>
          <p style={{fontFamily:"Georgia,serif",fontSize:15,color:era.color,lineHeight:1.65,fontStyle:"italic"}}>"{analysis.affirmation||era.affirmation}"</p>
        </div>

        <button onClick={onContinue} style={{width:"100%",padding:"15px 0",borderRadius:13,border:"none",background:era.color,color:"#FFF",fontSize:15,fontWeight:500,letterSpacing:0.4,cursor:"pointer",fontFamily:"inherit"}}>See My Routine →</button>
        <p style={{textAlign:"center",fontSize:11,color:C.muted,marginTop:14,fontStyle:"italic"}}>Your era updates as your skin evolves.</p>
      </div>
    </div>
  );
}

// ─── HOME SCREEN ──────────────────────────────────────────────────────────────
const DONE_MSGS = {
  barrier_healing:  "Your barrier thanks you. Every gentle step today builds the foundation for calm, resilient skin.",
  acne_reset:       "You showed up for your skin — that consistency is exactly what creates real, lasting change.",
  burnout_recovery: "Rest and ritual are medicine. You just gave your skin exactly what it needed.",
  glow_building:    "Radiance is built one intentional step at a time. You're doing the work.",
  repair_restore:   "Investing in your skin today is the most powerful anti-aging move you can make.",
};

function HomeScreen({ analysis, onSettings }) {
  const era     = analysis.era;
  const routine = analysis.routine || {am:[],pm:[]};
  const [tab, setTab]     = useState("am");
  const [done, setDone]   = useState({});
  const [ciOpen, setCiOpen] = useState(false);
  const [checkedIn, setCheckedIn] = useState(null);
  const [mood, setMood]   = useState(null);

  const steps     = tab==="am" ? routine.am : routine.pm;
  const doneCount = steps.filter((_,i)=>done[tab+i]).length;
  const allDone   = doneCount===steps.length && steps.length>0;
  const toggle    = i => setDone(p=>({...p,[tab+i]:!p[tab+i]}));
  const hour      = new Date().getHours();
  const greeting  = hour<12?"Good morning":hour<17?"Good afternoon":"Good evening";

  return (
    <div style={{height:"100%",background:era.bg,display:"flex",flexDirection:"column"}}>
      <div style={{flex:1,overflowY:"auto",padding:"22px 22px 28px"}}>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22}}>
          <div><p style={{fontSize:12,color:C.muted,marginBottom:4}}>{greeting}</p><p style={{fontFamily:"Georgia,serif",fontSize:17,color:era.color}}>{era.emoji} {era.name}</p></div>
          <button onClick={onSettings} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",padding:4}}>⚙️</button>
        </div>

        {!checkedIn?(
          <button onClick={()=>setCiOpen(true)} style={{width:"100%",background:C.card,border:`1.5px solid ${era.color}40`,borderRadius:14,padding:"16px 18px",display:"flex",alignItems:"center",gap:14,cursor:"pointer",marginBottom:22,textAlign:"left",fontFamily:"inherit"}}>
            <span style={{fontSize:22}}>🪞</span>
            <div style={{flex:1}}><p style={{fontSize:14,color:C.text,fontWeight:500,marginBottom:2}}>Daily skin check-in</p><p style={{fontSize:12,color:C.muted}}>How does your skin feel today?</p></div>
            <span style={{color:era.color,fontSize:16}}>→</span>
          </button>
        ):(
          <div style={{border:`1.5px solid ${era.color}40`,borderRadius:14,padding:14,textAlign:"center",marginBottom:22}}>
            <span style={{fontSize:13,color:C.muted}}>{MOODS.find(m=>m.label===checkedIn)?.emoji} Check-in complete · {checkedIn}</span>
          </div>
        )}

        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:12,color:C.muted}}>{doneCount}/{steps.length} steps complete</span>
          {allDone&&<span style={{fontSize:12,color:era.color,fontWeight:500}}>✓ Ritual complete</span>}
        </div>
        <div style={{height:3,background:C.border,borderRadius:2,marginBottom:10}}>
          <div style={{height:3,width:`${steps.length?(doneCount/steps.length)*100:0}%`,background:era.color,borderRadius:2,transition:"width 0.3s"}}/>
        </div>
        {/* Instruction line */}
        <p style={{fontSize:12,color:C.muted,fontStyle:"italic",marginBottom:18,textAlign:"center"}}>
          Check off each step once you've completed it
        </p>

        <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,marginBottom:20}}>
          {[{key:"am",label:"☀️ Morning"},{key:"pm",label:"🌙 Evening"}].map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)} style={{flex:1,padding:"10px 0",background:"none",border:"none",borderBottom:tab===t.key?`2px solid ${era.color}`:"2px solid transparent",color:tab===t.key?era.color:C.muted,fontSize:13,fontWeight:tab===t.key?600:400,cursor:"pointer",fontFamily:"inherit",marginBottom:-1}}>{t.label}</button>
          ))}
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
          {steps.map((s,i)=>(
            <button key={i} onClick={()=>toggle(i)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:13,padding:"15px 16px",display:"flex",alignItems:"flex-start",gap:13,cursor:"pointer",textAlign:"left",fontFamily:"inherit",opacity:done[tab+i]?0.5:1,transition:"opacity 0.2s"}}>
              <div style={{width:28,height:28,borderRadius:"50%",flexShrink:0,background:done[tab+i]?era.color:"#F0EBE5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:done[tab+i]?"#FFF":C.muted,transition:"all 0.3s"}}>{done[tab+i]?"✓":i+1}</div>
              <div><p style={{fontSize:14,color:C.text,fontWeight:500,marginBottom:2,textDecoration:done[tab+i]?"line-through":"none"}}>{s.name}</p><p style={{fontSize:12,color:C.muted,lineHeight:1.5}}>{s.description}</p></div>
            </button>
          ))}
        </div>

        {allDone&&(
          <div style={{background:era.color+"15",border:`1.5px solid ${era.color}40`,borderRadius:16,padding:"20px 18px",marginBottom:16,textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:10}}>🎉</div>
            <p style={{fontFamily:"Georgia,serif",fontSize:17,color:era.color,marginBottom:8,fontWeight:400}}>Well done!</p>
            <p style={{fontSize:13,color:"#6B5E57",lineHeight:1.7}}>{DONE_MSGS[era.id]}</p>
          </div>
        )}

        <div style={{border:`1px solid ${era.color}25`,borderRadius:13,padding:18,textAlign:"center"}}>
          <p style={{fontFamily:"Georgia,serif",fontSize:14,color:"#6B5E57",fontStyle:"italic",lineHeight:1.65}}>"{analysis.affirmation||era.affirmation}"</p>
        </div>
      </div>

      {ciOpen&&(
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"flex-end",zIndex:100,borderRadius:44}}>
          <div style={{background:C.bg,borderRadius:"24px 24px 44px 44px",width:"100%",padding:"24px 24px 32px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <span style={{fontFamily:"Georgia,serif",fontSize:19,color:C.text}}>Skin check-in</span>
              <button onClick={()=>setCiOpen(false)} style={{background:"none",border:"none",fontSize:18,color:C.muted,cursor:"pointer"}}>✕</button>
            </div>
            <p style={{fontFamily:"Georgia,serif",fontSize:17,color:C.text,marginBottom:18}}>How does your skin feel right now?</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:22}}>
              {MOODS.map(m=>(
                <button key={m.label} onClick={()=>setMood(m.label)} style={{border:`1.5px solid ${mood===m.label?era.color:C.border}`,background:mood===m.label?era.bg:C.card,borderRadius:12,padding:"10px 13px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:4,fontFamily:"inherit"}}>
                  <span style={{fontSize:20}}>{m.emoji}</span>
                  <span style={{fontSize:11,color:mood===m.label?era.color:"#6B5E57"}}>{m.label}</span>
                </button>
              ))}
            </div>
            <button onClick={()=>{setCheckedIn(mood);setCiOpen(false);setMood(null);}} disabled={!mood} style={{width:"100%",padding:"14px 0",borderRadius:13,border:"none",background:mood?era.color:"#D4CBC4",color:"#FFF",fontSize:15,fontWeight:500,cursor:mood?"pointer":"not-allowed",fontFamily:"inherit"}}>Save check-in</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
const DAYS = ["S","M","T","W","T","F","S"];
const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function TimePickerRow({ label, icon, enabled, time, days, onToggle, onTimeChange, onDayToggle, color }) {
  const [h, m] = time.split(":").map(Number);
  const display = h === 0 ? `12:${String(m).padStart(2,"0")} AM`
    : h < 12 ? `${h}:${String(m).padStart(2,"0")} AM`
    : h === 12 ? `12:${String(m).padStart(2,"0")} PM`
    : `${h-12}:${String(m).padStart(2,"0")} PM`;

  function nudge(dir) {
    const totalMins = h*60 + m + dir*15;
    const clamped   = ((totalMins % 1440) + 1440) % 1440;
    const nh = Math.floor(clamped/60), nm = clamped%60;
    onTimeChange(`${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}`);
  }

  return (
    <div style={{ background:C.card, borderRadius:16, overflow:"hidden", border:`1.5px solid ${enabled ? color+"50" : C.border}`, marginBottom:12, transition:"all 0.2s" }}>
      {/* Header row */}
      <div style={{ display:"flex", alignItems:"center", padding:"14px 16px", gap:12 }}>
        <span style={{ fontSize:20 }}>{icon}</span>
        <div style={{ flex:1 }}>
          <p style={{ fontSize:14, color:C.text, fontWeight:600, marginBottom:1 }}>{label}</p>
          <p style={{ fontSize:11, color: enabled ? color : C.muted }}>
            {enabled ? display : "Off"}
          </p>
        </div>
        {/* iOS toggle */}
        <div onClick={onToggle} style={{
          width:51, height:31, borderRadius:16, cursor:"pointer",
          background: enabled ? color : "#E5E5EA",
          position:"relative", transition:"background 0.25s", flexShrink:0,
        }}>
          <div style={{
            width:27, height:27, borderRadius:"50%", background:"#FFF",
            position:"absolute", top:2, left: enabled ? 22 : 2,
            transition:"left 0.25s",
            boxShadow:"0 2px 6px rgba(0,0,0,0.2)",
          }}/>
        </div>
      </div>

      {/* Expanded controls */}
      {enabled && (
        <>
          <div style={{ height:1, background:C.border }}/>
          {/* Time nudger */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:"16px 20px", gap:20 }}>
            <button onClick={()=>nudge(-1)} style={{ width:36, height:36, borderRadius:"50%", background:C.bg, border:`1.5px solid ${C.border}`, cursor:"pointer", fontSize:18, color:C.text, display:"flex", alignItems:"center", justifyContent:"center" }}>−</button>
            <div style={{ textAlign:"center" }}>
              <p style={{ fontFamily:"Georgia,serif", fontSize:28, color:color, fontWeight:400, letterSpacing:1 }}>{display}</p>
              <p style={{ fontSize:10, color:C.muted, marginTop:2 }}>tap − / + to adjust by 15 min</p>
            </div>
            <button onClick={()=>nudge(1)} style={{ width:36, height:36, borderRadius:"50%", background:C.bg, border:`1.5px solid ${C.border}`, cursor:"pointer", fontSize:18, color:C.text, display:"flex", alignItems:"center", justifyContent:"center" }}>+</button>
          </div>
          {/* Days */}
          <div style={{ height:1, background:C.border }}/>
          <div style={{ padding:"12px 16px" }}>
            <p style={{ fontSize:11, color:C.muted, marginBottom:10, letterSpacing:0.5 }}>REPEAT</p>
            <div style={{ display:"flex", gap:6, justifyContent:"space-between" }}>
              {DAYS.map((d,i)=>{
                const on = days.includes(i);
                return (
                  <button key={i} onClick={()=>onDayToggle(i)} style={{
                    width:34, height:34, borderRadius:"50%", border:"none", cursor:"pointer",
                    background: on ? color : C.bg,
                    color: on ? "#FFF" : C.muted,
                    fontSize:12, fontWeight: on ? 600 : 400,
                    fontFamily:"inherit", transition:"all 0.15s",
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>
                    {d}
                  </button>
                );
              })}
            </div>
            <p style={{ fontSize:11, color:C.muted, marginTop:8 }}>
              {days.length===7 ? "Every day" : days.length===0 ? "No days selected" : days.map(d=>DAY_LABELS[d]).join(", ")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsScreen({ era, onBack, onRetake }) {
  const [notifGranted, setNotifGranted] = useState(false);
  const [showPrompt,   setShowPrompt]   = useState(false);
  const [amOn,  setAmOn]  = useState(false);
  const [pmOn,  setPmOn]  = useState(false);
  const [amTime,setAmTime]= useState("08:00");
  const [pmTime,setPmTime]= useState("21:00");
  const [amDays,setAmDays]= useState([1,2,3,4,5,6,0]); // all days
  const [pmDays,setPmDays]= useState([1,2,3,4,5,6,0]);
  const [saved, setSaved] = useState(false);

  function toggleDay(setter, days, i) {
    setter(days.includes(i) ? days.filter(d=>d!==i) : [...days,i]);
  }

  function requestNotif() {
    if (!notifGranted) { setShowPrompt(true); return; }
  }

  function handleToggle(which) {
    if (!notifGranted) { setShowPrompt(true); return; }
    if (which==="am") setAmOn(p=>!p);
    else setPmOn(p=>!p);
  }

  function grantPermission() {
    setNotifGranted(true);
    setShowPrompt(false);
    // auto-enable both after granting
    setAmOn(true); setPmOn(true);
  }

  function save() { setSaved(true); setTimeout(()=>setSaved(false),2500); }

  return (
    <div style={{height:"100%",background:C.bg,display:"flex",flexDirection:"column",position:"relative"}}>
      <div style={{flex:1,overflowY:"auto",padding:"18px 24px 40px"}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <button onClick={onBack} style={{background:"none",border:"none",fontSize:14,color:C.muted,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
          <span style={{fontFamily:"Georgia,serif",fontSize:19,color:C.text}}>Settings</span>
          <div style={{width:50}}/>
        </div>

        {/* Era chip */}
        <div style={{background:era.bg,borderRadius:14,padding:"18px 20px",display:"flex",alignItems:"center",gap:16,marginBottom:28}}>
          <span style={{fontSize:30}}>{era.emoji}</span>
          <div>
            <p style={{fontSize:11,color:C.muted,letterSpacing:1,marginBottom:2}}>CURRENT ERA</p>
            <p style={{fontFamily:"Georgia,serif",fontSize:16,color:era.color}}>{era.name}</p>
          </div>
        </div>

        {/* Notifications section */}
        <p style={{fontSize:14,color:C.text,fontWeight:600,marginBottom:5}}>Reminders</p>
        <p style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:16}}>
          Get a gentle nudge from Get Pretty before your morning and evening rituals.
        </p>

        {!notifGranted ? (
          <button onClick={()=>setShowPrompt(true)} style={{
            width:"100%", padding:"14px 18px", borderRadius:14, border:`1.5px solid ${era.color}60`,
            background:era.bg, display:"flex", alignItems:"center", gap:14, cursor:"pointer",
            fontFamily:"inherit", marginBottom:24, textAlign:"left",
          }}>
            <span style={{fontSize:24}}>🔔</span>
            <div style={{flex:1}}>
              <p style={{fontSize:14,color:era.color,fontWeight:500,marginBottom:2}}>Enable notifications</p>
              <p style={{fontSize:12,color:C.muted}}>Tap to allow Get Pretty to send reminders</p>
            </div>
            <span style={{color:era.color,fontSize:14}}>→</span>
          </button>
        ) : (
          <div style={{marginBottom:24}}>
            <TimePickerRow
              label="Morning ritual" icon="☀️"
              enabled={amOn} time={amTime} days={amDays} color="#B8924A"
              onToggle={()=>handleToggle("am")}
              onTimeChange={setAmTime}
              onDayToggle={i=>toggleDay(setAmDays,amDays,i)}
            />
            <TimePickerRow
              label="Evening ritual" icon="🌙"
              enabled={pmOn} time={pmTime} days={pmDays} color="#9B85B8"
              onToggle={()=>handleToggle("pm")}
              onTimeChange={setPmTime}
              onDayToggle={i=>toggleDay(setPmDays,pmDays,i)}
            />
          </div>
        )}

        {notifGranted && (
          <button onClick={save} style={{width:"100%",padding:"15px 0",borderRadius:13,border:"none",background:saved?"#7A9E6E":"#2C2C2C",color:"#FAF8F5",fontSize:15,fontWeight:500,cursor:"pointer",fontFamily:"inherit",transition:"background 0.3s",marginBottom:28}}>
            {saved?"✓ Saved!":"Save Reminders"}
          </button>
        )}

        <div style={{height:1,background:C.border,marginBottom:28}}/>

        {/* Reassess */}
        <div style={{marginBottom:28}}>
          <p style={{fontSize:14,color:C.text,fontWeight:600,marginBottom:5}}>Reassess Your Skin</p>
          <p style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:14}}>Skin changes. Retake monthly to update your era and routine.</p>
          <button onClick={onRetake} style={{width:"100%",padding:"14px 0",borderRadius:13,border:`1.5px solid ${C.border}`,background:"none",fontSize:14,color:"#6B5E57",cursor:"pointer",fontFamily:"inherit"}}>Retake Skin Era Quiz</button>
        </div>

        <div style={{textAlign:"center",paddingTop:8}}>
          <p style={{fontFamily:"Georgia,serif",fontSize:17,color:"#D4CBC4",letterSpacing:2}}>Get Pretty</p>
          <p style={{fontSize:11,color:"#D4CBC4",fontStyle:"italic",marginTop:4}}>Intelligent skincare — for the era you're in.</p>
        </div>
      </div>

      {/* iOS-style permission prompt */}
      {showPrompt && (
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,borderRadius:44,padding:"0 28px"}}>
          <div style={{background:"#F2F2F7",borderRadius:14,overflow:"hidden",width:"100%",maxWidth:320}}>
            {/* App icon + header */}
            <div style={{padding:"24px 20px 16px",textAlign:"center",borderBottom:"1px solid rgba(0,0,0,0.12)"}}>
              <div style={{width:56,height:56,borderRadius:14,background:"linear-gradient(135deg,#C4957A,#8BAF7C)",margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26}}>🌿</div>
              <p style={{fontSize:17,color:"#000",fontWeight:600,marginBottom:6,fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif"}}>"Get Pretty" Would Like to Send You Notifications</p>
              <p style={{fontSize:13,color:"#6C6C70",lineHeight:1.5,fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif"}}>Notifications may include your morning and evening ritual reminders.</p>
            </div>
            {/* Buttons */}
            <div style={{display:"flex"}}>
              <button onClick={()=>setShowPrompt(false)} style={{flex:1,padding:"14px 0",background:"none",border:"none",borderRight:"1px solid rgba(0,0,0,0.12)",cursor:"pointer",fontSize:17,color:"#007AFF",fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif"}}>Don't Allow</button>
              <button onClick={grantPermission} style={{flex:1,padding:"14px 0",background:"none",border:"none",cursor:"pointer",fontSize:17,color:"#007AFF",fontWeight:600,fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif"}}>Allow</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ONE-TIME NOTIFICATION SETUP ─────────────────────────────────────────────
function NotificationSetupScreen({ era, onDone }) {
  const [granted,    setGranted]    = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [amOn,  setAmOn]  = useState(false);
  const [pmOn,  setPmOn]  = useState(false);
  const [amTime,setAmTime]= useState("08:00");
  const [pmTime,setPmTime]= useState("21:00");
  const [amDays,setAmDays]= useState([1,2,3,4,5,6,0]);
  const [pmDays,setPmDays]= useState([1,2,3,4,5,6,0]);

  function toggleDay(setter, days, i) {
    setter(days.includes(i) ? days.filter(d=>d!==i) : [...days,i]);
  }

  function grantPermission() {
    setGranted(true); setShowPrompt(false);
    setAmOn(true); setPmOn(true);
  }

  return (
    <div style={{height:"100%",background:C.bg,display:"flex",flexDirection:"column",position:"relative"}}>
      <div style={{flex:1,overflowY:"auto",padding:"28px 24px 32px"}}>

        {/* Header */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:48,marginBottom:14}}>🔔</div>
          <h2 style={{fontFamily:"Georgia,serif",fontSize:22,color:C.text,fontWeight:400,marginBottom:8}}>Stay on track</h2>
          <p style={{fontSize:14,color:C.muted,lineHeight:1.65}}>
            Get Pretty will remind you before your morning and evening rituals — gently, not aggressively.
          </p>
        </div>

        {!granted ? (
          /* Permission card */
          <div style={{background:era.bg,border:`1.5px solid ${era.color}40`,borderRadius:16,padding:"24px 20px",marginBottom:24,textAlign:"center"}}>
            <p style={{fontSize:15,color:era.color,fontWeight:500,marginBottom:8}}>Enable ritual reminders</p>
            <p style={{fontSize:13,color:"#6B5E57",lineHeight:1.65,marginBottom:20}}>
              We'll only notify you at the times you choose. No spam, ever.
            </p>
            <button onClick={()=>setShowPrompt(true)} style={{
              padding:"12px 28px",borderRadius:12,border:"none",
              background:era.color,color:"#FFF",fontSize:14,fontWeight:500,
              cursor:"pointer",fontFamily:"inherit",
            }}>Allow notifications</button>
          </div>
        ) : (
          /* Time pickers */
          <div style={{marginBottom:20}}>
            <TimePickerRow
              label="Morning ritual" icon="☀️"
              enabled={amOn} time={amTime} days={amDays} color="#B8924A"
              onToggle={()=>setAmOn(p=>!p)}
              onTimeChange={setAmTime}
              onDayToggle={i=>toggleDay(setAmDays,amDays,i)}
            />
            <TimePickerRow
              label="Evening ritual" icon="🌙"
              enabled={pmOn} time={pmTime} days={pmDays} color="#9B85B8"
              onToggle={()=>setPmOn(p=>!p)}
              onTimeChange={setPmTime}
              onDayToggle={i=>toggleDay(setPmDays,pmDays,i)}
            />
          </div>
        )}

        {/* Actions */}
        <button onClick={onDone} style={{
          width:"100%",padding:"15px 0",borderRadius:13,border:"none",
          background: granted ? era.color : "#2C2C2C",
          color:"#FFF",fontSize:15,fontWeight:500,letterSpacing:0.4,
          cursor:"pointer",fontFamily:"inherit",marginBottom:12,
        }}>
          {granted ? "Save & See My Routine →" : "Set up later →"}
        </button>
        {!granted && (
          <p style={{textAlign:"center",fontSize:11,color:C.muted,fontStyle:"italic"}}>
            You can always enable reminders from Settings
          </p>
        )}
      </div>

      {/* iOS permission dialog */}
      {showPrompt && (
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,borderRadius:44,padding:"0 28px"}}>
          <div style={{background:"#F2F2F7",borderRadius:14,overflow:"hidden",width:"100%",maxWidth:320}}>
            <div style={{padding:"24px 20px 16px",textAlign:"center",borderBottom:"1px solid rgba(0,0,0,0.12)"}}>
              <div style={{width:56,height:56,borderRadius:14,background:"linear-gradient(135deg,#C4957A,#8BAF7C)",margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26}}>🌿</div>
              <p style={{fontSize:17,color:"#000",fontWeight:600,marginBottom:6,fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif"}}>"Get Pretty" Would Like to Send You Notifications</p>
              <p style={{fontSize:13,color:"#6C6C70",lineHeight:1.5,fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif"}}>Notifications may include your morning and evening ritual reminders.</p>
            </div>
            <div style={{display:"flex"}}>
              <button onClick={()=>setShowPrompt(false)} style={{flex:1,padding:"14px 0",background:"none",border:"none",borderRight:"1px solid rgba(0,0,0,0.12)",cursor:"pointer",fontSize:17,color:"#007AFF",fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif"}}>Don't Allow</button>
              <button onClick={grantPermission} style={{flex:1,padding:"14px 0",background:"none",border:"none",cursor:"pointer",fontSize:17,color:"#007AFF",fontWeight:600,fontFamily:"-apple-system,BlinkMacSystemFont,sans-serif"}}>Allow</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function SplashScreen({ onStart }) {
  return(
    <div style={{height:"100%",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 28px",textAlign:"center"}}>
      <div style={{fontSize:56,marginBottom:24}}>🌿</div>
      <h1 style={{fontFamily:"Georgia,serif",fontSize:30,color:C.text,letterSpacing:2,marginBottom:8,fontWeight:400}}>Get Pretty</h1>
      <p style={{fontSize:12,color:C.muted,letterSpacing:2,textTransform:"uppercase",marginBottom:48}}>skin intelligence</p>
      <p style={{fontFamily:"Georgia,serif",fontSize:17,color:"#6B5E57",lineHeight:1.75,marginBottom:48}}>Skincare isn't what you apply.<br/>It's how you live, think, and feel.</p>
      <Btn onClick={onStart}>Begin Your Skin Assessment →</Btn>
      <p style={{fontSize:12,color:C.muted,marginTop:18,fontStyle:"italic"}}>11 questions · 3 minutes · built for you</p>
    </div>
  );
}

// ─── IPHONE ───────────────────────────────────────────────────────────────────
function IPhone({ children }) {
  return(
    <div style={{width:375,height:780,background:"#1A1A1A",borderRadius:50,padding:"10px 6px",boxShadow:"0 40px 100px rgba(0,0,0,0.45),0 0 0 1px #333,inset 0 0 0 2px #2A2A2A",position:"relative",flexShrink:0}}>
      <div style={{position:"absolute",left:-3,top:100,width:3,height:30,background:"#2C2C2C",borderRadius:"2px 0 0 2px"}}/>
      <div style={{position:"absolute",left:-3,top:145,width:3,height:50,background:"#2C2C2C",borderRadius:"2px 0 0 2px"}}/>
      <div style={{position:"absolute",left:-3,top:210,width:3,height:50,background:"#2C2C2C",borderRadius:"2px 0 0 2px"}}/>
      <div style={{position:"absolute",right:-3,top:160,width:3,height:70,background:"#2C2C2C",borderRadius:"0 2px 2px 0"}}/>
      <div style={{height:"100%",borderRadius:44,overflow:"hidden",background:C.bg,position:"relative"}}>
        <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:126,height:34,background:"#1A1A1A",borderRadius:"0 0 20px 20px",zIndex:200}}>
          <div style={{position:"absolute",left:22,top:10,width:12,height:12,borderRadius:"50%",background:"#0A0A0A"}}/>
          <div style={{position:"absolute",right:22,top:11,width:10,height:10,borderRadius:"50%",background:"#1C1C1E"}}/>
        </div>
        <div style={{height:44,flexShrink:0}}/>
        <div style={{height:"calc(100% - 44px)",position:"relative"}}>{children}</div>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
const NAV = [
  {key:"splash",   label:"Splash"},
  {key:"quiz",     label:"Quiz"},
  {key:"loading",  label:"Analysing", locked:true},
  {key:"profile",  label:"My Era",    locked:true},
  {key:"notif",    label:"Reminders", locked:true},
  {key:"home",     label:"Routine",   locked:true},
  {key:"settings", label:"Settings",  locked:true},
];

export default function App() {
  const [screen,   setScreen]   = useState("splash");
  const [analysis, setAnalysis] = useState(null);
  const [answers,  setAnswers]  = useState(null);

  function handleQuizDone(a)      { setAnswers(a); setScreen("loading"); }
  function handleAnalysisDone(r)  { setAnalysis(r); setScreen("profile"); }
  function handleRetake()         { setAnalysis(null); setAnswers(null); setScreen("quiz"); }

  const NeedsQuiz = ()=>(
    <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,padding:24}}>
      <p style={{fontSize:32}}>🌿</p>
      <p style={{fontFamily:"Georgia,serif",fontSize:15,color:C.muted,textAlign:"center",lineHeight:1.6}}>Complete the quiz first to unlock this screen.</p>
      <button onClick={()=>setScreen("quiz")} style={{padding:"10px 22px",borderRadius:10,background:C.accent,color:"#FFF",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Take Quiz →</button>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:"linear-gradient(145deg,#2C2018 0%,#3D2E1E 50%,#1A1410 100%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 20px",fontFamily:"'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif"}}>
      <div style={{marginBottom:20,textAlign:"center"}}>
        <p style={{color:"#C4957A",fontSize:11,letterSpacing:3,textTransform:"uppercase",marginBottom:6}}>Interactive Prototype</p>
        <h1 style={{color:"#FAF8F5",fontFamily:"Georgia,serif",fontSize:26,letterSpacing:3,fontWeight:400}}>Get Pretty</h1>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(196,149,122,0.15)",border:"1px solid rgba(196,149,122,0.3)",borderRadius:20,padding:"6px 14px",marginBottom:18}}>
        <span style={{fontSize:13}}>✨</span>
        <span style={{fontSize:11,color:"#C4957A",letterSpacing:0.3}}>Powered by AI cosmetology analysis</span>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:22,flexWrap:"wrap",justifyContent:"center"}}>
        {NAV.map(n=>{
          const disabled=n.locked&&!analysis, active=screen===n.key;
          return(<button key={n.key} onClick={()=>!disabled&&setScreen(n.key)} style={{padding:"6px 14px",borderRadius:20,fontFamily:"inherit",background:active?"#C4957A":"rgba(255,255,255,0.08)",color:active?"#FFF":disabled?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.65)",border:`1px solid ${active?"#C4957A":"rgba(255,255,255,0.12)"}`,fontSize:12,cursor:disabled?"not-allowed":"pointer",transition:"all 0.2s"}}>{n.label}</button>);
        })}
      </div>
      <IPhone>
        {screen==="splash"   && <SplashScreen onStart={()=>setScreen("quiz")}/>}
        {screen==="quiz"     && <QuizScreen onComplete={handleQuizDone}/>}
        {screen==="loading"  && (answers ? <LoadingScreen answers={answers} onDone={handleAnalysisDone}/> : <NeedsQuiz/>)}
        {screen==="profile"  && (analysis ? <ProfileScreen analysis={analysis} onContinue={()=>setScreen("notif")}/> : <NeedsQuiz/>)}
        {screen==="notif"    && (analysis ? <NotificationSetupScreen era={analysis.era} onDone={()=>setScreen("home")}/> : <NeedsQuiz/>)}
        {screen==="home"     && (analysis ? <HomeScreen analysis={analysis} onSettings={()=>setScreen("settings")}/> : <NeedsQuiz/>)}
        {screen==="settings" && (analysis ? <SettingsScreen era={analysis.era} onBack={()=>setScreen("home")} onRetake={handleRetake}/> : <NeedsQuiz/>)}
      </IPhone>
      {analysis&&(
        <div style={{marginTop:22,display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:20,padding:"8px 18px"}}>
          <span style={{fontSize:15}}>{analysis.era.emoji}</span>
          <span style={{fontSize:12,color:"rgba(255,255,255,0.5)"}}>Active era:</span>
          <span style={{fontSize:12,color:"#C4957A",fontFamily:"Georgia,serif"}}>{analysis.era.name}</span>
          <button onClick={handleRetake} style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:12,marginLeft:4}}>↺ reset</button>
        </div>
      )}
      <p style={{color:"rgba(255,255,255,0.18)",fontSize:11,marginTop:16,textAlign:"center",letterSpacing:0.3}}>Complete all 11 questions — AI cosmetology analysis runs automatically</p>
    </div>
  );
}
