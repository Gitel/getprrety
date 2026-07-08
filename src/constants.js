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
  { id:'gender', type:'single', emoji:'👋',
    question:'How do you identify?',
    options:[{value:'she',label:'She / Her'},{value:'he',label:'He / Him'}] },

  { id:'birthday', type:'birthday', emoji:'🎂',
    question:'When is your birthday?',
    hint:'We use this to personalise your skin plan' },

  { id:'location', type:'location', emoji:'📍',
    question:'Where are you based?',
    hint:"City and country — helps us understand your skin's environment",
    fields:[{key:'city',placeholder:'City'},{key:'country',placeholder:'Country'}] },

  { id:'work_environment', type:'single', emoji:'🏢',
    question:'What is your typical work environment?',
    options:[{value:'indoors',label:'Indoors'},{value:'outdoors',label:'Outdoors'},{value:'mixed',label:'Mixed'}] },

  { id:'name', type:'name', emoji:'✨',
    question:'What is your name?',
    placeholder:'Your name' },

  { id:'interests', type:'interests', emoji:'💫',
    question:'What are you interested in?',
    hint:'Pick everything that speaks to you ✨',
    options:['Personalized skincare routine','Skin analysis + product matching','Tracking progress (before/after)','Building a routine with what I already own','Product ingredient checker','Professional skincare treatments guidance','Seasonal routine updates',"Stop buying products that don't work"] },

  { id:'tone', type:'tone', emoji:'🌈',
    question:"Let's find your skin tone",
    hint:'Every skin tone has its own glow story' },

  { id:'post_cleanse_feel', type:'single', emoji:'💧', section:'Your Skin',
    question:'How does your skin feel 30 minutes after cleansing?',
    options:[{value:'dry',label:'Dry'},{value:'comfortable',label:'Comfortable'},{value:'oily',label:'Oily'},{value:'oily_tzone',label:'Oily only in T-zone'},{value:'not_sure',label:'Not sure'}] },

  { id:'irritants', type:'multi', emoji:'⚡',
    question:'What usually irritates your skin?',
    hint:'Select all that apply',
    options:[{value:'heat',label:'Heat'},{value:'sun',label:'Sun'},{value:'wind',label:'Wind'},{value:'retinol',label:'Retinol'},{value:'acids',label:'Acids'},{value:'fragrance',label:'Fragrance'},{value:'essential_oils',label:'Essential oils'}] },

  { id:'skin_goals', type:'multi', emoji:'🔍',
    question:'Your skin goals — what would you like to improve?',
    hint:'Select all that feel true',
    options:[
      {value:'healthy_skin',label:'Healthy skin'},{value:'acne',label:'Acne'},{value:'pigmentation',label:'Pigmentation'},
      {value:'melasma',label:'Melasma'},{value:'fine_lines',label:'Fine lines'},{value:'wrinkles',label:'Wrinkles'},
      {value:'firmness',label:'Firmness'},{value:'sensitive',label:'Sensitive skin'},{value:'dryness',label:'Dryness'},
      {value:'oiliness',label:'Oiliness'},{value:'redness',label:'Redness'},{value:'rosacea',label:'Rosacea'},
      {value:'large_pores',label:'Large pores'},{value:'glow',label:'Glow'},{value:'even_tone',label:'Even skin tone'},
      {value:'dark_circles',label:'Dark circles'},{value:'puffy_eyes',label:'Puffy eyes'},{value:'acne_scars',label:'Acne scars'},
      {value:'neck_aging',label:'Neck aging'},
    ] },

  { id:'diagnosed_conditions', type:'multi', emoji:'🩺', section:'Your Medical & Skin History',
    question:'Have you ever been diagnosed with:',
    options:[{value:'acne',label:'Acne'},{value:'rosacea',label:'Rosacea'},{value:'melasma',label:'Melasma'},{value:'eczema',label:'Eczema'},{value:'psoriasis',label:'Psoriasis'},{value:'seborrheic_dermatitis',label:'Seborrheic dermatitis'},{value:'hyperpigmentation',label:'Hyperpigmentation'},{value:'none',label:'None'}] },

  { id:'health_conditions', type:'multi', emoji:'🩺',
    question:'Do you have any health conditions that may affect your skin?',
    options:[{value:'pcos',label:'PCOS'},{value:'diabetes',label:'Diabetes'},{value:'thyroid',label:'Thyroid disorder'},{value:'digestive',label:'Digestive disorder'},{value:'autoimmune',label:'Autoimmune condition'},{value:'none',label:'None'},{value:'prefer_not_to_answer',label:'Prefer not to answer'}] },

  { id:'allergies', type:'multi', emoji:'⚠️',
    question:'Any known allergies or sensitivities?',
    hint:"Select all that apply — we'll never recommend these",
    options:[{value:'cosmetics',label:'Cosmetics / skincare'},{value:'iodine',label:'Iodine'},{value:'foods',label:'Certain foods'},{value:'fragrance',label:'Fragrances'},{value:'sunscreen',label:'Sunscreens'},{value:'meds',label:'Medications'},{value:'animals',label:'Animals'},{value:'none',label:'None I know of'}] },

  { id:'hormones', type:'hormones', emoji:'🤍', section:'Hormones',
    question:'A few hormone-related questions',
    hint:'Only shown if you identified as she/her — helps us understand your skin more fully',
    showIf:(answers)=>answers.gender==='she',
    fields:[
      {key:'pregnant',label:'Pregnant?',options:[{value:'yes',label:'Yes'},{value:'no',label:'No'}]},
      {key:'breastfeeding',label:'Breastfeeding?',options:[{value:'yes',label:'Yes'},{value:'no',label:'No'}]},
      {key:'trying_to_conceive',label:'Trying to conceive?',options:[{value:'yes',label:'Yes'},{value:'no',label:'No'}]},
      {key:'regular_cycle',label:'Regular menstrual cycle?',options:[{value:'yes',label:'Yes'},{value:'no',label:'No'},{value:'not_sure',label:'Not sure'}]},
      {key:'menopause',label:'Menopause?',options:[{value:'yes',label:'Yes'},{value:'no',label:'No'}]},
      {key:'hormonal_birth_control',label:'Hormonal birth control?',options:[{value:'yes',label:'Yes'},{value:'no',label:'No'}]},
      {key:'hormone_therapy',label:'Hormone therapy?',options:[{value:'yes',label:'Yes'},{value:'no',label:'No'}]},
    ] },

  { id:'sleep', type:'single', emoji:'😴', section:'Lifestyle',
    question:'How many hours do you sleep?',
    options:[{value:'less_5',label:'Less than 5 hours'},{value:'5_6',label:'5–6 hours'},{value:'7_8',label:'7–8 hours'},{value:'more_8',label:'More than 8 hours'}] },

  { id:'stress', type:'slider', emoji:'🧠',
    question:'What is your level of stress?',
    min:1, max:10, hint:'1 = very calm · 10 = very stressed' },

  { id:'water_intake', type:'single', emoji:'💦',
    question:'What is your daily water intake?',
    options:[{value:'less_1l',label:'Less than 1L'},{value:'more_2l',label:'More than 2L'}] },

  { id:'alcohol', type:'single', emoji:'🍷',
    question:'How frequently do you consume alcohol?',
    options:[{value:'never',label:'Never'},{value:'weekly',label:'Weekly'},{value:'several_week',label:'Several times a week'},{value:'daily',label:'Daily'}] },

  { id:'smoke', type:'single', emoji:'💨',
    question:'Do you smoke?',
    options:[{value:'yes',label:'Yes'},{value:'never',label:'Never'},{value:'occasionally',label:'Occasionally'},{value:'daily',label:'Daily'}] },

  { id:'exercise', type:'single', emoji:'🏃',
    question:'How often do you exercise?',
    options:[{value:'never',label:'Never'},{value:'1_2_week',label:'1–2x / week'},{value:'3_5_week',label:'3–5x / week'},{value:'daily',label:'Daily'}] },

  { id:'routine_products', type:'multi', emoji:'🧴',
    question:'Which products do you currently use?',
    hint:'No judgment — tap all you use',
    options:[{value:'cleanser',label:'Cleanser'},{value:'toner',label:'Toner'},{value:'serum',label:'Serum'},{value:'moisturizer',label:'Moisturizer'},{value:'eye_cream',label:'Eye cream'},{value:'sunscreen',label:'Sunscreen'},{value:'retinol',label:'Retinol'},{value:'exfoliant',label:'Exfoliant'},{value:'face_oil',label:'Face oil'},{value:'mask',label:'Mask'},{value:'none',label:'None'}] },

  { id:'event', type:'event', emoji:'🗓️',
    question:'Do you want to be ready for an event?',
    hint:'A visible deadline helps you glow up faster 💅',
    options:[{value:'trip',icon:'✈️',label:'Trip'},{value:'wedding',icon:'💍',label:'Wedding'},{value:'beach',icon:'🏖️',label:'Beach Vacation'},{value:'family',icon:'🏠',label:'Family Gathering'},{value:'party',icon:'🎉',label:'Party'},{value:'no_event',icon:'—',label:'No special event'}] },

  { id:'event_date', type:'event_date', emoji:'📅',
    question:"When's your event?",
    hint:"We'll build your skin plan to peak right on time ✨" },

  { id:'photos', type:'photos', emoji:'🤳',
    question:"Let's see your skin",
    hint:'5 photos: Front, Left, Right, Close-up, Neck · No makeup, natural daylight, hair tied back, no filters, neutral expression' },

  { id:'shelf', type:'shelf', emoji:'🧴',
    question:"What's on your shelf?",
    hint:"Product + ingredient list photos · We'll check for ingredient quality, barrier safety, pregnancy safety, irritants, duplicates, compatibility, application order · optional, up to 9" },

  { id:'completion', type:'completion', emoji:'🌿',
    question:'Your Skin Longevity Plan is ready' },
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
