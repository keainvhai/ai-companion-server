// server/tests/testPerception.js
require("dotenv").config();
const perceptionLayer = require("../utils/perceptionLayer");

(async () => {
  const examples = [
    "Someone leaked my address on Twitter",
    "I'm so angry and shaking right now!",
    "Can you tell me what to do next?",
    "ok bye",
  ];

  for (const text of examples) {
    console.log("🟦 Input:", text);

    // ✅ 改成 await，并传入参数对象
    const result = await perceptionLayer(text, {
      useLLM: true, // ✅ 启用 LLM fallback（需要 API_KEY）
      minConfidence: 0.5,
    });

    console.log("Output:", result);
    console.log("------------------------------------------------------\n");
  }
})();
