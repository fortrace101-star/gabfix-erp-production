const fs = require('fs');
const path = require('path');
const testDir = 'c:\\Users\\manue\\Desktop\\gabfix\\FinanceMgt\\Gabfix-ERP\\server\\test';
fs.readdirSync(testDir).forEach((f) => {
  const full = path.join(testDir, f);
  const s = fs.readFileSync(full, 'utf8');
  const imgs = s.match(/from\s+['"]([^'"]+)['"]/g) || [];
  const tsx = imgs.filter((m) => m.includes('tsx'));
  if (tsx.length) console.log(f, '=>', tsx.join(', '));
});
