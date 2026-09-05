let localKey = "AQ.Ab8RN6L0hrA3vjPg79g5cavq6McSOPZ817MLeR4uo9qdU3C9AA";

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
