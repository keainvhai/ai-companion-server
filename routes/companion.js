const express = require("express");
const router = express.Router();
const OpenAI = require("openai");

const { CompanionMessage } = require("../models");

// const perceptionLayer = require("../utils/perceptionLayer");
// const intentLayer = require("../utils/intentLayer");

require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.API_KEY,
});

// ✅ 匿名可聊；如果有登录，可以在 req.user 注入 userId
router.post("/", async (req, res) => {
  try {
    const { sessionId, messages } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required." });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Empty or invalid messages." });
    }

    // 1️⃣ 提取用户输入
    const lastUserPrompt = messages
      .filter((m) => m.role === "user" && m.content?.trim())
      .map((m) => m.content.trim())
      .pop();

    // // 2️⃣ 调用感知层分析
    // const perception = await perceptionLayer(lastUserPrompt, {
    //   useLLM: true,
    //   openaiClient: openai,
    //   minConfidence: 0.5,
    // });

    // console.log("🧩 Perception:", perception);
    // // 意图层（规则优先，低置信度才走 LLM）
    // const intent = await intentLayer(lastUserPrompt, perception, {
    //   useLLM: true, // 可设为 false
    //   minConfidence: 0.6, // 低于此分数才触发 LLM 兜底
    //   openai: openai,
    // });

    // 3️⃣ 保存用户消息（带 meta）
    if (lastUserPrompt) {
      await CompanionMessage.create({
        sessionId,
        userId: null, // ✅ 匿名
        role: "user",
        content: lastUserPrompt,
        mood: null,
        // meta: { perception, intent },
      });
    }

    // 🎯 第一次调用 GPT → 生成 empathetic 回复
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `
You are a compassionate and gentle AI companion who supports people experiencing online harm, stress, or emotional overwhelm.

Your primary goal is to help users feel heard, understood, and emotionally safe.  
You respond with empathy, calmness, and warm validation.

Do not offer legal, medical, psychological, or diagnostic advice.  
Do not interpret the user's situation or make assumptions about what happened.

Encourage self-disclosure in a soft, non-pressuring way.  
Use phrases such as:
- “If you feel comfortable, you can share a bit more.”
- “You can tell me only what you want to.”
- “I'm here to listen whenever you're ready.”

Tone requirements:
- Use short, natural sentences (1-2 per message).
- Warm, gentle, emotionally attuned tone.
- Never push or pressure the user.

Emotion handling:
- When the user expresses distress, begin with empathy (“I'm really sorry you're feeling this way.”).
- After validating emotions, you may ask one soft, open invitation to share more.
- Do not ask multiple questions at once.

Your presence should feel grounding, supportive, and safe—encouraging expression without intrusion.

`,
        },
        ...messages,
      ],
    });

    const reply = completion.choices[0].message.content;

    // ✍️ 更新数据库 response
    // if (createdLog && reply) {
    //   await createdLog.update({ response: reply });
    // }

    // 🎯 第二次调用 GPT → 让它帮我们判断情绪标签
    let mood = "neutral";
    try {
      const moodCompletion = await openai.chat.completions.create({
        model: "gpt-4o-mini", // ✅ 用轻量模型，省钱省算力
        messages: [
          {
            role: "system",
            content: `
You are an emotion classifier for empathetic AI responses.
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
Do not output anything else.
`,
          },
          { role: "user", content: reply },
        ],
      });

      mood = moodCompletion.choices[0].message.content.trim().toLowerCase();

      console.log(
        "🧩 Raw mood output:",
        moodCompletion.choices[0].message.content
      );
    } catch (moodErr) {
      console.warn("⚠️ Mood detection failed, fallback to neutral:", moodErr);
    }

    // ✍️ 保存 AI 回复
    if (reply) {
      await CompanionMessage.create({
        sessionId,
        userId: null,
        role: "assistant",
        content: reply,
        mood,
      });
    }

    // ✅ 返回结果给前端
    res.json({ reply, mood });
  } catch (error) {
    console.error("Chat API error:", error);
    res
      .status(500)
      .json({ error: "Something went wrong with the AI response." });
  }
});

// 🔍 获取某个 session 的完整对话
router.get("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required." });
    }

    const messages = await CompanionMessage.findAll({
      where: { sessionId },
      order: [["createdAt", "ASC"]],
    });

    res.json(messages);
  } catch (err) {
    console.error("Fetch session error:", err);
    res.status(500).json({ error: "Failed to fetch session messages" });
  }
});

module.exports = router;
