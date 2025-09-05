// AST analysis tool definitions
// Structural code analysis and transformation tools

import { createSearchSchema, createAstSchema, createToolDefinition } from './tool-schemas.js';

// Search tools
export const searchTools = [
  createToolDefinition(
    "searchcode",
    "**INTELLIGENT CODE DISCOVERY** - AI-powered semantic search with structural understanding. **ALWAYS USE THIS FIRST** for code exploration.",
    createSearchSchema()
  )
];

// AST analysis tools
export const astTools = [
  createToolDefinition(
    "astgrep_search",
    "**STRUCTURAL CODE ANALYSIS** - AST-based pattern matching for precise code discovery.",
    createAstSchema({
      context: {
        type: "number",
        description: "Optional number of context lines (default: 3, recommended: 3-5)"
      },
      strictness: {
        type: "string",
        enum: ["cst", "smart", "ast", "relaxed"],
        description: "Pattern matching strictness: 'smart' (recommended), 'ast' (precise)"
      },
      outputFormat: {
        type: "string", 
        enum: ["compact", "pretty"],
        description: "Output format: 'compact' (scanning), 'pretty' (detailed)"
      }
    })
  ),

  createToolDefinition(
    "astgrep_replace",
    "**INTELLIGENT CODE TRANSFORMATION** - AST-based code rewriting with meta-variable substitution.",
    createAstSchema({
      replacement: {
        type: "string",
        description: "Replacement pattern with meta-variable substitutions"
      },
      dryRun: {
        type: "boolean",
        description: "**RECOMMENDED** - Preview changes without applying (always use first)"
      },
      interactive: {
        type: "boolean",
        description: "Enable interactive confirmation for each transformation"
      }
    })
  ),

  createToolDefinition(
    "astgrep_lint", 
    "**COMPREHENSIVE CODE QUALITY ENFORCEMENT** - YAML-based rule engine for structural code validation.",
    {
      type: "object",
      properties: {
        rules: {
          type: "string",
          description: "YAML rule content or path to rule file within working directory"
        },
        workingDirectory: {
          type: "string",
          description: "**REQUIRED** - Working directory containing code to validate"
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional specific paths within working directory to validate"
        },
        severity: {
          type: "string",
          enum: ["error", "warning", "info", "hint"],
          description: "Minimum severity level to report (recommended: start with 'error')"
        },
        format: {
          type: "string",
          enum: ["json", "text"],
          description: "Output format: 'json' (programmatic), 'text' (human-readable)"
        }
      },
      required: ["rules", "workingDirectory"]
    }
  ),

  createToolDefinition(
    "astgrep_analyze",
    "**DEEP STRUCTURAL CODE INVESTIGATION** - AST exploration and pattern debugging tool.",
    createAstSchema({
      analysisType: {
        type: "string",
        enum: ["pattern", "structure", "debug"],
        description: "Type of analysis: 'pattern' (pattern testing), 'structure' (AST exploration)"
      }
    })
  )
];

// Batch execution tool
export const batchTools = [
  createToolDefinition(
    "batch_execute",
    "**COMPREHENSIVE BATCH OPERATIONS** - Execute multiple MCP tools in coordinated workflows.",
    {
      type: "object", 
      properties: {
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool: { type: "string", description: "Tool name to execute" },
              arguments: { type: "object", description: "Tool arguments" }
            },
            required: ["tool", "arguments"]
          },
          description: "Array of tool operations to execute in sequence"
        },
        workingDirectory: {
          type: "string",
          description: "**REQUIRED** - Working directory for all batch operations"
        }
      },
      required: ["operations", "workingDirectory"]
    }
  )
];