import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const mode = process.argv[2];
const deadline = setTimeout(() => { console.error('diagnostic deadline exceeded'); process.exit(124); }, 15000);
try {
  if (mode === 'trace-source') {
    const file = '/study/import-fresh-suite/index.js';
    let source = readFileSync(file, 'utf8');
    for (const [before, after] of [
      ['const parentFreshImportScope = getFreshImportScope();', `const parentFreshImportScope = getFreshImportScope(); console.log('trace enqueue', moduleSpecifier, JSON.stringify({parent: parentFreshImportScope?.cacheKey, active: runtimeState.activeFreshImportCount}));`],
      ['await previousFreshImport;', `await previousFreshImport; console.log('trace acquired', moduleSpecifier);`],
      ['runtimeState.activeFreshImportCount++;', `runtimeState.activeFreshImportCount++; console.log('trace import', moduleSpecifier, cacheKey);`],
      ['await waitForNextEventLoopTurn();\n\t\t\t\treturn loadedModule;', `console.log('trace loaded', moduleSpecifier); await waitForNextEventLoopTurn(); return loadedModule;`],
      ['releaseFreshImport();', `console.log('trace released', moduleSpecifier); releaseFreshImport();`],
    ]) {
      assert.equal(source.split(before).length, 2);
      source = source.replace(before, after);
    }
    writeFileSync(file, source);
  } else if (mode === 'nested' || mode === 'sequence') {
    const { default: createImportFresh } = await import('/study/import-fresh-suite/index.js');
    const fresh = createImportFresh('file:///study/import-fresh-suite/tests/test.js');
    if (mode === 'sequence') {
      for (const fixture of ['increment.js', 'increment.js', 'parent.js', 'parent.js']) {
        const value = await fresh('./fixtures/' + fixture);
        assert.equal(value.default(), 1);
      }
    }
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
