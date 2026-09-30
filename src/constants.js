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

// KEEP IN SYNC with server/services/eras.js (the admin dashboard writes era objects from
// that copy; server/services/eras.test.js fails if the two tables differ).
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

// ─── Quiz structure ─────────────────────────────────────────────────────────
// IMPORTANT (for junior developers): the quiz TEXT no longer lives here. This file keeps only the
// STRUCTURE of the quiz: ids, types, stored values, emoji, ordering rules and behaviour flags.
// Every visible sentence is in src/locales/<lang>/quiz.json, keyed by the question id, e.g.
//   quiz:<id>.question   quiz:<id>.why   quiz:<id>.options.<value>.label   quiz:<id>.groups.<n>
// The screens build those keys at render time (see QuizScreen.web.jsx). Do NOT put text back into
// these objects: src/lib/quizStructure.test.js fails if a string/function property appears that
// is not on its allow-list, and src/lib/quizValues.test.js proves the stored values never change.
// `chapterNumber` (1-5) picks the chapter name from quiz:chapters.<n>.

// Skin tones: `value` is the stored answer, `swatch` the colour dot. Names: quiz:tone.options.<value>.label / .sub
export const SKIN_TONES = [
  { value:'I',   swatch:'#FDE8D8' },
  { value:'II',  swatch:'#F5C9A0' },
  { value:'III', swatch:'#D4956A' },
  { value:'IV',  swatch:'#B07040' },
  { value:'V',   swatch:'#7B4A20' },
  { value:'VI',  swatch:'#3D1F0A' },
];

