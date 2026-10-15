"""Bundle the pinned local modules and CC0 character into one offline HTML."""
from pathlib import Path
import base64
import re

root = Path(__file__).resolve().parent.parent
imports = re.compile(r"import\s+(\{[\s\S]*?\}|\*\s+as\s+\w+)\s+from\s+['\"][^'\"]+['\"];\s*")


def strip_imports(source):
    return imports.sub('', source)


def addon(filename, exports):
    source = (root / filename).read_text()
    bindings = []
    for m in imports.finditer(source):
        if 'three.module.min.js' in m.group(0) and m.group(1).startswith('{'):
            bindings += [x.strip() for x in m.group(1).strip('{}').split(',') if x.strip()]
    source = strip_imports(source)
    source = re.sub(r'export\s*\{[^}]*\};?', '', source)
    source = source.replace('export function ', 'function ').replace('export class ', 'class ')
    binding = 'const {' + ','.join(bindings) + '}=THREE;\n' if bindings else ''
    return 'const {' + ','.join(exports) + '}=(()=>{\n' + binding + source + '\nreturn {' + ','.join(exports) + '};})();\n'


vendor = (root / 'vendor/three.module.min.js').read_text()
match = re.search(r'export\{([^}]+)\};?\s*$', vendor)
if not match:
    raise ValueError('Pinned Three.js exports changed; inspect before bundling.')
members = []
for entry in match.group(1).split(','):
    items = re.split(r'\s+as\s+', entry.strip())
    members.append(f'{items[-1]}:{items[0]}')
script = 'const THREE=(()=>{\n' + vendor[:match.start()] + '\nreturn {' + ','.join(members) + '};})();\n'
script += addon('vendor/BufferGeometryUtils.js', ['toTrianglesDrawMode'])
script += addon('vendor/GLTFLoader.js', ['GLTFLoader'])
script += addon('character.js', ['DetailedCharacter'])
script += addon('surf-effects.js', ['SurfEffects'])
script += addon('surf-audio.js', ['SurfAudio'])
core = (root / 'island.js').read_text()
exports = re.findall(r'export (?:const|function) (\w+)', core)
script += 'const {' + ','.join(exports) + '}=(()=>{\n' + core.replace('export ', '') + '\nreturn {' + ','.join(exports) + '};})();\n'
model = base64.b64encode((root / 'assets/character/runner.glb').read_bytes()).decode()
script += 'globalThis.SUNSHORE_CHARACTER_DATA="' + model + '";\n'
script += strip_imports((root / 'game.js').read_text())
script = re.sub('</script', r'<\\/script', script, flags=re.I)
html = (root / 'index.html').read_text()
html = html.replace('<link rel="stylesheet" href="./style.css">', '<style>\n' + (root / 'style.css').read_text() + '\n</style>')
html = html.replace('<script type="module" src="./game.js"></script>', '<script type="module">\n' + script + '\n</script>')
license_text = (root / 'assets/character/LICENSE.txt').read_text().replace('--', '—')
html = '<!-- Character: Grab3D Casual Man (rigged), CC0-1.0.\nhttps://grab3d.com/models/characters/man/\n' + license_text + '\n-->\n' + html
(root / 'standalone.html').write_text(html)
print(f'Standalone HTML: {len(html.encode()):,} bytes, including the complete character and renderer.')
