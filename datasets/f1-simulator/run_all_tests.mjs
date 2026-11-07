import { readdirSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const testsDir = resolve(rootDir, 'tests');
const files = readdirSync(testsDir).filter(f => f.startsWith('test_') && f.endsWith('.mjs'));

// Auto-boot simulator server if not already running on http://127.0.0.1:8765
let localServerProc = null;
try {
  const check = await fetch('http://127.0.0.1:8765/health');
  const d = await check.json();
  if (d.status !== 'healthy') throw new Error('Unhealthy');
} catch (_) {
  const serverPath = resolve(rootDir, 'server.js');
  localServerProc = spawn(process.execPath, [serverPath], {
    cwd: rootDir,
    stdio: 'ignore',
    detached: false
  });
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch('http://127.0.0.1:8765/health');
      if (res.ok) break;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
}

console.log(`\n======================================================`);
console.log(`🚀 RUNNING ALL ${files.length} SIMULATOR TEST SUITES FROM tests/`);
console.log(`======================================================\n`);

let passed = 0;
let failed = 0;
const failures = [];

for (const file of files) {
  process.stdout.write(`▶ Testing ${file.padEnd(45)} `);
  let ok = false;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      execSync(`node "${join(testsDir, file)}"`, { cwd: rootDir, stdio: 'pipe' });
      ok = true;
      break;
    } catch (err) {
      lastErr = err;
      execSync('node -e "setTimeout(()=>{}, 1500)"');
    }
  }
  if (ok) {
    console.log(`✅ PASS`);
    passed++;
  } else {
    console.log(`❌ FAIL`);
    failed++;
    failures.push({ file, error: lastErr?.stderr?.toString() || lastErr?.stdout?.toString() });
  }
}

console.log(`\n======================================================`);
console.log(`TOTAL SUITES: ${files.length} | PASSED: ${passed} | FAILED: ${failed}`);
console.log(`======================================================\n`);

if (failures.length > 0) {
  if (localServerProc) localServerProc.kill();
  console.log(`Failed files:`);
  for (const f of failures) {
    console.log(`\n--- ${f.file} ---`);
    console.log(f.error);
  }
  process.exit(1);
} else {
  if (localServerProc) localServerProc.kill();
  console.log(`🎉 100% OF ALL ${files.length} TEST SUITES PASSED CLEANLY!`);
}
