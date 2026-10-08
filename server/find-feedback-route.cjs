const fs = require('fs');
fs.readdirSync('c:\\Users\\manue\\Desktop\\gabfix\\FinanceMgt\\Gabfix-ERP\\server\\routes').forEach((f) => {
  if (!f.endsWith('.ts') || f === 'orders.ts') return;
  const s = fs.readFileSync('c:\\Users\\manue\\Desktop\\gabfix\\FinanceMgt\\Gabfix-ERP\\server\\routes\\' + f, 'utf8');
  s.split(/\r?\n/).forEach((l, i) => {
    const low = l.toLowerCase();
    if (low.includes('feedback') || low.includes('/feedback') || low.includes('rating')) {
      console.log(f + ':' + (i + 1) + ': ' + l.trim());
    }
  });
});
