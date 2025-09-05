#!/usr/bin/env node
import fs from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

async function main() {
  const repoRoot = path.dirname(fileURLToPath(import.meta.url));
  const jsonPath = path.resolve(repoRoot, '../src/tool-descriptions.json');
  const defsPath = path.resolve(repoRoot, '../src/tool-definitions.js');

  // Load implemented tools from code
  const defsUrl = pathToFileURL(defsPath).href;
  const defsModule = await import(defsUrl);
  const getAllTools = defsModule.getAllTools || defsModule.default?.getAllTools;
  if (!getAllTools) {
    console.error('Could not find getAllTools() in src/tool-definitions.js');
    process.exit(2);
  }
  const implemented = (Array.isArray(getAllTools) ? getAllTools : getAllTools()).map(t => t.name).filter(Boolean);

  // Read JSON
  const raw = await fs.readFile(jsonPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed.tools) {
    console.error('tool-descriptions.json missing tools key');
    process.exit(2);
  }

  // Backup original
  const backupPath = jsonPath + '.bak.' + Date.now();
  await fs.copyFile(jsonPath, backupPath);
  console.error(`Backed up original to ${backupPath}`);

  if (Array.isArray(parsed.tools)) {
    const before = parsed.tools.length;
    parsed.tools = parsed.tools.filter(t => implemented.includes(t.name));
    const after = parsed.tools.length;
    await fs.writeFile(jsonPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    console.error(`Pruned tool-descriptions.json (array): ${before} -> ${after} entries`);
  } else if (typeof parsed.tools === 'object') {
    const keys = Object.keys(parsed.tools);
    const before = keys.length;
    const filtered = {};
    for (const k of keys) {
      if (implemented.includes(k)) filtered[k] = parsed.tools[k];
    }
    parsed.tools = filtered;
    const after = Object.keys(filtered).length;
    await fs.writeFile(jsonPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    console.error(`Pruned tool-descriptions.json (object): ${before} -> ${after} entries`);
  } else {
    console.error('Unrecognized tools shape in tool-descriptions.json');
    process.exit(2);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
