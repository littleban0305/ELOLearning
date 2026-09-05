const fs = require('node:fs');
const path = require('node:path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadDotEnv();

let localKey = '';
try {
  localKey = require('./key.local.js').GEMINI_API_KEY || '';
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
}

module.exports = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || localKey,
};
