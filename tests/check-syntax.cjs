const fs = require('node:fs');
const vm = require('node:vm');
for (const file of ['appearance.js', 'folder-import.js', 'canvas.js', 'project-io.js', 'workspace-state.js', 'pointer-tools.js', 'delivery.js', 'background-image.js', 'maintenance.js', 'sw.js']) {
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
}
const html = fs.readFileSync('index.html', 'utf8');
for (const [i, match] of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].entries()) {
  new vm.Script(match[1], { filename: `index.html:inline-${i}` });
}
JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
JSON.parse(fs.readFileSync('manus-routes.json', 'utf8'));
console.log('HTML scripts, JavaScript modules and JSON syntax: PASS');
