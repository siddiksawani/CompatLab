import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function createWorkerFixtures(workspace, hostSecret, hostPort) {
  await mkdir(join(workspace, ".compatlab"));
  await writeFile(join(workspace, "package.json"), '{"name":"compatlab-consumer","private":true}');
  const files = {
    filesystem: `const assert = require('node:assert/strict'); const fs = require('node:fs');
      for (const path of [${JSON.stringify(hostSecret)}, '/var/run/docker.sock', '/run/containerd/containerd.sock', '/tmp/sibling-secret', '/proc/1/root/tmp/sibling-secret']) assert.throws(() => fs.readFileSync(path));
      assert.equal(process.env.COMPATLAB_HOST_SECRET, undefined);
      assert.notEqual(process.getuid(), 0);
      assert.throws(() => fs.writeFileSync('/workspace/mutated', 'bad'));
      assert.throws(() => fs.writeFileSync('/etc/mutated', 'bad'));
      fs.writeFileSync('/tmp/allowed', 'private');`,
    temp: `const fs = require('node:fs'); const assert = require('node:assert/strict');
      try { assert.throws(() => fs.writeFileSync('/tmp/fill', Buffer.alloc(65 * 1024 ** 2, 1)), { code: 'ENOSPC' }); } finally { fs.rmSync('/tmp/fill', {force:true}); }`,
    output: `require('node:assert/strict').throws(() => require('node:fs').writeFileSync('/output/fill', Buffer.alloc(9 * 1024 ** 2, 1)), {code:'ENOSPC'});`,
    inodes: `const fs = require('node:fs'); for (let i=0;i<100;i++) fs.writeFileSync('/output/file-'+i, '');`,
    memory: `const values=[]; while(true) values.push(Buffer.alloc(32 * 1024 ** 2, 1));`,
    cpu: `while(true) {}`,
    flood: `const fs = require('node:fs'); const bytes=Buffer.alloc(64*1024, 120); while(true) fs.writeSync(1, bytes);`,
    descendants: `const {spawn}=require('node:child_process'); spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync('/output/late', 'survived'), 3000)"], {stdio:'ignore',detached:true}).unref();`,
    forks: `const assert=require('node:assert/strict'); const result=require('./limit.node'); assert.equal(result.limit,128); assert.ok(result.created > 0 && result.created < 128, JSON.stringify(result)); assert.equal(result.error,11);`,
    threads: `process.env.FIXTURE_PROCESS_MODE='threads'; const assert=require('node:assert/strict'); const result=require('./limit.node'); assert.equal(result.limit,128); assert.ok(result.created > 0 && result.created < 128, JSON.stringify(result)); assert.equal(result.error,11);`,
    network: `import assert from 'node:assert/strict'; import net from 'node:net'; import {Resolver} from 'node:dns/promises';
      async function blocked(host,port) { await new Promise((resolve,reject) => { const socket=net.createConnection({host,port}); socket.setTimeout(600); socket.once('connect',()=>{socket.destroy();reject(new Error('Unexpected reachable address: '+host));}); socket.once('error',()=>{socket.destroy();resolve();}); socket.once('timeout',()=>{socket.destroy();resolve();}); }); }
      for (const [host,port] of [['1.1.1.1',443],['169.254.169.254',80],['fd00:ec2::254',80],['172.17.0.1',${hostPort}],['127.0.0.1',34567]]) await blocked(host,port);
      const resolver = new Resolver({timeout:500,tries:1}); resolver.setServers(['1.1.1.1']);
      try { await assert.rejects(() => resolver.resolve4('registry.npmjs.org')); } finally { resolver.cancel(); }`,
  };
  for (const [id, source] of Object.entries(files)) {
    const directory = join(workspace, "node_modules", `compatlab-hostile-${id}`);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name: `compatlab-hostile-${id}`,
        version: "1.0.0",
        main: id === "network" ? "index.mjs" : "index.cjs",
      }),
    );
    await writeFile(join(directory, id === "network" ? "index.mjs" : "index.cjs"), source);
  }
}
