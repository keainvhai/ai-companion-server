// server/index.js
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const db = require("./models");

const app = express();
app.use(cors());
app.use(express.json());

// 测试路由
app.get("/", (req, res) => {
  res.send("AI Companion backend is running!");
});

// 引入路由
const companionRoutes = require("./routes/companion");
app.use("/companion", companionRoutes);

// 测试数据库连接
db.sequelize
  .authenticate()
  .then(() => {
    console.log("✅ Database connected successfully!");

    // 🔎 测试能否查到 AiCompanionPrompts 表里的数据
    // return db.AiCompanionPrompts.findAll({ limit: 1 });
  })
  .then((rows) => {
    // console.log("✅ Sample row:", rows[0]?.toJSON() || "No data yet");
  })
  .catch((err) => {
    console.error("❌ Database connection failed:", err);
  });

// 启动服务器
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
