export const C = {
  bg:          '#FAF8F5',
  text:        '#2C2C2C',
  muted:       '#9B8E85',
  border:      '#E8E0D8',
  card:        '#FFFFFF',
  accent:      '#C4957A',
  accentLight: '#FBF6EE',
};

export const ERAS = {
  barrier_healing:  { id:'barrier_healing',  emoji:'🌿', name:'Barrier Healing Era',   tagline:"Your skin is not broken — it's asking for gentleness.",       affirmation:'I give my skin permission to heal at its own pace.', color:'#7A9E6E', bg:'#F2F6EF' },
  acne_reset:       { id:'acne_reset',        emoji:'🧊', name:'Acne Reset Era',         tagline:"Your skin isn't struggling — it's communicating.",             affirmation:'I listen to my skin instead of fighting it.',         color:'#6A98B0', bg:'#EEF4F8' },
  burnout_recovery: { id:'burnout_recovery',  emoji:'😴', name:'Burnout Recovery Era',   tagline:"Your skin is tired because you are. That's valid.",            affirmation:'Rest is part of my skincare routine.',               color:'#9B85B8', bg:'#F5F2F8' },
  glow_building:    { id:'glow_building',     emoji:'✨', name:'Glow Building Era',      tagline:'Your foundation is ready. Now we build radiance.',             affirmation:'I nourish my skin with intention, not urgency.',     color:'#B8924A', bg:'#FBF6EE' },
  repair_restore:   { id:'repair_restore',    emoji:'🌙', name:'Repair & Restore Era',   tagline:'Aging is not the enemy — neglect is.',                         affirmation:"I invest in my skin's future, one day at a time.",   color:'#B07860', bg:'#FAF3EF' },
};

export function fallbackEra(a) {
  const c = a.concerns || [];
  if (c.includes('sensitive') || c.includes('dryness')) return ERAS.barrier_healing;
  if (c.includes('acne'))                                return ERAS.acne_reset;
  if (a.smoke === 'yes' || a.age === '45+')              return ERAS.burnout_recovery;
  if (c.includes('dullness') || c.includes('pores'))     return ERAS.glow_building;
  if (c.includes('wrinkles') || a.age === '35-44')       return ERAS.repair_restore;
  return ERAS.barrier_healing;
}

