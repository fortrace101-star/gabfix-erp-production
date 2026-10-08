const { execSync } = require('child_process');
const path = require('path');
const tscPath = path.join(__dirname, 'node_modules', '.bin', 'tsc');
const tsconfigPath = path.join(__dirname, 'tsconfig.json');
try {
  const output = execSync('"' + tscPath + '" --noEmit -p "' + tsconfigPath + '"', {
    encoding: 'utf8',
    cwd: __dirname,
    maxBuffer: 1024 * 1024 * 10,
    timeout: 120000,
  });
  console.log(output);
} catch (e) {
  console.log(e.stdout || e.stderr || e.message);
}
