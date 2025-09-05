import fs from 'fs';
import path from 'path';

const root = process.cwd();

// Load tool descriptions JSON
const descPath = path.join(root, 'src', 'tool-descriptions.json');
const descRaw = fs.readFileSync(descPath, 'utf8');
const descriptions = JSON.parse(descRaw).tools || {};
const describedToolNames = new Set(Object.keys(descriptions));

// Import getAllTools from the project (ESM) using file:// URL on Windows
const fileUrl = `file://${path.join(root, 'src', 'tool-definitions.js').replace(/\\/g, '/')}`;
const td = await import(fileUrl);
const getAllTools = td.getAllTools;
const defined = Array.isArray(getAllTools) ? getAllTools : getAllTools();

const definedNames = new Set(defined.map(t => t && t.name).filter(Boolean));

// Also include the dynamic sequentialthinking tool and potential batch_execute
// (some servers add these dynamically)
describedToolNames.add('batch_execute');

// Compare
const missingInDefined = [...describedToolNames].filter(n => !definedNames.has(n));
const extraInDefined = [...definedNames].filter(n => !describedToolNames.has(n));

console.log('Tool check report');
console.log('=================');
console.log(`Described tools (count): ${describedToolNames.size}`);
console.log(`Defined tools returned by getAllTools() (count): ${definedNames.size}`);
console.log('');
if (missingInDefined.length === 0) {
  console.log('All described tools are present in getAllTools().');
} else {
  console.log('Tools described in JSON but MISSING from getAllTools():');
  missingInDefined.forEach(t => console.log(`  - ${t}`));
}

if (extraInDefined.length === 0) {
  console.log('\nNo extra tools returned by getAllTools().');
} else {
  console.log('\nTools returned by getAllTools() but NOT present in descriptions JSON:');
  extraInDefined.forEach(t => console.log(`  - ${t}`));
}

// Print a short mapping for manual inspection
console.log('\nSample of defined tools objects (first 10):');
defined.slice(0, 10).forEach((t, i) => {
  console.log(` ${i + 1}. name=${t && t.name} desc=${t && (t.description ? '[has desc]' : '[no desc]')}`);
});

process.exit(missingInDefined.length === 0 && extraInDefined.length === 0 ? 0 : 2);
