import { api } from './lib/api';

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
  const c = a.concerns || a.skin_goals || [];
  if (c.includes('sensitive') || c.includes('dryness')) return ERAS.barrier_healing;
  if (c.includes('acne'))                                return ERAS.acne_reset;
  if (a.smoke === 'daily')                               return ERAS.burnout_recovery;
  if (c.includes('dullness') || c.includes('dull_skin') || c.includes('pores') || c.includes('large_pores')) return ERAS.glow_building;
  if (c.includes('wrinkles') || c.includes('fine_lines')) return ERAS.repair_restore;
  return ERAS.barrier_healing;
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

  return api.post('/api/ai/product-recommendations', { productAudit, country, eraName });
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
  { id:'welcome', type:'welcome', countsInProgress:false,
    header:'Imagine waking up knowing exactly what your skin needs.',
    body:"No guessing. No wasted money. Just healthy, glowing skin — backed by science and built around you.",
    timeNote:'⏱ Takes about 5 minutes',
    checklist:['Personalized routine','Product audit','Skin analysis','Lifestyle insights'],
    footer:'🔒 Your answers stay private and are used only to personalize your plan.',
    cta:'Create My Skin Longevity Plan →' },

  { id:'name', type:'name', emoji:'✨', chapter:'About You',
    question:"Let's get acquainted. What's your first name?",
    why:"We'll personalize your skin journey — and celebrate your progress — by name.",
    placeholder:'Your name' },

  { id:'greeting', type:'greeting', countsInProgress:false,
    text:(name)=>`👋 Hi, ${name}. So glad you're here. Let's take a quiet moment to focus on you.`,
    autoAdvanceMs:2000 },

  { id:'birthday', type:'birthday', emoji:'🎂', chapter:'About You',
    question:(name)=>`When's your birthday, ${name}?`,
    why:"Your skin's needs change with each decade — we calibrate ingredient strength and priorities to where you are now." },

  { id:'gender', type:'single', emoji:'👋', chapter:'About You',
    question:'Who are we creating this plan for?',
    why:"Biology shapes your skin's needs — this helps us calibrate correctly.",
    cardStyle:true,
    options:[
      {value:'she',label:'Woman',icon:'👩',desc:'Tailored to female skin biology and hormonal patterns'},
      {value:'he',label:'Man',icon:'👨',desc:'Tailored to male skin characteristics'},
    ] },

  { id:'location', type:'location', emoji:'📍', chapter:'About You',
    question:'Where do you live?',
    why:"Climate, UV, and humidity all shape what your skin needs. We use your location to personalize your recommendations.",
    fact:'People in humid climates often need a very different routine than those in dry climates.',
    fields:[{key:'city',placeholder:'City'},{key:'country',placeholder:'Country'}] },

  { id:'work_environment', type:'single', emoji:'🏢', chapter:'About You',
    question:'Tell us about your day.',
    why:'Your skin faces different challenges depending on where you spend your time — UV, air conditioning, pollution, dehydration.',
    fact:'Air conditioning can increase skin dehydration, while outdoor work raises UV exposure and pigmentation risk.',
    options:[
      {value:'office',label:'Office or remote work'},{value:'outdoors',label:'Mostly outdoors'},
      {value:'driving',label:'Driving most of the day'},{value:'ac_workplace',label:'Air-conditioned workplace'},
      {value:'polluted',label:'Dusty or polluted environment'},{value:'home_kids',label:'At home with kids'},
      {value:'travel',label:'I travel frequently'},
    ] },

  { id:'chapter_2', type:'interstitial', countsInProgress:false, chapterNumber:2, totalChapters:5,
    chapterName:'Your Skin', headline:"Now let's understand your skin's story." },

  { id:'interests', type:'multi', emoji:'💫', chapter:'Your Skin',
    question:'What would you love to achieve for your skin?',
    hint:'Choose all that apply.',
    options:[
      {value:'routine_that_works',label:'Build a routine that actually works'},
      {value:'healthier_glow',label:'Get healthier, glowing skin'},
      {value:'stop_wasting_money',label:"Stop wasting money on products that don't work"},
      {value:'discover_needs',label:'Discover what my skin really needs'},
      {value:'use_what_i_own',label:'Make better use of what I already own'},
      {value:'track_progress',label:'Track my progress over time'},
      {value:'prevent_concerns',label:'Prevent future skin concerns'},
    ] },

  { id:'tone', type:'tone', emoji:'🌈', chapter:'Your Skin',
    question:"Let's find your Fitzpatrick skin type.",
    why:'This helps us personalize your SPF, pigmentation prevention, and treatment safety.' },

  { id:'post_cleanse_feel', type:'single', emoji:'💧', chapter:'Your Skin',
    question:'How does your skin feel 30 minutes after cleansing?',
    why:'This reveals your natural skin type — and tells us which cleanser and moisturizer are right for you.',
    tip:'For the most accurate answer, cleanse gently and wait 30 minutes without applying anything.',
    options:[
      {value:'dry',label:'Feels tight or uncomfortable'},{value:'comfortable',label:'Comfortable and balanced'},
      {value:'oily',label:'Looks shiny all over'},{value:'oily_tzone',label:'Only my T-zone gets oily'},
      {value:'tight_then_oily',label:'Starts tight, then becomes oily'},
      {value:'not_sure',label:'Help me figure it out'},
    ] },

  { id:'irritants', type:'multi', emoji:'⚡', chapter:'Your Skin',
    question:'What tends to trigger your skin?',
    hint:"Choose everything you've noticed.",
    why:"We'll steer your plan away from ingredients and treatments likely to set your skin off.",
    fact:"Sensitive skin isn't a skin type — it describes how your skin reacts to triggers.",
    options:[
      {value:'sun',label:'Sun'},{value:'heat',label:'Heat'},{value:'wind',label:'Wind'},
      {value:'cold',label:'Cold weather'},{value:'hot_water',label:'Hot water'},{value:'fragrance',label:'Fragrance'},
      {value:'essential_oils',label:'Essential oils'},{value:'acids',label:'Exfoliating acids'},{value:'retinoids',label:'Retinoids'},
      {value:'stress',label:'Stress'},{value:'lack_of_sleep',label:'Lack of sleep'},{value:'hormonal',label:'Hormonal changes'},
      {value:'hard_water',label:'Hard water'},{value:'nothing',label:"Nothing I've noticed"},{value:'other',label:'Other',freeText:true},
    ] },

  { id:'skin_goals', type:'multi', emoji:'🔍', chapter:'Your Skin',
    question:'Which skin concerns do you have right now?',
    why:"We'll build your plan around these — in the right order, at the right pace.",
    groups:[
      { label:'Texture & Aging', options:[
        {value:'fine_lines',label:'Fine lines'},{value:'wrinkles',label:'Wrinkles'},{value:'neck_aging',label:'Neck aging'},
        {value:'large_pores',label:'Enlarged pores'},{value:'uneven_texture',label:'Uneven texture'} ]},
      { label:'Tone', options:[
        {value:'pigmentation',label:'Pigmentation'},{value:'melasma',label:'Melasma'},{value:'dull_skin',label:'Dull skin'} ]},
      { label:'Skin Health', options:[
        {value:'acne',label:'Acne'},{value:'acne_scars',label:'Acne scars'},{value:'sensitive',label:'Sensitive skin'},
        {value:'redness',label:'Redness'},{value:'rosacea',label:'Rosacea'},{value:'dryness',label:'Dryness'},
        {value:'dehydration',label:'Dehydration',emoji:'💧'},{value:'oiliness',label:'Oiliness'},{value:'barrier_damage',label:'Barrier damage'} ]},
      { label:'Eyes', options:[
        {value:'dark_circles',label:'Under-eye dark circles'},{value:'puffy_eyes',label:'Puffy eyes'} ]},
    ] },

  { id:'top_concern', type:'priority', emoji:'🎯', chapter:'Your Skin',
    question:(name)=>`${name}, which one should we focus on first?`,
    why:'Your plan will target this first — the rest follow in the right sequence.',
    fact:'Treating concerns in the right order — barrier first — is how results stick.',
    showIf:(answers)=>(answers.skin_goals||[]).length>=2 },

  { id:'chapter_3', type:'interstitial', countsInProgress:false, chapterNumber:3, totalChapters:5,
    chapterName:'Health Picture', headline:'A little about your health — this stays private.' },

  { id:'diagnosed_conditions', type:'multi', emoji:'🩺', chapter:'Health Picture',
    question:'Have you ever been diagnosed with any of these skin conditions?',
    why:'This helps us recommend safer products and treatments for your skin.',
    options:[
      {value:'acne',label:'Acne'},{value:'rosacea',label:'Rosacea'},{value:'melasma',label:'Melasma'},
      {value:'eczema',label:'Eczema'},{value:'psoriasis',label:'Psoriasis'},
      {value:'seborrheic_dermatitis',label:'Seborrheic dermatitis'},{value:'hyperpigmentation',label:'Hyperpigmentation'},
      {value:'none',label:'None'},{value:'not_sure',label:'Not sure',icon:'🤔'},{value:'other',label:'Other',freeText:true},
    ] },

  { id:'health_conditions', type:'multi', emoji:'🩺', chapter:'Health Picture',
    question:'Some health conditions can influence your skin. Do any of these apply?',
    why:'Skin health starts inside the body — this helps us understand internal factors affecting yours.',
    footer:'🔒 Private, and used only to personalize your recommendations.',
    options:[
      {value:'pcos',label:'PCOS'},{value:'diabetes',label:'Diabetes'},{value:'thyroid',label:'Thyroid disorder'},
      {value:'digestive',label:'Digestive disorder'},{value:'autoimmune',label:'Autoimmune condition'},
      {value:'none',label:'None'},{value:'prefer_not_to_answer',label:'Prefer not to answer'},
    ] },

  { id:'allergies', type:'multi', emoji:'⚠️', chapter:'Health Picture',
    question:'Are there any ingredients or products your skin reacts to?',
    why:"We'll never recommend these.",
    groups:[
      { label:'Allergies', options:[
        {value:'meds',label:'Medications'},{value:'iodine',label:'Iodine'},
        {value:'foods',label:'Certain foods'},{value:'latex',label:'Latex'} ]},
      { label:'Skincare sensitivities', options:[
        {value:'fragrance',label:'Fragrance'},{value:'essential_oils',label:'Essential oils'},
        {value:'ahas_bhas',label:'AHAs/BHAs'},{value:'retinoids',label:'Retinoids'},
        {value:'sulfates',label:'Sulfates'},{value:'lanolin',label:'Lanolin'},
        {value:'sunscreen',label:'Sunscreens'},{value:'cosmetics',label:'Cosmetics'} ]},
    ],
    extraOptions:[{value:'other',label:'Other',freeText:true},{value:'none',label:'No known allergies or sensitivities'}] },

  { id:'hormones', type:'hormones', emoji:'🤍', chapter:'Health Picture',
    question:(name)=>`${name}, a few hormone questions — this is where skincare gets truly personal.`,
    why:'Hormones influence oil production, pigmentation, sensitivity, and which ingredients are safe for you.',
    footer:'🔒 Private, and used only to personalize your plan.',
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

  { id:'chapter_4', type:'interstitial', countsInProgress:false, chapterNumber:4, totalChapters:5,
    chapterName:'Your Lifestyle', headline:"Your skin doesn't exist in a vacuum. Let's look at the whole picture." },

  { id:'sleep', type:'single', emoji:'😴', chapter:'Your Lifestyle',
    question:'How many hours do you sleep?',
    why:'Sleep drives skin repair, collagen production, and your barrier\'s overnight recovery.',
    fact:'Most skin repair and collagen production happens while you sleep.',
    options:[
      {value:'less_5',label:'Less than 5 hours'},{value:'5_6',label:'5–6 hours'},{value:'6_7',label:'6–7 hours'},
      {value:'7_8',label:'7–8 hours'},{value:'more_8',label:'More than 8 hours'},
    ] },

  { id:'stress', type:'slider', emoji:'🧠', chapter:'Your Lifestyle',
    question:'How stressed have you been lately?',
    why:'Stress can affect breakouts, redness, healing, and premature aging.',
    fact:'Stress raises cortisol, which can affect oil production, inflammation, and your skin barrier.',
    min:1, max:10, anchors:['😌','😫'],
    labels:{ '1':'Very calm','2':'Very calm','3':'Mostly relaxed','4':'Mostly relaxed',
             '5':'Moderate','6':'Moderate','7':'High','8':'High','9':'Very high','10':'Very high' } },

  { id:'water_intake', type:'single', emoji:'💦', chapter:'Your Lifestyle',
    question:'How much water do you drink daily?',
    why:'Hydration supports overall health and can influence how your skin feels — especially if it runs dry.',
    options:[
      {value:'less_1l',label:'Less than 1L'},{value:'1_1_5l',label:'1–1.5L'},{value:'1_5_2l',label:'1.5–2L'},
      {value:'more_2l',label:'More than 2L'},{value:'not_sure',label:"I'm not sure",icon:'🤷'},
    ] },

  { id:'alcohol', type:'single', emoji:'🍷', chapter:'Your Lifestyle',
    question:'How often do you drink alcohol?',
    why:'Alcohol can affect hydration, inflammation, sleep quality, and skin recovery.',
    fact:'Alcohol can worsen dehydration and redness in some people — especially with rosacea or sensitive skin.',
    options:[
      {value:'never',label:'Never'},{value:'few_year',label:'A few times a year'},{value:'1_3_month',label:'1–3 times a month'},
      {value:'1_2_week',label:'1–2 times a week'},{value:'3_5_week',label:'3–5 times a week'},{value:'daily',label:'Daily'},
    ] },

  { id:'smoke', type:'single', emoji:'💨', chapter:'Your Lifestyle',
    question:'Do you smoke?',
    why:'Smoking affects collagen, healing speed, and skin oxygen supply — it changes what your routine should prioritize.',
    options:[{value:'never',label:'Never'},{value:'occasionally',label:'Occasionally'},{value:'daily',label:'Daily'}] },

  { id:'exercise', type:'single', emoji:'🏃', chapter:'Your Lifestyle',
    question:'How often do you move your body?',
    why:'Exercise boosts circulation and skin oxygenation — and tells us how sweat fits into your routine.',
    options:[
      {value:'never',label:'Never'},{value:'1_2_week',label:'1–2x a week'},
      {value:'3_5_week',label:'3–5x a week'},{value:'daily',label:'Daily'},
    ] },

  { id:'chapter_5', type:'interstitial', countsInProgress:false, chapterNumber:5, totalChapters:5,
    chapterName:'Your Routine', headline:"Last step — let's see what you're working with." },

  { id:'routine_products', type:'multi', emoji:'🧴', chapter:'Your Routine',
    question:"What's in your routine right now?",
    hint:'No judgment — tap everything you use.',
    why:"We'll tell you what to keep, replace, or retire.",
    options:[
      {value:'cleanser',label:'Cleanser'},{value:'toner',label:'Toner'},{value:'serum',label:'Serum'},
      {value:'moisturizer',label:'Moisturizer'},{value:'eye_cream',label:'Eye cream'},{value:'sunscreen',label:'Sunscreen'},
      {value:'retinol',label:'Retinol'},{value:'exfoliant',label:'Exfoliant'},{value:'face_oil',label:'Face oil'},
      {value:'mask',label:'Mask'},{value:'none',label:'None'},
    ] },

  { id:'event', type:'event', emoji:'🗓️', chapter:'Your Routine',
    question:'Getting ready for something special?',
    why:'A real deadline lets us pace your plan to peak exactly on time.',
    options:[
      {value:'trip',icon:'✈️',label:'Trip'},{value:'wedding',icon:'💍',label:'Wedding'},
      {value:'beach',icon:'🏖️',label:'Beach Vacation'},{value:'family',icon:'🏠',label:'Family Gathering'},
      {value:'party',icon:'🎉',label:'Party'},{value:'no_event',icon:'—',label:'No special event'},
    ] },

  { id:'event_date', type:'event_date', emoji:'📅', chapter:'Your Routine',
    question:"When's the big day?",
    why:"We'll build your plan to peak right on time.",
    showIf:(answers)=>answers.event && answers.event!=='no_event' },

  { id:'photos', type:'photos', emoji:'🤳', chapter:'Your Routine',
    question:(name)=>`${name}, let's see your skin.`,
    why:"Your photos become your baseline — the starting point we'll measure every week of progress against.",
    checklist:['No makeup','Natural daylight','Hair tied back','No filters, neutral expression'],
    footer:'🔒 Photos are private and only used for your analysis.',
    cta:'Start My Skin Scan →' },

  { id:'shelf', type:'shelf', emoji:'🧴', chapter:'Your Routine',
    question:'Now, show us your shelf.',
    why:"We'll audit every product — ingredient quality, compatibility, duplicates, correct order — and flag anything working against your skin.",
    hint:'Optional, up to 9 photos.' },

  // countsInProgress:false — this is the reveal screen, not a numbered step;
  // keeps "Step N of 26" accurate (26 = 33 entries minus welcome/greeting/4 interstitials/completion).
  { id:'completion', type:'completion', countsInProgress:false,
    stages:['Reading your skin profile','Cross-checking 10 safety rules…','Auditing your products','Building your personalized plan'],
    headline:(name)=>`${name}, your Skin Longevity Plan is ready.` },
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
