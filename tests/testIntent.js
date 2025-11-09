// server/tests/testIntent.js
require("dotenv").config();
const perceptionLayer = require("../utils/perceptionLayer");
const intentLayer = require("../utils/intentLayer");

(async () => {
  const examples = [
    "I'm so angry that they leaked my phone number online!",
    "Should I report this to the police?",
    "ok bye",
    "I can't stop crying.",
    "They exposed my IP address online and I feel scared.",
  ];

  for (const text of examples) {
    console.log("🟩 Input:", text);

    // 1️⃣ 调用感知层（带 LLM fallback）
    const perception = await perceptionLayer(text, {
      useLLM: true,
      minConfidence: 0.5,
    });
    console.log("🧩 Perception:", perception.tags, perception.severity);

    // 2️⃣ 调用意图层
    const intent = await intentLayer(text, perception, {
      useLLM: true,
      minConfidence: 0.6,
    });
    console.log("🎯 Intent:", intent);

    console.log("------------------------------------------------------\n");
  }
})();
