// server/utils/affectiveLayer.js
// ------------------------------------------------------------
// Purpose: infer user's affective state (discrete emotions + appraisal)
// Output: { emotions, dominant, confidence, appraisal, evidence, source }
// Strategy: rule-first (transparent, cheap), fallback to LLM when uncertain
// ------------------------------------------------------------
const OpenAI = require("openai");

// --- Keyword lexicons (seed; expand over time) ---
const LEX = {
  anger: [
    "angry",
    "furious",
    "rage",
    "hate",
    "unfair",
    "injustice",
    "outraged",
    "so mad",
    "this is insane",
  ],
  fear: [
    "terrified",
    "scared",
    "afraid",
    "panic",
    "shaking",
    "they'll come",
    "come to my house",
    "i'm in danger",
  ],
  sadness: [
    "sad",
    "crying",
    "depressed",
    "heartbroken",
    "hopeless",
    "i can't stop crying",
    "devastated",
  ],
  guilt: [
    "my fault",
    "it's on me",
    "i shouldn't have",
    "regret",
    "ashamed",
    "i caused this",
  ],
  anxiety: [
    "anxious",
    "can't sleep",
    "overwhelmed",
    "what if",
    "worried",
    "stressed",
    "panic attack",
    "nervous",
  ],
  numbness: [
    "numb",
    "don't care",
    "empty",
    "exhausted",
    "burned out",
    "shut down",
  ],
};

// Attribution & appraisal cues
const OTHER_BLAME = [
  "they leaked",
  "they posted",
  "they threatened",
  "harass",
  "stalk",
  "blackmail",
  "extort",
  "unfair",
  "illegal",
];
const SELF_BLAME = [
  "my fault",
  "i shouldn't have",
  "i caused",
  "i regret",
  "i'm to blame",
  "it's on me",
];
const LOSS_OF_CTRL = [
  "can't",
  "cannot",
  "unable",
  "out of control",
  "helpless",
  "nothing i can do",
  "powerless",
];
const UNCERTAIN = [
  "maybe",
  "might",
  "could",
  "not sure",
  "unsure",
  "what if",
  "possibly",
];
const IMMINENT = [
  "right now",
  "today",
  "tonight",
  "coming to my house",
  "on the way",
  "they're here",
];

// utility
function countHits(text, list) {
  const t = text.toLowerCase();
  const hits = [];
  for (const kw of list) if (t.includes(kw)) hits.push(kw);
  return { count: hits.length, hits };
}

function cap01(x) {
  return Math.max(0, Math.min(1, x));
}

function normalizeEmotions(scores) {
  // Simple cap; you can switch to softmax if needed
  const out = {};
  for (const k of Object.keys(scores)) out[k] = cap01(scores[k]);
  const dominant =
    Object.entries(out).sort((a, b) => b[1] - a[1])[0]?.[0] || "sadness";
  const confidence = cap01(out[dominant]); // treat peak as confidence proxy
  return { out, dominant, confidence };
}

function inferAppraisal(text, perception) {
  const t = text.toLowerCase();
  const other = countHits(t, OTHER_BLAME).count;
  const self = countHits(t, SELF_BLAME).count;
  const ctrlLoss = countHits(t, LOSS_OF_CTRL).count;
  const uncert = countHits(t, UNCERTAIN).count;
  const immin = countHits(t, IMMINENT).count;

  const blame_target = other > self ? "other" : self > 0 ? "self" : "none";
  let control =
    ctrlLoss > 0 || perception?.severity === "critical" ? "low" : "medium";
  if (/i can\b|plan|step/i.test(text)) control = "high";

  const certainty = uncert > 0 ? "uncertain" : "certain";
  let threat_time = "none";
  if (immin > 0 || /come to my house|right now/i.test(text))
    threat_time = "imminent";
  else if (/(soon|later|tomorrow|next week|might)/i.test(text))
    threat_time = "potential";

  return { blame_target, control, certainty, threat_time };
}

