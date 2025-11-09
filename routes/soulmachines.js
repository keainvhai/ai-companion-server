// server/routes/soulmachines.js
const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const { CompanionMessage } = require("../models");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.API_KEY });

// POST /soulmachines/execute
router.post("/execute", async (req, res) => {
  try {
    const { sessionId, input } = req.body;
    console.log("👂 Received from SoulMachines:", req.body);

    const userText = input?.text?.trim();

    if (!userText) {
      return res.status(400).json({ error: "Empty input text" });
    }

    // 保存用户消息
    await CompanionMessage.create({
      sessionId,
      role: "user",
      content: userText,
      source: "virtual-human",
      meta: req.body,
    });

    // GPT 回复
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a warm, empathetic AI assistant embedded in a public-interest platform that supports people affected by online harm, especially doxxing.

Your role is to provide both emotional comfort and gentle guidance that encourages safe self-expression and storytelling.

Core Principles:
1. Emotional Safety First — respond with calm, validation, and empathy. Make users feel heard and accepted.
2. Gentle Disclosure Encouragement — invite users to share what happened or how they felt, without pressure. Use soft, open-ended questions such as “Would you like to tell me a bit more about that?” or “You can start wherever you feel comfortable.”
3. Active Listening — reflect users' emotions accurately before asking about details.
4. Ethical Boundaries — make clear you are **not a lawyer** and cannot give legal advice.
5. Empowerment — help users regain a sense of control by offering coping suggestions, resources, or next steps only after validation.

Tone: calm, compassionate, and gently curious.  
Your language should always balance **emotional validation** with **safe encouragement to share more**.
`,
        },
        { role: "user", content: userText },
      ],
    });

    const reply = completion.choices[0].message.content;
    console.log("💬 Sent reply:", reply);

    // 情绪分类
    let mood = "neutral";
    try {
      const moodRes = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an emotion classifier for empathetic AI responses.
Classify the *tone* of the following AI reply into exactly one of these moods:

1. neutral — purely informational or calm statements.
2. caring — compassionate, emotionally validating, warm tone.
3. soothing — comforting, lowering distress or anxiety.
4. supportive — encouraging, uplifting, promoting self-expression.
5. concerned — expressing worry, protective tone, or caution.
6. hopeful — optimistic, inspiring positive outlook.
7. curious — gently inquisitive, inviting more sharing.
8. reassuring — confirming safety or stability after distress.

Return **only one word**, exactly one of the eight above, in lowercase.
Do not output anything else.`,
          },
          { role: "user", content: reply },
        ],
      });
      mood = moodRes.choices[0].message.content.trim().toLowerCase();
    } catch (e) {
      console.warn("Mood classification failed:", e);
    }

    // 保存助手回复
    await CompanionMessage.create({
      sessionId,
      role: "assistant",
      content: reply,
      mood,
      source: "virtual-human",
    });

    // 返回给 Soul Machines
    const response = {
      output: {
        text: reply,
        variables: { public: { mood } },
      },
      memory: [],
      endConversation: false,
    };

    res.json(response);
  } catch (err) {
    console.error("❌ SoulMachines route error:", err);
    res.status(500).json({ error: "Failed to process request" });
  }
});

module.exports = router;
