// server/utils/perceptionLayer.js

// ------------------------------------------------------------
// 作用：分析用户输入内容，检测风险信号、隐私泄露、PII、平台名称等
// 输出：结构化对象 { tags, severity, confidence, lang, pii }
// ------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/[^\s)]+/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE =
  /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b/g; // 宽松匹配
const IP_RE =
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const SOCIAL_HANDLE_RE = /(?:^|\s)@([A-Za-z0-9_]{2,32})\b/g; // @username
const POSTAL_HINT_RE =
  /\b(?:street|st\.|road|rd\.|ave\.|avenue|blvd\.|zip\s?\d{5}|邮编|小区|单元|号楼|室)\b/i;

const CRISIS_KWS = ["kill myself", "suicide", "want to die", "end my life"];

const DOXX_KWS = [
  "doxx",
  "doxxing",
  "exposed my address",
  "leaked my number",
  "posted my info",
];

const THREAT_KWS = [
  "threaten",
  "threat",
  "blackmail",
  "extort",
  "stalk",
  "following me",
  "come to my house",
];

const DISTRESS_KWS = [
  "panic",
  "panic attack",
  "can't breathe",
  "can't sleep",
  "shaking",
  "crying",
];

const PLATFORMS = require("../config/platforms");

// 用来判断输入是中文(zh)还是英文(en)。
// function detectLang(text) {
//   // 粗略：含中文字符则 zh，否则 en（可替换为更准确的库）
//   return /[\u4e00-\u9fa5]/.test(text) ? "zh" : "en";
// }

// 执行正则多次匹配并去重
function collectRegex(text, re, mapper = (x) => x) {
  const found = [];
  let m;
  re.lastIndex = 0; // 确保每次从头匹配
  while ((m = re.exec(text)) !== null) {
    found.push(mapper(m[0]));
    if (found.length > 50) break; // 防御性限制
  }
  return [...new Set(found)];
}

// 检测关键词是否出现在文本中
function includesAny(text, kws) {
  const t = text.toLowerCase();
  return kws.filter((kw) => t.includes(kw.toLowerCase()));
}

// 识别文本中提到的社交平台
function normalizePlatforms(text) {
  const t = text.toLowerCase();
  const hit = [];
  for (const p of PLATFORMS) {
    if (t.includes(p)) hit.push(p.replace(".com", ""));
  }
  return [...new Set(hit)];
}

function perceptionLayer(input) {
  const raw = (input || "").trim();
  // const lang = detectLang(raw);
  const text = raw.toLowerCase();

  // --- A. 关键词触发 ---
  const crisisHits = includesAny(text, CRISIS_KWS);
  const doxxHits = includesAny(text, DOXX_KWS);
  const threatHits = includesAny(text, THREAT_KWS);
  const distressHits = includesAny(text, DISTRESS_KWS);
  const platformHits = normalizePlatforms(text);

  // --- B. PII & 链接 ---
  const urls = collectRegex(raw, URL_RE);
  const emails = collectRegex(raw, EMAIL_RE);
  const phones = collectRegex(raw, PHONE_RE);
  const ips = collectRegex(raw, IP_RE);
  const socialHandles = collectRegex(raw, SOCIAL_HANDLE_RE, (m) => m.trim());
  const addressHints = POSTAL_HINT_RE.test(raw) ? ["address_hint"] : [];

  // --- C. 标签聚合 ---
  const tags = new Set();
  const triggers = new Set([
    ...crisisHits,
    ...doxxHits,
    ...threatHits,
    ...distressHits,
    ...platformHits,
  ]);

  if (crisisHits.length) tags.add("crisis");
  if (
    doxxHits.length ||
    emails.length ||
    phones.length ||
    ips.length ||
    addressHints.length
  ) {
    tags.add("privacy_leak");
  }
  if (threatHits.length) tags.add("threat");
  if (distressHits.length) tags.add("distress");
  if (platformHits.length) tags.add("platform_mentioned");
  if (socialHandles.length) tags.add("social_handle");

  // --- D. 置信度 & 严重级别 ---
  let confidence = 0;
  let severity = "low";

  if (crisisHits.length) {
    severity = "critical";
    confidence += 0.6;
  }
  if (doxxHits.length) {
    severity = maxSeverity(severity, "high");
    confidence += 0.3;
  }
  const piiKinds = [
    emails.length,
    phones.length,
    ips.length,
    addressHints.length,
  ].filter(Boolean).length;
  if (piiKinds >= 2) {
    severity = maxSeverity(severity, "high");
    confidence += 0.4;
  }
  if (threatHits.length) {
    severity = maxSeverity(severity, "high");
    confidence += 0.25;
  }
  if (distressHits.length) {
    severity = maxSeverity(severity, "medium");
    confidence += 0.25;
  }
  if (platformHits.length) {
    confidence += 0.05;
  }

  // 简单误报抑制：引用/非亲历（“他说/他们说/我看见一篇文章说…”）
  if (/\b(he|she|they)\s+said\b|\b看到一篇|新闻里|report says/i.test(raw)) {
    confidence -= 0.15;
  }

  // 文本极短 + 单一触发 → 下调
  if (raw.length < 20 && triggers.size <= 1) {
    confidence -= 0.1;
    if (severity === "medium") severity = "low";
  }

  confidence = Math.max(0, Math.min(1, confidence));

  return {
    triggers: [...triggers],
    tags: [...tags],
    pii: {
      emails,
      phones,
      ipAddresses: ips,
      urls,
      socialHandles,
      addressHints,
    },
    platforms: platformHits,
    severity,
    confidence,
    lang,
  };
}

function maxSeverity(a, b) {
  const rank = { low: 0, medium: 1, high: 2, critical: 3 };
  return rank[b] > rank[a] ? b : a;
}

module.exports = perceptionLayer;
