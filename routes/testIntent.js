const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const perceptionLayer = require("../utils/perceptionLayer");
const intentLayer = require("../utils/intentLayer");

require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.API_KEY });

router.post("/", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });

    // ✅ 调用感知层（useLLM:true）
    const perception = await perceptionLayer(text, {
      useLLM: true,
      openaiClient: openai,
      minConfidence: 0.5,
    });

    // ✅ 调用意图层（useLLM:true）
    const intent = await intentLayer(text, perception, {
      useLLM: true,
      openai: openai,
      minConfidence: 0.6,
    });

    res.json({ text, perception, intent });
  } catch (err) {
    console.error("Test-intent error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
