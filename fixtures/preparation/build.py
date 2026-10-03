import base64
import hashlib
import io
import json
import os
import random
import sys
import tarfile

output = sys.argv[1]
os.makedirs(output, exist_ok=True)


def archive(name, manifest, entries=None):
    filename = os.path.join(output, name + '.tgz')
    files = {'package/package.json': json.dumps(manifest).encode(), 'package/index.js': b'module.exports = 1;'}
    files.update(entries or {})
    with tarfile.open(filename, 'w:gz', format=tarfile.PAX_FORMAT) as tar:
        for path, contents in files.items():
            info = tarfile.TarInfo(path)
            info.mode = 0o644
            if isinstance(contents, tuple):
                info.type = tarfile.SYMTYPE
                info.linkname = contents[0]
                tar.addfile(info)
            else:
                info.size = len(contents)
                tar.addfile(info, io.BytesIO(contents))
    with open(filename, 'rb') as source:
        integrity = 'sha512-' + base64.b64encode(hashlib.sha512(source.read()).digest()).decode()
    return {'name': manifest['name'], 'version': manifest['version'], 'file': filename, 'integrity': integrity, 'tarballUrl': 'https://registry.npmjs.org/' + manifest['name'] + '/-/' + name + '.tgz', 'manifest': manifest}


def package(name, **kwargs):
    return {'name': 'compatlab-fixture-' + name, 'version': '1.0.0', **kwargs}


def sentinel(name):
    return "node -e \"require('node:fs').writeFileSync('/workspace/" + name + "-script-ran','unsafe')\""


dep = archive('dep', package('dep', scripts={'preinstall': sentinel('dependency'), 'postinstall': sentinel('dependency')}))
optional = archive('optional', package('optional', os=['darwin']))
bundle = package('bundled', scripts={'install': sentinel('bundled')})
root_manifest = package('root', dependencies={dep['name']: '1.0.0', 'compatlab-fixture-alias': 'npm:' + dep['name'] + '@1.0.0', bundle['name']: '1.0.0'}, optionalDependencies={optional['name']: '1.0.0'}, bundledDependencies=[bundle['name']], scripts={'preinstall': sentinel('root'), 'install': sentinel('root'), 'postinstall': sentinel('root')}, bin={'compatlab-fixture-bin': 'bin.cjs'})
root = archive('root', root_manifest, {'package/bin.cjs': b'#!/usr/bin/env node\nmodule.exports=1;', 'package/node_modules/' + bundle['name'] + '/package.json': json.dumps(bundle).encode(), 'package/node_modules/' + bundle['name'] + '/index.js': b'module.exports=1;'})
traversal = archive('traversal', package('traversal'), {'package/../../escape': b'escape', '/tmp/compatlab-archive-escape': b'escape'})
links = archive('links', package('links'), {'package/escape': ('/etc/passwd',), 'package/relative-escape': ('../../../../etc/passwd',)})
compression = archive('compression', package('compression'), {'package/big.bin': bytes(80 * 1024 * 1024)})
expanded = archive('expanded', package('expanded'), {'package/big.bin': random.Random(0).randbytes(20 * 1024 * 1024) + bytes(60 * 1024 * 1024)})
inodes = archive('inodes', package('inodes'), {'package/files/' + str(i): b'' for i in range(2000)})
with open(os.path.join(output, 'fixtures.json'), 'w') as file:
    json.dump({'root': root, 'dep': dep, 'optional': optional, 'traversal': traversal, 'links': links, 'compression': compression, 'expanded': expanded, 'inodes': inodes}, file)
