import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const mode = process.argv[2];
const deadline = setTimeout(() => { console.error('diagnostic deadline exceeded'); process.exit(124); }, 15000);
try {
  if (mode === 'nested') {
    const { default: createImportFresh } = await import('/study/import-fresh-suite/index.js');
    const fresh = createImportFresh('file:///study/import-fresh-suite/tests/test.js');
    console.log('before nested import');
    const result = await fresh('./fixtures/top-level-await.js');
    assert.equal(result.default(), 1);
  } else {
    assert.ok(mode === 'als' || mode === 'hook');
    globalThis.diagnosticStorage = new AsyncLocalStorage();
    const file = '/study/als-child.mjs';
    writeFileSync(file, `export const observed = globalThis.diagnosticStorage.getStore(); console.log('child store', observed);`);
    if (mode === 'hook') registerHooks({ resolve(specifier, context, next) { return next(specifier, context); } });
    await globalThis.diagnosticStorage.run('expected', async () => {
      const result = await import(pathToFileURL(file).href);
      console.log('parent store', globalThis.diagnosticStorage.getStore());
      assert.equal(result.observed, 'expected');
    });
  }
  console.log('diagnostic completed', mode);
} finally {
  clearTimeout(deadline);
}
