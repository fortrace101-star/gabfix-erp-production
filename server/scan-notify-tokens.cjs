const fs = require('fs');
const s = fs.readFileSync('./services/notifications.ts', 'utf8');
console.log('--- dispatchEvent body (first 40 lines) ---');
s.split(/\r?\n/).slice(630, 700).forEach((l, i) => console.log((i + 631) + ': ' + l));