export async function analyzeWithAI(answers) {
  const PLABELS = { cleanser:'Cleanser', moisturizer:'Moisturizer', serum:'Serum', treatments:'Active treatments (acne/anti-aging)', spf:'Sunscreen', none:'No products currently' };
  const CLABELS = { acne:'Breakouts & acne', wrinkles:'Fine lines & aging', pigmentation:'Dark spots', sensitive:'Sensitive & reactive', dryness:'Dryness & dehydration', pores:'Enlarged pores' };
  const ALABELS = { cosmetics:'Cosmetics', iodine:'Iodine', foods:'Foods', fragrance:'Fragrances', sunscreen:'Sunscreens', meds:'Medications', animals:'Animals' };

  const products  = (answers.routine_products || []).map(p => PLABELS[p] || p).join(', ') || 'None';
  const concerns  = (answers.concerns || []).map(c => CLABELS[c] || c).join(', ')         || 'None specified';
  const allergies = (answers.allergies || []).filter(a => a !== 'none').map(a => ALABELS[a] || a).join(', ') || 'None';
  const photos    = ['photo_right','photo_left','photo_front'].filter(k => answers[k]).length;
  const shelf     = (answers.shelf_photos || []).length;

  const system = `You are a clinical cosmetologist with 20 years of experience in skin analysis and personalized routine building. You analyze a client's complete profile — skin condition, lifestyle, health history, and current products — and return precise, science-backed recommendations.

Rules:
- Flag products that conflict with the client's skin concerns
- Consider health flags: smoking accelerates aging; diabetes affects wound healing; pregnancy restricts retinoids, salicylic acid, high-dose Vitamin C, essential oils
- Build routines that are realistic — not overwhelming
- Be specific, not generic
- Return ONLY valid JSON with no extra text, no markdown fences`;

  const user = `Analyze this client and return a complete skin profile:

PROFILE:
- Gender: ${answers.gender || 'not specified'}
- Age: ${answers.age || 'not specified'}
- Skin tone (Fitzpatrick): Type ${answers.tone || 'not specified'}
- Concerns: ${concerns}
- Current products: ${products}
- Smokes: ${answers.smoke || 'no'}
- Diabetes: ${answers.diabetes || 'no'}
- Allergies: ${allergies}
- Pregnant/TTC: ${answers.pregnant || 'no'}
- Goals: ${answers.goals || 'not stated'}
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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 1000,
      system, messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data   = await res.json();
  const raw    = data.content.find(b => b.type === 'text')?.text || '';
  const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  parsed.era   = ERAS[parsed.eraId] || fallbackEra(answers);
  return parsed;
}

export function buildFallback(answers) {
  const era     = fallbackEra(answers);
  const hasProd = (answers.routine_products || []).filter(p => p !== 'none').length > 0;
  return {
    eraId: era.id, era,
    skinAnalysis: 'Based on your assessment, your skin is showing signs of stress and barrier disruption. The combination of your concerns and lifestyle factors points to a skin system that needs support and simplification before active treatment.',
    keyInsights: [
      "Your skin's current reactivity suggests a compromised barrier — this is the first thing to address",
      'Lifestyle factors are directly amplifying your skin concerns and need to be managed alongside your routine',
      hasProd ? 'Some of your current products may be working against your skin right now — the audit will flag these' : 'Starting with a clean, minimal routine will reset your skin baseline effectively',
    ],
    productAudit: {
      keep:    hasProd ? [{ product:'Moisturizer', reason:'Hydration is always appropriate — keep this as your anchor product' }] : [],
      remove:  hasProd ? [{ product:'Active treatments (retinol, acids)', reason:'Too aggressive for a stressed barrier — pause these until skin stabilizes' }] : [],
      replace: hasProd ? [{ from:'Current cleanser', to:'pH-balanced gentle cleanser (e.g. La Roche-Posay Toleriane)', reason:'Harsh cleansers strip the barrier daily, undoing all other work' }] : [],
      add: [
        { product:'Ceramide serum or moisturizer', reason:'The single most important product for barrier repair', priority:'essential' },
        { product:'Mineral SPF 30+', reason:'UV damage is the #1 barrier aggressor — non-negotiable daily', priority:'essential' },
        { product:'Centella asiatica essence', reason:'Powerfully anti-inflammatory, speeds barrier recovery', priority:'recommended' },
      ],
    },
    routine: {
      am: [
        { name:'Cool water rinse',     description:'Skip cleanser in AM — let your skin keep its overnight oils' },
        { name:'Alcohol-free toner',   description:'Pat gently into damp skin with fingertips, don\'t wipe' },
        { name:'Ceramide serum',       description:'2-3 drops while skin is still slightly damp for best absorption' },
        { name:'Barrier moisturizer',  description:'Apply generously — don\'t be afraid of richness in the morning' },
        { name:'Mineral SPF 30+',      description:'Finish every morning without fail. UV undoes all healing work' },
      ],
      pm: [
        { name:'Oil cleanse',              description:'Massage gently to dissolve SPF and daily buildup — no friction' },
        { name:'pH-balanced gel cleanser', description:'Rinse with lukewarm water. Hot water strips the barrier' },
        { name:'Centella or oat essence',  description:'Anti-inflammatory calm — this is your skin\'s reset moment' },
        { name:'Barrier repair cream',     description:'Apply generously. Overnight is when skin rebuilds most actively' },
      ],
    },
    affirmation: era.affirmation,
  };
}

export async function fetchProductRecs(productAudit, country, eraName) {
  const replaceItems = productAudit.replace || [];
  const addItems     = productAudit.add     || [];
  if (!replaceItems.length && !addItems.length) return { replace:[], add:[] };

  const system = `You are a professional skincare product specialist. Always recommend reputable brands: La Roche-Posay, CeraVe, Paula's Choice, The Ordinary, Cetaphil, Vichy, Bioderma, COSRX, Avene, SkinCeuticals, Neutrogena, First Aid Beauty, Drunk Elephant, Medik8.
For the specified country provide realistic local pricing and retailers. Return ONLY valid JSON, no other text.`;

  const needs = [
    ...addItems.map((i, idx)     => `[add_${idx}] [ADD] ${i.product}`),
    ...replaceItems.map((i, idx) => `[replace_${idx}] [REPLACE] Replace "${i.from}" with: ${i.to}`),
  ].join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 1000,
      system,
      messages: [{ role: 'user', content: `Country: ${country}\nSkin Era: ${eraName}\n\nRecommend ONE specific product per need:\n${needs}\n\nReturn JSON:\n{\n  "add": [{"index":0,"rec":{"brand":"","name":"","price":"","url":"","retailer":""}}],\n  "replace": [...]\n}` }],
    }),
  });
  const data = await res.json();
  const raw  = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

export const SKIN_TONES = [
  { value:'I',   label:'Porcelain Glow',   sub:'Very fair, burns easily',  swatch:'#FDE8D8' },
  { value:'II',  label:'Fair & Sensitive', sub:'Fair, usually burns',       swatch:'#F5C9A0' },
  { value:'III', label:'Warm Beige',       sub:'Medium, sometimes burns',  swatch:'#D4956A' },
  { value:'IV',  label:'Golden Olive',     sub:'Olive toned, tans easily', swatch:'#B07040' },
  { value:'V',   label:'Rich Bronze',      sub:'Brown, rarely burns',      swatch:'#7B4A20' },
  { value:'VI',  label:'Deep Ebony',       sub:'Dark brown/black',         swatch:'#3D1F0A' },
];

export const QUESTIONS = [
  { id:'gender',           type:'single',     emoji:'👋', section:'The Vibe Check',          question:'How do you identify?',                                              options:[{value:'she',label:'She / Her'},{value:'he',label:'He / Him'}] },
  { id:'birthday',         type:'birthday',   emoji:'🎂',                                    question:'When is your birthday?',                hint:'We use this to personalise your skin plan' },
  { id:'name',             type:'name',       emoji:'✨',                                    question:'What do your besties call you?',         placeholder:'Your name' },
  { id:'interests',        type:'interests',  emoji:'💫',                                    question:'What are you interested in?',            hint:'Pick everything that speaks to you ✨',
    options:['Personalized skincare routine','Skin analysis + product matching','Tracking progress (before/after)','Building a routine with what I already own','Product ingredient checker','Professional treatments guidance','Seasonal routine updates',"Stop buying products that don't work"] },
  { id:'tone',             type:'tone',       emoji:'🌈',                                    question:"Let's find your skin tone",              hint:'Every skin tone has its own glow story' },
  { id:'concerns',         type:'multi',      emoji:'🔍', section:"Your Skin's Current Mood",question:"What's your skin going through rn?",     hint:'Select all that feel true', options:[{value:'acne',label:'🔥 Breakout era',sub:'acne'},{value:'wrinkles',label:'🌙 Fine lines',sub:'aging'},{value:'pigmentation',label:'🎭 Dark spots',sub:'uneven tone'},{value:'sensitive',label:'🧊 Sensitive & reactive'},{value:'dryness',label:'🏜️ Thirsty skin'},{value:'pores',label:'🔍 Pores doing too much'}] },
  { id:'routine_products', type:'multi',      emoji:'🧴',                                    question:"What's in your current rotation?",       hint:'No judgment — tap all you use', options:[{value:'cleanser',label:'🧴 Cleanser'},{value:'moisturizer',label:'💧 Moisturizer'},{value:'serum',label:'✨ Serum'},{value:'treatments',label:'🎯 Treatments'},{value:'spf',label:'☀️ Sunscreen'},{value:'none',label:'🚫 Honestly? Not much rn'}] },
  { id:'smoke',            type:'single',     emoji:'💨', section:'The Real Talk', sectionSub:'A few health questions so we can keep you safe 💗', question:'Do you smoke?', options:[{value:'no',label:'No'},{value:'sometimes',label:'Sometimes'},{value:'yes',label:'Yes'}] },
  { id:'diabetes',         type:'single',     emoji:'🩺',                                    question:'Do you have diabetes?',                                              options:[{value:'no',label:'No'},{value:'yes',label:'Yes'},{value:'unsure',label:'Not sure'}] },
  { id:'allergies',        type:'multi',      emoji:'⚠️',                                   question:'Any known allergies or sensitivities?',  hint:"Select all that apply — we'll never recommend these", options:[{value:'cosmetics',label:'Cosmetics / skincare'},{value:'iodine',label:'Iodine'},{value:'foods',label:'Certain foods'},{value:'fragrance',label:'Fragrances'},{value:'sunscreen',label:'Sunscreens'},{value:'meds',label:'Medications'},{value:'animals',label:'Animals'},{value:'none',label:'None I know of'}] },
  { id:'pregnant',         type:'single',     emoji:'🤍',                                    question:'Pregnant or trying to conceive?',        hint:"Some ingredients aren't pregnancy-safe — we want to look out for you", options:[{value:'no',label:'No'},{value:'yes',label:'Yes'},{value:'skip',label:'Prefer not to say'}] },
  { id:'event',            type:'event',      emoji:'🗓️',                                   question:'Do you want to be ready for an event?',  hint:'A visible deadline helps you glow up faster 💅',
    options:[{value:'trip',icon:'✈️',label:'Trip'},{value:'wedding',icon:'💍',label:'Wedding'},{value:'beach',icon:'🏖️',label:'Beach Vacation'},{value:'family',icon:'🏠',label:'Family Gathering'},{value:'party',icon:'🎉',label:'Party'},{value:'no_event',icon:'—',label:'No special event'}] },
  { id:'event_date',       type:'event_date', emoji:'📅',                                    question:"When's your event?",                     hint:"We'll build your skin plan to peak right on time ✨" },
  { id:'photos',           type:'photos',     emoji:'🤳',                                    question:"Let's see your skin",                    hint:'Natural light, no makeup — your skin, honestly ✨' },
  { id:'shelf',            type:'shelf',      emoji:'🧴',                                    question:"What's on your shelf?",                  hint:"We're curious, not judgy · optional, up to 5" },
  { id:'completion',       type:'completion', emoji:'🌿',                                    question:'Your Skin Era is ready' },
];

export const MOODS = [
  { emoji:'✨', label:'Glowing' },
  { emoji:'🌿', label:'Calm' },
  { emoji:'😴', label:'Tired' },
  { emoji:'🔥', label:'Reactive' },
  { emoji:'🧊', label:'Breaking out' },
];

export const DONE_MSGS = {
  barrier_healing:  'Your barrier thanks you. Every gentle step today builds the foundation for calm, resilient skin.',
  acne_reset:       'You showed up for your skin — that consistency is exactly what creates real, lasting change.',
  burnout_recovery: 'Rest and ritual are medicine. You just gave your skin exactly what it needed.',
  glow_building:    'Radiance is built one intentional step at a time. You\'re doing the work.',
  repair_restore:   "Investing in your skin today is the most powerful anti-aging move you can make.",
};
