const { generateForCli } = require('./server-logic');

const mode = (process.argv[2] || 'summary').toLowerCase();
const topic = process.argv.slice(3).join(' ') || '國文課文重點';

if (!['summary', 'quiz'].includes(mode)) {
  console.error('mode 只能是 summary 或 quiz');
  process.exit(1);
}

generateForCli({ mode, topic })
  .then((result) => console.log(result.text))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
