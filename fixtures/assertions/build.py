import io, json, pathlib, tarfile, sys
root = pathlib.Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
for scenario in ['package', 'private', 'symlink', 'traversal']:
    manifest = {'name': 'compatlab-ci-fixture', 'version': '1.0.0', 'main': 'index.js',
                'scripts': {'install': "node -e \"require('fs').writeFileSync('/workspace/script-ran','yes')\""}}
    if scenario == 'private':
        manifest['private'] = True
    with tarfile.open(root / f'{scenario}.tgz', 'w:gz') as archive:
        for name, text in {'package.json': json.dumps(manifest), 'index.js': 'module.exports = value => value + 1;\n'}.items():
            content = text.encode()
            entry = tarfile.TarInfo(f'package/{name}')
            entry.size, entry.mode, entry.mtime = len(content), 0o644, 0
            archive.addfile(entry, io.BytesIO(content))
        if scenario == 'symlink':
            entry = tarfile.TarInfo('package/escape')
            entry.type, entry.linkname = tarfile.SYMTYPE, '../../../../outside'
            archive.addfile(entry)
        if scenario == 'traversal':
            entry = tarfile.TarInfo('package/../../escape')
            entry.size = 6
            archive.addfile(entry, io.BytesIO(b'escape'))
