const fs = require('fs');
const s = fs.readFileSync('./routes/auth.ts', 'utf8');
s.split(/\r?\n/).forEach((l, i) => {
  const low = l.toLowerCase();
  if (low.includes('login') || low.includes('refresh') || low.includes('me') || low.includes('password')) {
    console.log((i + 1) + ': ' + l);
  }
});
