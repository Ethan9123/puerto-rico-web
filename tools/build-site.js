const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.site');
// Stage from a clean output directory so stale files cannot remain public.
fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
  const name = entry.name;
  if (entry.isFile() && (/\.(html|css|js|json|wasm)$/.test(name) || name === '_headers') && !['package.json', 'package-lock.json', 'supabase-config.js'].includes(name)) {
    fs.copyFileSync(path.join(root, name), path.join(out, name));
  }
}
function copyDirectory(source, target) {
  fs.mkdirSync(target, {recursive: true});
  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    if (entry.isDirectory()) copyDirectory(path.join(source, entry.name), path.join(target, entry.name));
    else fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
  }
}
for (const name of ['assets', 'nn_wasm']) {
  if (fs.existsSync(path.join(root, name))) copyDirectory(path.join(root, name), path.join(out, name));
}
// Wrangler reads ignore rules from its assets directory, not the repository root.
fs.copyFileSync(path.join(root, '.assetsignore'), path.join(out, '.assetsignore'));
console.log('Static site staged in .site');
