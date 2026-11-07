import { readdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, join } from 'path';

const rootDir = resolve('c:/Users/rajmo/test/datasets/f1-simulator');
const testsDir = resolve(rootDir, 'tests');
const files = readdirSync(testsDir).filter(f => f.startsWith('test_') && f.endsWith('.mjs'));

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
  console.log(`Failed files:`);
  for (const f of failures) {
    console.log(`\n--- ${f.file} ---`);
    console.log(f.error);
  }
  process.exit(1);
} else {
  console.log(`🎉 100% OF ALL ${files.length} TEST SUITES PASSED CLEANLY!`);
}
