// server/utils/intentLayer.js
// ------------------------------------------------------------
// 任务：识别用户此刻的“交流意图”
// 参考 Disclosure & Support Context 下的四类语用行为（speech acts）：
// Venting:emotional ventilation
// Seeking Advice:problem-focused disclosure
// Crisis: crisis disclosure
// Casual: phatic communication）
// 输出：{ intent: "venting" | "seeking_advice" | "crisis" | "casual",
//        confidence: 0~1, source: "rule" | "llm" }
// 策略：规则优先（低成本、可解释），不确定时用 LLM 兜底
// ------------------------------------------------------------

const OpenAI = require("openai");

// —— 关键词表（需扩充）——
const ADVICE_KWS = [
  "what should i do",
  "how do i",
  "how can i",
  "should i",
  "can i",
  "next step",
  "report",
  "police",
  "contact",
  "help",
  "advice",
  "any suggestions",
];

const VENTING_KWS = [
  "i can't stand",
  "i'm so angry",
  "i'm furious",
  "i'm devastated",
  "i'm terrified",
  "i feel hopeless",
  "crying",
  "shaking",
  "i just need to vent",
  "so frustrating",
  "this is insane",
  "i hate this",
];

const CASUAL_KWS = [
  "thanks",
  "thank you",
  "haha",
  "lol",
  "you are kind",
  "who are you",
  "good night",
  "okay",
  "bye",
  "see you",
  "hi",
  "hello",
];

const QUESTION_RE = /\b(what|how|should|can)\b|\?/i;

// function includesAny(text, kws) {
//   const t = text.toLowerCase();
//   return kws.some((kw) => t.includes(kw.toLowerCase()));
// }

function scoreAdvice(text) {
  const t = text.toLowerCase();
  let s = 0;
  if (QUESTION_RE.test(text)) s += 0.35;
  for (const kw of ADVICE_KWS) if (t.includes(kw)) s += 0.15;
  return Math.min(1, s);
}

function scoreVenting(text) {
  const t = text.toLowerCase();
  let s = 0;
  for (const kw of VENTING_KWS) if (t.includes(kw)) s += 0.18;
  if (/[!]{2,}/.test(text)) s += 0.12; // 强烈情绪标点
  if (text.length > 80 && !QUESTION_RE.test(text)) s += 0.1; // 长段落+非提问更像宣泄
  return Math.min(1, s);
}

function scoreCasual(text) {
  const t = text.toLowerCase();
  let s = 0;
  for (const kw of CASUAL_KWS) if (t.includes(kw)) s += 0.25;
  if (/^\s*(ok|okay|sure|bye|see you)\s*$/i.test(t.trim())) s += 0.25;
  return Math.min(1, s);
}

/**
 * 规则优先分类
 * @param {string} text - 用户输入原文
 * @param {object} perception - 感知层输出（可为空）
 * @returns {{ intent: string, confidence: number, source: "rule" }}
 */
function classifyByRule(text = "", perception = null) {
  const lower = text.toLowerCase();
  const tags = new Set(perception?.tags || []);
  const severity = perception?.severity || "low";

  // 1️⃣ Crisis (highest priority)
  if (tags.has("crisis") || severity === "critical") {
    return { intent: "crisis", confidence: 0.95, source: "rule" };
  }

  // 2️⃣ Seeking advice：问句/求助词 + 隐私/威胁上下文加分
  const adviceScore =
    scoreAdvice(text) +
    (tags.has("privacy_leak") || tags.has("threat") ? 0.15 : 0);
  if (adviceScore >= 0.6) {
    return {
      intent: "seeking_advice",
      confidence: Math.min(0.95, adviceScore),
      source: "rule",
    };
  }

  //  3️⃣ Venting强情绪词 + 非问句 + 感知层 distress 加分
  const ventScore = scoreVenting(text) + (tags.has("distress") ? 0.15 : 0);
  if (ventScore >= 0.6) {
    return {
      intent: "venting",
      confidence: Math.min(0.9, ventScore),
      source: "rule",
    };
  }

  // 4️⃣ Casual / social
  const casualScore = scoreCasual(text);
  if (casualScore >= 0.6) {
    return {
      intent: "casual",
      confidence: Math.min(0.85, casualScore),
      source: "rule",
    };
  }

  // 5️⃣ Uncertain — low confidence (for LLM fallback)
  // 如果有 distress 标签 → 倾向 venting，否则倾向 seeking_advice（保守）
  if (tags.has("distress")) {
    return { intent: "venting", confidence: 0.45, source: "rule" };
  }
  if (tags.has("privacy_leak") || tags.has("threat")) {
    return { intent: "seeking_advice", confidence: 0.45, source: "rule" };
  }
  return { intent: "casual", confidence: 0.4, source: "rule" };
}

/**
 * LLM 兜底（仅在规则置信度不足时调用，节省成本）
 */
async function classifyByLLM(text, openaiClient) {
  const openai = openaiClient || new OpenAI({ apiKey: process.env.API_KEY });

  const messages = [
    {
      role: "system",
      content:
        "You are a classifier. Only output valid JSON with fields {intent, confidence}.",
    },
    {
      role: "user",
      content: `Classify the user's intent into exactly one of ["venting","seeking_advice","crisis","casual"]. Return a pure JSON.\nUser message: """${text}"""`,
    },
  ];

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    // messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    // response_format: { type: "json_object" }, // 如果模型支持就打开
    messages,
  });

  // 尝试解析；失败则给一个保守值
  const raw = res?.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(raw);
    const intent = String(parsed.intent || "").toLowerCase();
    const confidence = Math.max(
      0,
      Math.min(1, Number(parsed.confidence ?? 0.7))
    );
    if (["venting", "seeking_advice", "crisis", "casual"].includes(intent)) {
      return { intent, confidence, source: "llm" };
    }
  } catch (_) {}
  return { intent: "venting", confidence: 0.6, source: "llm" };
}

/**
 * 对外主函数
 * @param {string} text 用户原文
 * @param {object} perception 感知层输出
 * @param {{ useLLM?: boolean, openai?: any, minConfidence?: number }} opts
 */
async function intentLayer(text = "", perception, opts = {}) {
  const { useLLM = true, openai = null, minConfidence = 0.6 } = opts;

  // 先规则
  const rule = classifyByRule(text, perception);
  if (!useLLM || rule.confidence >= minConfidence) return rule;

  // 低置信度 → LLM 兜底
  const llm = await classifyByLLM(text, openai);
  // 取更高置信度的结果（防止 LLM 返回更差）
  return llm.confidence >= rule.confidence ? llm : rule;
}

module.exports = intentLayer;
