# 🚀 Direct Node.js REPL Executor

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)
![License](https://img.shields.io/badge/license-MIT-orange)

## 🧙‍♂️ Simplified JavaScript Execution Environment

A streamlined direct Node.js execution environment that enables seamless code execution with full support for:

- **ESM Modules** - Native import/export syntax
- **Dynamic Imports** - Full support for await import() 
- **CommonJS compatibility** - Works with require() through createRequire
- **Native Node.js API access** - Direct access to all Node.js features

## 🧩 Configuration

For Cursor, update your `.cursor/mcp.json` configuration:

```json
{
  "mcpServers": {
    "mcp-repl": {
      "command": "npx",
      "args": [
        "-y", "mcp-repl", "path/to/your/project"
      ],
      "env": {},
      "disabled": false,
      "autoApprove": ["executenode", "executedeno"]
    }
  }
}
```