export const QUESTIONS = [
  { id:'welcome', type:'welcome', countsInProgress:false },

  { id:'name', type:'name', emoji:'✨', chapterNumber:1 },

  // Auto-advancing greeting; the text uses the user's name (quiz:greeting.text / textNoName).
  { id:'greeting', type:'greeting', countsInProgress:false, autoAdvanceMs:2000 },

  { id:'birthday', type:'birthday', emoji:'🎂', chapterNumber:1 },

  { id:'gender', type:'single', emoji:'👋', chapterNumber:1, cardStyle:true,
    options:[
      {value:'she',icon:'👩'},
      {value:'he',icon:'👨'},
    ] },

  { id:'location', type:'location', emoji:'📍', chapterNumber:1,
    fields:[{key:'city'},{key:'country'}] },

  { id:'work_environment', type:'single', emoji:'🏢', chapterNumber:1,
    options:[
      {value:'office'},{value:'outdoors'},
      {value:'driving'},{value:'ac_workplace'},
      {value:'polluted'},{value:'home_kids'},
      {value:'travel'},
    ] },

  { id:'chapter_2', type:'interstitial', countsInProgress:false, chapterNumber:2, totalChapters:5 },

  { id:'interests', type:'multi', emoji:'💫', chapterNumber:2,
    options:[
      {value:'routine_that_works'},
      {value:'healthier_glow'},
      {value:'stop_wasting_money'},
      {value:'discover_needs'},
      {value:'use_what_i_own'},
      {value:'track_progress'},
      {value:'prevent_concerns'},
    ] },

  { id:'tone', type:'tone', emoji:'🌈', chapterNumber:2 },

  { id:'post_cleanse_feel', type:'single', emoji:'💧', chapterNumber:2,
    options:[
      {value:'dry'},{value:'comfortable'},
      {value:'oily'},{value:'oily_tzone'},
      {value:'tight_then_oily'},
      {value:'not_sure'},
    ] },

  { id:'irritants', type:'multi', emoji:'⚡', chapterNumber:2,
    options:[
      {value:'sun'},{value:'heat'},{value:'wind'},
      {value:'cold'},{value:'hot_water'},{value:'fragrance'},
      {value:'essential_oils'},{value:'acids'},{value:'retinoids'},
      {value:'stress'},{value:'lack_of_sleep'},{value:'hormonal'},
      {value:'hard_water'},{value:'nothing',exclusive:true},{value:'other',freeText:true},
    ] },

  // Group names: quiz:skin_goals.groups.<n> (n = position below, starting at 0).
  { id:'skin_goals', type:'multi', emoji:'🔍', chapterNumber:2,
    groups:[
      { options:[
        {value:'fine_lines'},{value:'wrinkles'},{value:'neck_aging'},
        {value:'large_pores'},{value:'uneven_texture'} ]},
      { options:[
        {value:'pigmentation'},{value:'melasma'},{value:'dull_skin'} ]},
      { options:[
        {value:'acne'},{value:'acne_scars'},{value:'sensitive'},
        {value:'redness'},{value:'rosacea'},{value:'dryness'},
        {value:'dehydration',emoji:'💧'},{value:'oiliness'},{value:'barrier_damage'} ]},
      { options:[
        {value:'dark_circles'},{value:'puffy_eyes'} ]},
    ] },

  { id:'top_concern', type:'priority', emoji:'🎯', chapterNumber:2,
    showIf:(answers)=>(answers.skin_goals||[]).length>=2 },

  { id:'chapter_3', type:'interstitial', countsInProgress:false, chapterNumber:3, totalChapters:5 },

  { id:'diagnosed_conditions', type:'multi', emoji:'🩺', chapterNumber:3,
    options:[
      {value:'acne'},{value:'rosacea'},{value:'melasma'},
      {value:'eczema'},{value:'psoriasis'},
      {value:'seborrheic_dermatitis'},{value:'hyperpigmentation'},
      {value:'none',exclusive:true},{value:'not_sure',icon:'🤔',exclusive:true},{value:'other',freeText:true},
    ] },

  { id:'health_conditions', type:'multi', emoji:'🩺', chapterNumber:3,
    options:[
      {value:'pcos'},{value:'diabetes'},{value:'thyroid'},
      {value:'digestive'},{value:'autoimmune'},
      {value:'none',exclusive:true},{value:'prefer_not_to_answer',exclusive:true},
    ] },

  { id:'allergies', type:'multi', emoji:'⚠️', chapterNumber:3,
    groups:[
      { options:[
        {value:'meds'},{value:'iodine'},
        {value:'foods'},{value:'latex'} ]},
      { options:[
        {value:'fragrance'},{value:'essential_oils'},
        {value:'ahas_bhas'},{value:'retinoids'},
        {value:'sulfates'},{value:'lanolin'},
        {value:'sunscreen'},{value:'cosmetics'} ]},
    ],
    extraOptions:[{value:'other',freeText:true},{value:'none',exclusive:true}] },

  { id:'hormones', type:'hormones', emoji:'🤍', chapterNumber:3,
    showIf:(answers)=>answers.gender==='she',
    fields:[
      {key:'pregnant',options:[{value:'yes'},{value:'no'}]},
      {key:'breastfeeding',options:[{value:'yes'},{value:'no'}]},
      {key:'trying_to_conceive',options:[{value:'yes'},{value:'no'}]},
      {key:'regular_cycle',options:[{value:'yes'},{value:'no'},{value:'not_sure'}]},
      {key:'menopause',options:[{value:'yes'},{value:'no'}]},
      {key:'hormonal_birth_control',options:[{value:'yes'},{value:'no'}]},
      {key:'hormone_therapy',options:[{value:'yes'},{value:'no'}]},
    ] },

  { id:'chapter_4', type:'interstitial', countsInProgress:false, chapterNumber:4, totalChapters:5 },

  { id:'sleep', type:'single', emoji:'😴', chapterNumber:4,
    options:[
      {value:'less_5'},{value:'5_6'},{value:'6_7'},
      {value:'7_8'},{value:'more_8'},
    ] },

  // Stress scale 1-10; the label under the row is quiz:stress.labels.<1-10>.
  { id:'stress', type:'slider', emoji:'🧠', chapterNumber:4,
    min:1, max:10, anchors:['😌','😫'] },

  { id:'water_intake', type:'single', emoji:'💦', chapterNumber:4,
    options:[
      {value:'less_1l'},{value:'1_1_5l'},{value:'1_5_2l'},
      {value:'more_2l'},{value:'not_sure',icon:'🤷'},
    ] },

  { id:'alcohol', type:'single', emoji:'🍷', chapterNumber:4,
    options:[
      {value:'never'},{value:'few_year'},{value:'1_3_month'},
      {value:'1_2_week'},{value:'3_5_week'},{value:'daily'},
    ] },

  { id:'smoke', type:'single', emoji:'💨', chapterNumber:4,
    options:[{value:'never'},{value:'occasionally'},{value:'daily'}] },

  { id:'exercise', type:'single', emoji:'🏃', chapterNumber:4,
    options:[
      {value:'never'},{value:'1_2_week'},
      {value:'3_5_week'},{value:'daily'},
    ] },

  { id:'chapter_5', type:'interstitial', countsInProgress:false, chapterNumber:5, totalChapters:5 },

  { id:'routine_products', type:'multi', emoji:'🧴', chapterNumber:5,
    options:[
      {value:'cleanser'},{value:'toner'},{value:'serum'},
      {value:'moisturizer'},{value:'eye_cream'},{value:'sunscreen'},
      {value:'retinol'},{value:'exfoliant'},{value:'face_oil'},
      {value:'mask'},{value:'none',exclusive:true},
    ] },

  { id:'event', type:'event', emoji:'🗓️', chapterNumber:5,
    options:[
      {value:'trip',icon:'✈️'},{value:'wedding',icon:'💍'},
      {value:'beach',icon:'🏖️'},{value:'family',icon:'🏠'},
      {value:'party',icon:'🎉'},{value:'no_event',icon:'—'},
    ] },

  { id:'event_date', type:'event_date', emoji:'📅', chapterNumber:5,
    showIf:(answers)=>answers.event && answers.event!=='no_event' },

  { id:'photos', type:'photos', emoji:'🤳', chapterNumber:5 },

  { id:'shelf', type:'shelf', emoji:'🧴', chapterNumber:5 },

  // countsInProgress:false — this is the reveal screen, not a numbered step;
  // keeps "Step N of 26" accurate (26 = 33 entries minus welcome/greeting/4 interstitials/completion).
  { id:'completion', type:'completion', countsInProgress:false, stageCount:4 },
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
