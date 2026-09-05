let localKey = "";

try {
  localKey = require("./key.local.js").GEMINI_API_KEY || "";
} catch (err) {
  if (err.code !== "MODULE_NOT_FOUND") {
    throw err;
  }
}

module.exports = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || localKey,
};
