const fs = require('fs');
const s = fs.readFileSync('c:\\tmp\\full.log', 'utf8');
const lines = s.split(/\r?\n/);
let cur = null;
const res = [];
for (const l of lines) {
  if (/^# Subtest:/.test(l)) { cur = l.replace('# Subtest: ', ''); res.push({ status: '?', id: cur }); }
  if (/^ok \d/.test(l) && cur) { res.push({ status: 'ok', id: cur }); cur = null; }
  if (/^not ok \d/.test(l) && cur) { res.push({ status: 'not ok', id: cur }); cur = null; }
}
const grouped = res.reduce((acc, x) => { (acc[x.id] = acc[x.id] || []).push(x.status); return acc; }, {});
for (const [id, st] of Object.entries(grouped)) {
  console.log((st.includes('not ok') ? 'FAIL ' : st.includes('ok') ? 'PASS ' : '??? ') + '#' + id);
}
console.log('total subtests:', res.length);
