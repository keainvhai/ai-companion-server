const { Sequelize, DataTypes } = require("sequelize");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

// 初始化 sequelize
const sequelize = new Sequelize(
  process.env.DB_NAME, // doxxing_db
  process.env.DB_USER, // root 或你的用户名
  process.env.DB_PASS, // 数据库密码
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: process.env.DB_DIALECT || "mysql",
    logging: false, // 不打印 SQL 日志
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false, // Aiven 要求 SSL，这样可以避免证书验证错误
      },
    },
  }
);

const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;

// 引入 AiCompanionPrompts 模型
db.CompanionMessage = require("./CompanionMessage")(sequelize, DataTypes);

module.exports = db;