function scoreByLexicon(text) {
  const t = text.toLowerCase();
  const exclaim = (t.match(/!/g) || []).length;
  const allcaps = (text.match(/\b[A-Z]{3,}\b/g) || []).length;

  const evidence = { hits: {}, intensifiers: { exclaim, allcaps } };
  const base = {};
  for (const k of Object.keys(LEX)) {
    const { count, hits } = countHits(t, LEX[k]);
    evidence.hits[k] = hits;
    base[k] = Math.min(0.6, count * 0.18); // up to 0.6 from pure lexicon
  }

  // Intensifiers: exclamation and ALLCAPS push anger/sadness/anxiety a bit
  base.anger += Math.min(0.15, exclaim * 0.06 + allcaps * 0.05);
  base.sadness += Math.min(0.1, exclaim * 0.03);
  base.anxiety += Math.min(0.12, exclaim * 0.04);

  return { base, evidence };
}

function applyPerceptionAppraisalBoost(base, perception, appraisal) {
  // Use safety tags to bias emotion intensities
  if (perception?.tags?.includes("threat")) base.fear += 0.2;
  if (perception?.tags?.includes("privacy_leak")) base.anxiety += 0.1;
  if (perception?.tags?.includes("distress")) base.sadness += 0.12;

  if (perception?.severity === "critical") {
    base.fear += 0.2;
    base.anxiety += 0.1;
  }

  // Appraisal-informed boosts
  if (appraisal.blame_target === "other") base.anger += 0.15;
  if (appraisal.blame_target === "self") base.guilt += 0.2;

  if (appraisal.control === "low") {
    base.sadness += 0.1;
    base.fear += 0.1;
  }
  if (appraisal.certainty === "uncertain") base.anxiety += 0.12;
  if (appraisal.threat_time === "imminent") base.fear += 0.15;

  // Cap
  for (const k of Object.keys(base)) base[k] = cap01(base[k]);
  return base;
}

async function llmFallback(text, openaiClient) {
  const openai = openaiClient || new OpenAI({ apiKey: process.env.API_KEY });
  const sys = `You are an affect classifier. Return ONLY JSON:
{
  "emotions": {"sadness":0-1,"anger":0-1,"fear":0-1,"anxiety":0-1,"guilt":0-1,"numbness":0-1},
  "dominant": "sadness|anger|fear|anxiety|guilt|numbness",
  "confidence": 0-1,
  "appraisal": {"blame_target":"other|self|none","control":"low|medium|high","certainty":"certain|uncertain","threat_time":"imminent|potential|none"}
}`;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: text },
    ],
  });

  try {
    const parsed = JSON.parse(res.choices[0].message.content);
    // basic sanity check
    if (parsed?.emotions && parsed?.dominant) {
      return {
        ...parsed,
        source: "llm",
        evidence: { hits: {}, intensifiers: {} },
      };
    }
  } catch (_) {}
  // conservative fallback
  return {
    emotions: {
      sadness: 0.5,
      anger: 0.2,
      fear: 0.3,
      anxiety: 0.4,
      guilt: 0.1,
      numbness: 0.1,
    },
    dominant: "sadness",
    confidence: 0.6,
    appraisal: {
      blame_target: "none",
      control: "medium",
      certainty: "certain",
      threat_time: "none",
    },
    evidence: { hits: {}, intensifiers: {} },
    source: "llm",
  };
}

// ---- Main entry ----
async function affectiveLayer(text = "", perception = null, opts = {}) {
  const { useLLM = true, openaiClient = null, minConfidence = 0.55 } = opts;
  const raw = (text || "").trim();
  if (!raw) {
    return {
      emotions: {
        sadness: 0,
        anger: 0,
        fear: 0,
        anxiety: 0,
        guilt: 0,
        numbness: 0,
      },
      dominant: "sadness",
      confidence: 0,
      appraisal: {
        blame_target: "none",
        control: "medium",
        certainty: "certain",
        threat_time: "none",
      },
      evidence: { hits: {}, intensifiers: {} },
      source: "rule",
    };
  }

  const { base, evidence } = scoreByLexicon(raw);
  const appraisal = inferAppraisal(raw, perception);
  const boosted = applyPerceptionAppraisalBoost(base, perception, appraisal);
  const { out, dominant, confidence } = normalizeEmotions(boosted);

  if (!useLLM || confidence >= minConfidence) {
    return {
      emotions: out,
      dominant,
      confidence,
      appraisal,
      evidence,
      source: "rule",
    };
  }

  // LLM fallback
  const byLLM = await llmFallback(raw, openaiClient);
  // keep rule evidence for transparency; prefer higher confidence
  return byLLM.confidence >= confidence
    ? byLLM
    : {
        emotions: out,
        dominant,
        confidence,
        appraisal,
        evidence,
        source: "rule",
      };
}

module.exports = affectiveLayer;
