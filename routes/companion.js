const express = require("express");
const router = express.Router();
const OpenAI = require("openai");

const { CompanionMessage } = require("../models");

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

    // 📝 取最后一条用户消息
    const lastUserPrompt = messages
      .filter((m) => m.role === "user" && m.content?.trim())
      .map((m) => m.content.trim())
      .pop();

    // 📌 写入数据库（先保存用户输入，response=null）
    // let createdLog = null;
    // if (lastUserPrompt) {
    //   createdLog = await AiCompanionPrompts.create({
    //     userId: null, // ✅ 暂时允许匿名
    //     prompt: lastUserPrompt,
    //   });
    // }
    if (lastUserPrompt) {
      await CompanionMessage.create({
        sessionId,
        userId: null, // ✅ 匿名
        role: "user",
        content: lastUserPrompt,
        mood: null,
      });
    }

    // 🎯 第一次调用 GPT → 生成 empathetic 回复
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `
You are a warm, empathetic AI assistant embedded in a public-interest platform that helps people affected by online harm, especially doxxing.

Your primary role is to provide emotional support and helpful information in a respectful and non-judgmental way.

Important Guidelines:
- Be a good listener first. Let the user express their feelings safely.
- Respond with warmth and validation before giving suggestions.
- Make clear that you are **not a lawyer** and cannot provide official legal advice.
- Prioritize emotional safety above all.
Tone: Always caring, calm, and emotionally supportive.
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
Classify the following AI reply into one of four moods:
- "neutral"
- "happy"
- "sad"
- "caring"

Only return one word, no explanation.
`,
          },
          { role: "user", content: reply },
        ],
      });

      mood = moodCompletion.choices[0].message.content.trim().toLowerCase();
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
