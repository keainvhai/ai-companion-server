module.exports = (sequelize, DataTypes) => {
  const CompanionMessage = sequelize.define(
    "CompanionMessage",
    {
      sessionId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      role: {
        type: DataTypes.ENUM("user", "assistant"),
        allowNull: false,
      },
      content: {
        type: DataTypes.TEXT("long"),
        allowNull: false,
      },
      mood: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // ✅ 新增字段
      source: {
        type: DataTypes.ENUM("text", "virtual-human"),
        allowNull: false,
        defaultValue: "text",
      },
      emotion: { type: DataTypes.STRING, allowNull: true },
      transcript: { type: DataTypes.TEXT, allowNull: true },
      meta: {
        type: DataTypes.JSON, // ← 用来存每层分析结果
        allowNull: true,
      },
    },

    {
      tableName: "CompanionMessages",
      freezeTableName: true,
      indexes: [{ fields: ["sessionId"] }, { fields: ["createdAt"] }],
    }
  );

  return CompanionMessage;
};
