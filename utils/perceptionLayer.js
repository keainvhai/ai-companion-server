// // server/utils/perceptionLayer.js
// // ------------------------------------------------------------
// // 作用：分析用户输入内容，检测风险信号、隐私泄露、PII、平台名称等
// // 输出：结构化对象 { tags, severity, confidence, lang, pii }
// // 增强：增加可选的 LLM 兜底模式 useLLM，当规则检测信号不足时触发 GPT 分析
// // ------------------------------------------------------------

// const OpenAI = require("openai");
// const URL_RE = /\bhttps?:\/\/[^\s)]+/gi;
// const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// const PHONE_RE =
//   /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b/g;
// const IP_RE =
//   /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
// const SOCIAL_HANDLE_RE = /(?:^|\s)@([A-Za-z0-9_]{2,32})\b/g;
// const POSTAL_HINT_RE =
//   /\b(?:street|st\.|road|rd\.|ave\.|avenue|blvd\.|zip\s?\d{5}|邮编|小区|单元|号楼|室)\b/i;

// const CRISIS_KWS = ["kill myself", "suicide", "want to die", "end my life"];

// const DOXX_KWS = [
//   "doxx",
//   "doxxing",
//   "exposed",
//   "leaked",
//   "posted my info",
//   "leaked my address",
//   "shared my address",
//   "revealed my location",
//   "exposed my number",
// ];

// const THREAT_KWS = [
//   "threaten",
//   "threat",
//   "blackmail",
//   "extort",
//   "stalk",
//   "following me",
//   "come to my house",
// ];

// const DISTRESS_KWS = [
//   "panic",
//   "panic attack",
//   "can't breathe",
//   "can't sleep",
//   "shaking",
//   "crying",
// ];

// const PLATFORMS = require("../config/platforms");

// function collectRegex(text, re, mapper = (x) => x) {
//   const found = [];
//   let m;
//   re.lastIndex = 0;
//   while ((m = re.exec(text)) !== null) {
//     found.push(mapper(m[0]));
//     if (found.length > 50) break;
//   }
//   return [...new Set(found)];
// }

// function includesAny(text, kws) {
//   const t = text.toLowerCase();
//   return kws.filter((kw) => t.includes(kw.toLowerCase()));
// }

// function normalizePlatforms(text) {
//   const t = text.toLowerCase();
//   const hit = [];
//   for (const p of PLATFORMS) if (t.includes(p)) hit.push(p.replace(".com", ""));
//   return [...new Set(hit)];
// }

// // ---------------- Core Rule-based Detection ----------------
// async function perceptionLayer(input, opts = {}) {
//   const { useLLM = false, openaiClient = null, minConfidence = 0.5 } = opts;

//   const raw = (input || "").trim();
//   const text = raw.toLowerCase();

//   // --- A. 关键词触发 ---
//   const crisisHits = includesAny(text, CRISIS_KWS);
//   const doxxHits = includesAny(text, DOXX_KWS);
//   const threatHits = includesAny(text, THREAT_KWS);
//   const distressHits = includesAny(text, DISTRESS_KWS);
//   const platformHits = normalizePlatforms(text);

//   // --- B. PII & 链接 ---
//   const urls = collectRegex(raw, URL_RE);
//   const emails = collectRegex(raw, EMAIL_RE);
//   const phones = collectRegex(raw, PHONE_RE);
//   const ips = collectRegex(raw, IP_RE);
//   const socialHandles = collectRegex(raw, SOCIAL_HANDLE_RE, (m) => m.trim());
//   const addressHints = POSTAL_HINT_RE.test(raw) ? ["address_hint"] : [];

//   // --- C. 标签聚合 ---
//   const tags = new Set();
//   const triggers = new Set([
//     ...crisisHits,
//     ...doxxHits,
//     ...threatHits,
//     ...distressHits,
//     ...platformHits,
//   ]);

//   if (crisisHits.length) tags.add("crisis");
//   if (
//     doxxHits.length ||
//     emails.length ||
//     phones.length ||
//     ips.length ||
//     addressHints.length
//   )
//     tags.add("privacy_leak");
//   if (threatHits.length) tags.add("threat");
//   if (distressHits.length) tags.add("distress");
//   if (platformHits.length) tags.add("platform_mentioned");
//   if (socialHandles.length) tags.add("social_handle");

//   // --- D. 置信度 & 严重级别 ---
//   let confidence = 0;
//   let severity = "low";

//   if (crisisHits.length) {
//     severity = "critical";
//     confidence += 0.6;
//   }
//   if (doxxHits.length) {
//     severity = maxSeverity(severity, "high");
//     confidence += 0.3;
//   }
//   const piiKinds = [
//     emails.length,
//     phones.length,
//     ips.length,
//     addressHints.length,
//   ].filter(Boolean).length;
//   if (piiKinds >= 2) {
//     severity = maxSeverity(severity, "high");
//     confidence += 0.4;
//   }
//   if (threatHits.length) {
//     severity = maxSeverity(severity, "high");
//     confidence += 0.25;
//   }
//   if (distressHits.length) {
//     severity = maxSeverity(severity, "medium");
//     confidence += 0.25;
//   }
//   if (platformHits.length) confidence += 0.05;

//   if (/\b(he|she|they)\s+said\b|\b看到一篇|新闻里|report says/i.test(raw)) {
//     confidence -= 0.15;
//   }

//   if (raw.length < 20 && triggers.size <= 1) {
//     confidence -= 0.1;
//     if (severity === "medium") severity = "low";
//   }

//   confidence = Math.max(0, Math.min(1, confidence));

//   // --- E. 如果信号太弱且启用 useLLM，则调用 LLM 兜底 ---
//   if (useLLM && confidence < minConfidence && tags.size === 0) {
//     try {
//       const openai =
//         openaiClient || new OpenAI({ apiKey: process.env.API_KEY });
//       const res = await openai.chat.completions.create({
//         model: "gpt-4o-mini",
//         temperature: 0.2,
//         messages: [
//           {
//             role: "system",
//             content: `
// You are a text safety analyzer. Classify the user's message into structured safety tags.
// Return ONLY a JSON with fields:
// {
//   "tags": ["crisis"|"privacy_leak"|"threat"|"distress"|"platform_mentioned"...],
//   "severity": "low"|"medium"|"high"|"critical",
//   "confidence": 0~1
// }`,
//           },
//           { role: "user", content: raw },
//         ],
//       });

//       const parsed = JSON.parse(res.choices[0].message.content);
//       if (parsed.tags?.length) {
//         return {
//           triggers: [...triggers],
//           tags: parsed.tags,
//           pii: {
//             emails,
//             phones,
//             ipAddresses: ips,
//             urls,
//             socialHandles,
//             addressHints,
//           },
//           platforms: platformHits,
//           severity: parsed.severity || severity,
//           confidence: parsed.confidence ?? confidence,
//           source: "llm",
//         };
//       }
//     } catch (err) {
//       console.warn("⚠️ LLM fallback failed:", err.message);
//     }
//   }

//   // --- F. 默认返回规则结果 ---
//   return {
//     triggers: [...triggers],
//     tags: [...tags],
//     pii: {
//       emails,
//       phones,
//       ipAddresses: ips,
//       urls,
//       socialHandles,
//       addressHints,
//     },
//     platforms: platformHits,
//     severity,
//     confidence,
//     source: "rule",
//   };
// }

// function maxSeverity(a, b) {
//   const rank = { low: 0, medium: 1, high: 2, critical: 3 };
//   return rank[b] > rank[a] ? b : a;
// }

// module.exports = perceptionLayer;
