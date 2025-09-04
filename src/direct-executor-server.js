#!/usr/bin/env node
// Simple Node.js direct executor server using MCP SDK

import * as path from 'node:path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Handle version flag
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

// Handle help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('MCP REPL - Code execution and semantic search server');
  console.log('Usage: mcp-repl [working-directory]');
  console.log('Options:');
  console.log('  --version, -v    Show version');
  console.log('  --help, -h       Show help');
  process.exit(0);
}

import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js"; 
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { validateWorkingDirectory } from './validation-utils.js';

// Lazy load vector indexer to avoid startup issues
let vectorIndexer = null;
const getVectorIndexer = async () => {
  if (!vectorIndexer) {
    vectorIndexer = await import('./js-vector-indexer.js');
  }
  return vectorIndexer;
};

// Lazy load ast-grep utilities
let astgrepUtils = null;
let astgrepAdvanced = null;
let astgrepHandlers = null;
let astgrepHandlersAdvanced = null;
const getAstGrepUtils = async () => {
  if (!astgrepUtils) {
    astgrepUtils = await import('./astgrep-utils.js');
  }
  if (!astgrepAdvanced) {
    astgrepAdvanced = await import('./astgrep-advanced.js');
  }
  if (!astgrepHandlers) {
    astgrepHandlers = await import('./astgrep-handlers.js');
  }
  if (!astgrepHandlersAdvanced) {
    astgrepHandlersAdvanced = await import('./astgrep-handlers-advanced.js');
  }
  return { astgrepUtils, astgrepAdvanced, astgrepHandlers, astgrepHandlersAdvanced };
};

// Get the working directory from command line or use current directory
const workingDir = process.argv[2] && !process.argv[2].startsWith('-')
    ? path.resolve(process.argv[2]) 
    : process.cwd();

// Initialize the MCP server
const server = new McpServer(
  {
    name: "direct-node-executor", 
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {}, // Enable tool support
    },
  }
);

// Initialize code search on startup
(async function initCodeSearch() {
  try {
    const { initialize, syncIndex } = await getVectorIndexer();
    await initialize();
    // Perform initial indexing of the working directory
    await syncIndex([workingDir]);
  } catch (error) {
    // Log initialization errors for debugging while keeping MCP clean
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      console.error(`[DEBUG] Code search initialization failed: ${error.message}`);
    }
  }
})();

// List available tools
const listToolsHandler = async () => {
  return {
    tools: [
      {
        name: "executenodejs",
        description: "Execute JavaScript code directly with Node.js - supports ESM imports and all Node.js features. \n\nDEBUGGING GUIDANCE:\n- Use this tool for all debugging and investigation tasks instead of external CLI tools\n- Break problems into testable hypotheses and verify them with code execution\n- Test APIs, data structures, and logic incrementally\n- Use console.log for debugging output and JSON.stringify for complex objects\n- Always prefer this over CLI tools like curl, wget, or external commands\n\nAPPROACH:\n1. Form a hypothesis about what might be wrong\n2. Write focused test code to verify the hypothesis\n3. Execute and analyze results\n4. Refine hypothesis based on findings\n5. Iterate until problem is solved",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "JavaScript code to execute - use for debugging, testing hypotheses, and investigation"
            },
            timeout: {
              type: "number",
              description: "Optional timeout in milliseconds (default: 120000)"
            },
            workingDirectory: {
              type: "string",
              description: "Optional working directory for the operation (defaults to server working directory)"
            }
          },
          required: ["code"]
        }
      },
      {
        name: "executedeno",
        description: "Execute JavaScript/TypeScript code with Deno - supports ESM imports and all Deno features. \n\nDEBUGGING GUIDANCE:\n- Use this tool for all debugging and investigation tasks instead of external CLI tools\n- Break problems into testable hypotheses and verify them with code execution\n- Test APIs, data structures, and logic incrementally\n- Use console.log for debugging output and JSON.stringify for complex objects\n- Always prefer this over CLI tools like curl, wget, or external commands\n- Great for TypeScript debugging and type checking\n\nAPPROACH:\n1. Form a hypothesis about what might be wrong\n2. Write focused test code to verify the hypothesis\n3. Execute and analyze results\n4. Refine hypothesis based on findings\n5. Iterate until problem is solved\n\nWEB REQUESTS: Use fetch() instead of curl for HTTP requests",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "JavaScript/TypeScript code to execute - use for debugging, testing hypotheses, and investigation"
            },
            timeout: {
              type: "number",
              description: "Optional timeout in milliseconds (default: 120000)"
            },
            workingDirectory: {
              type: "string",
              description: "Optional working directory for the operation (defaults to server working directory)"
            }
          },
          required: ["code"]
        }
      },
      {
        name: "searchcode",
        description: "Semantic code search with metadata extraction and AST-aware chunking",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Semantic search query for code"
            },
            folders: {
              type: "string",
              description: "Optional comma-separated list of folders to search (defaults to working directory)"
            },
            extensions: {
              type: "string",
              description: "Optional comma-separated list of file extensions to include (default: js,ts)"
            },
            ignores: {
              type: "string",
              description: "Optional comma-separated list of patterns to ignore (default: node_modules)"
            },
            topK: {
              type: "number",
              description: "Optional number of results to return (default: 8)"
            },
            workingDirectory: {
              type: "string",
              description: "Optional working directory for the operation (defaults to server working directory)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "astgrep_search",
        description: "Pattern-based code search using ast-grep - find code patterns using AST matching",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to search for (e.g., 'function $NAME($$$ARGS) { $$$ }')"
            },
            language: {
              type: "string",
              description: "Programming language (javascript, typescript, python, etc.)"
            },
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Specific paths to search (defaults to current directory)"
            },
            context: {
              type: "number",
              description: "Number of context lines to include"
            },
            strictness: {
              type: "string",
              enum: ["cst", "smart", "ast", "relaxed"],
              description: "Pattern matching strictness level"
            },
            outputFormat: {
              type: "string",
              enum: ["compact", "pretty"],
              description: "Output format"
            },
            workingDirectory: {
              type: "string",
              description: "Optional working directory for the operation (defaults to server working directory)"
            }
          },
          required: ["pattern"]
        }
      },
      {
        name: "astgrep_replace",
        description: "Code transformation using ast-grep rewrite patterns",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to match"
            },
            replacement: {
              type: "string",
              description: "Replacement pattern"
            },
            language: {
              type: "string",
              description: "Programming language"
            },
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Specific paths to transform"
            },
            dryRun: {
              type: "boolean",
              description: "Preview changes without applying them"
            },
            interactive: {
              type: "boolean",
              description: "Interactive mode for confirmation"
            },
            workingDirectory: {
              type: "string",
              description: "Optional working directory for the operation (defaults to server working directory)"
            }
          },
          required: ["pattern", "replacement"]
        }
      },
      {
        name: "astgrep_lint",
        description: "Rule-based code validation using ast-grep YAML rules",
        inputSchema: {
          type: "object",
          properties: {
            rules: {
              type: "string",
              description: "YAML rule content or path to rule file"
            },
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Specific paths to validate"
            },
            severity: {
              type: "string",
              enum: ["error", "warning", "info", "hint"],
              description: "Minimum severity level"
            },
            format: {
              type: "string",
              enum: ["json", "text"],
              description: "Output format"
            },
            workingDirectory: {
              type: "string",
              description: "Optional working directory for the operation (defaults to server working directory)"
            }
          },
          required: ["rules"]
        }
      },
      {
        name: "astgrep_analyze",
        description: "AST structure analysis and debugging using ast-grep",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to analyze"
            },
            language: {
              type: "string",
              description: "Programming language"
            },
            debugQuery: {
              type: "boolean",
              description: "Enable debug mode for query analysis"
            },
            showFullTree: {
              type: "boolean",
              description: "Show full AST tree context"
            },
            workingDirectory: {
              type: "string",
              description: "Optional working directory for the operation (defaults to server working directory)"
            }
          },
          required: ["pattern"]
        }
      }
    ],
  };
};

// Execute code function - simplified to pipe code into Node instead of using temp files
const executeCode = async (code, timeout = 120000, workingDirectory = null) => {
  const startTime = Date.now();
  
  // DEBUG: Log parameters and server state
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
    console.error(`[DEBUG] executeCode called with workingDirectory: ${workingDirectory}`);
    console.error(`[DEBUG] Server startup workingDir: ${workingDir}`);
    console.error(`[DEBUG] Server process.cwd(): ${process.cwd()}`);
  }
  
  // Validate and resolve working directory
  const dirValidation = validateWorkingDirectory(workingDirectory, workingDir);
  if (!dirValidation.valid) {
    return {
      success: false,
      error: dirValidation.error,
      executionTimeMs: Date.now() - startTime
    };
  }
  
  const effectiveWorkingDir = dirValidation.effectiveDir;
  
  // DEBUG: Log effective working directory
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
    console.error(`[DEBUG] Effective working directory: ${effectiveWorkingDir}`);
  }
  
  try {
    // More robust detection if the code is likely CJS or ESM
    // Look for explicit CJS markers: require, module.exports, __dirname, __filename
    const cjsMarkers = [
      'require(',
      'module.exports',
      '__dirname',
      '__filename',
      'exports.'
    ];
    
    // Check if the code contains any CJS markers
    const isCjs = cjsMarkers.some(marker => code.includes(marker));
    
    // If code is CJS, wrap it with the appropriate CommonJS wrapper
    if (isCjs) {
      // For CommonJS, create a temporary file since piping with --input-type=commonjs 
      // doesn't work reliably in all Node.js versions
      const fs = await import('fs');
      const tempDir = path.join(effectiveWorkingDir, 'temp');
      
      // Create temp directory if it doesn't exist
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Create a unique temporary file for CJS execution
      const tempFile = path.join(tempDir, `node-exec-${Date.now()}-${Math.random().toString(36).substring(2)}.cjs`);
      
      // Write the code to the temp file
      fs.writeFileSync(tempFile, code, 'utf8');
      
      return new Promise((resolve) => {
        // Execute the file directly instead of piping for CJS
        const nodeProcess = spawn('node', [tempFile], { 
          cwd: effectiveWorkingDir,
          timeout,
          env: process.env
        });
        
        let stdout = '';
        let stderr = '';
        
        nodeProcess.stdout.on('data', (data) => {
          stdout += data;
        });
        
        nodeProcess.stderr.on('data', (data) => {
          stderr += data;
        });
        
        nodeProcess.on('close', (code) => {
          // Calculate execution time
          const executionTimeMs = Date.now() - startTime;
          
          // Clean up temporary file
          try {
            fs.unlinkSync(tempFile);
          } catch (err) {
            // Silently handle cleanup errors
          }
          
          resolve({
            success: code === 0,
            stdout,
            stderr,
            executionTimeMs,
            code
          });
        });
        
        nodeProcess.on('error', (err) => {
          // Clean up temporary file
          try {
            fs.unlinkSync(tempFile);
          } catch (cleanupErr) {
            // Silently handle cleanup errors
          }
          
          resolve({
            success: false,
            error: err.message,
            executionTimeMs: Date.now() - startTime
          });
        });
      });
    } else {
      // For ESM code, continue using stdin piping
      return new Promise((resolve) => {
        // Spawn Node.js process with stdin piping for ESM
        const nodeProcess = spawn('node', ['--input-type=module'], { 
          cwd: effectiveWorkingDir,
          timeout,
          env: process.env
        });
        
        let stdout = '';
        let stderr = '';
        
        nodeProcess.stdout.on('data', (data) => {
          stdout += data;
        });
        
        nodeProcess.stderr.on('data', (data) => {
          stderr += data;
        });
        
        nodeProcess.on('close', (code) => {
          // Calculate execution time
          const executionTimeMs = Date.now() - startTime;
          
          resolve({
            success: code === 0,
            stdout,
            stderr,
            executionTimeMs,
            code
          });
        });
        
        nodeProcess.on('error', (err) => {
          resolve({
            success: false,
            error: err.message,
            executionTimeMs: Date.now() - startTime
          });
        });
        
        // Write code to stdin and close
        nodeProcess.stdin.write(code);
        nodeProcess.stdin.end();
      });
    }
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
};

// Execute code with Deno - Refactored to pipe code via stdin and always use --allow-all
const executeDenoCode = async (code, timeout = 120000, workingDirectory = null) => {
  const startTime = Date.now();
  
  // DEBUG: Log parameters and server state
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
    console.error(`[DEBUG] executeDenoCode called with workingDirectory: ${workingDirectory}`);
    console.error(`[DEBUG] Server startup workingDir: ${workingDir}`);
  }
  
  // Validate and resolve working directory
  const dirValidation = validateWorkingDirectory(workingDirectory, workingDir);
  if (!dirValidation.valid) {
    return {
      success: false,
      error: dirValidation.error,
      executionTimeMs: Date.now() - startTime
    };
  }
  
  const effectiveWorkingDir = dirValidation.effectiveDir;
  
  // DEBUG: Log effective working directory
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
    console.error(`[DEBUG] Deno effective working directory: ${effectiveWorkingDir}`);
  }

  try {
    return new Promise((resolve) => {
      // Build Deno command with --allow-all and stdin reading
      const denoArgs = ['run', '--allow-all', '-']; // '-' tells Deno to read from stdin

      // Execute with Deno
      const denoProcess = spawn('deno', denoArgs, {
        cwd: effectiveWorkingDir,
        timeout,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'] // Ensure stdio streams are piped
      });

      let stdout = '';
      let stderr = '';

      denoProcess.stdout.on('data', (data) => {
        stdout += data;
      });

      denoProcess.stderr.on('data', (data) => {
        stderr += data;
      });

      denoProcess.on('close', (code) => {
        // Calculate execution time
        const executionTimeMs = Date.now() - startTime;
        
        resolve({
          success: code === 0,
          stdout,
          stderr,
          executionTimeMs,
          code
        });
      });

      denoProcess.on('error', (err) => {
        resolve({
          success: false,
          error: err.message,
          executionTimeMs: Date.now() - startTime
        });
      });

      // Write code to stdin and close
      denoProcess.stdin.write(code);
      denoProcess.stdin.end();
    });
  } catch (err) {
    return {
      success: false,
      error: err.message,
      executionTimeMs: Date.now() - startTime // Ensure time is recorded even on early catch
    };
  }
};

// Handle code search requests
const performCodeSearch = async (query, folders, extensions, ignores, topK, workingDirectory = null) => {
  const startTime = Date.now();
  
  // DEBUG: Log parameters and server state
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
    console.error(`[DEBUG] performCodeSearch called with workingDirectory: ${workingDirectory}`);
    console.error(`[DEBUG] Server startup workingDir: ${workingDir}`);
  }
  
  // Validate and resolve working directory
  const dirValidation = validateWorkingDirectory(workingDirectory, workingDir);
  if (!dirValidation.valid) {
    return {
      success: false,
      error: dirValidation.error,
      executionTimeMs: Date.now() - startTime
    };
  }
  
  const effectiveWorkingDir = dirValidation.effectiveDir;
  
  // DEBUG: Log effective working directory
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
    console.error(`[DEBUG] Search effective working directory: ${effectiveWorkingDir}`);
  }
  
  try {
    // Default to effective working directory if no folders provided
    const searchFolders = folders 
      ? folders.split(',').map(f => path.resolve(f.trim()))
      : [effectiveWorkingDir];
    
    // Parse extensions and ignores
    const searchExts = extensions 
      ? extensions.split(',').map(e => e.trim().replace(/^\./, ''))
      : ['js', 'ts'];
      
    const searchIgnores = ignores
      ? ignores.split(',').map(i => i.trim())
      : ['node_modules'];
    
    // Sync index with current file system
    const { syncIndex } = await getVectorIndexer();
    await syncIndex(searchFolders, searchExts, searchIgnores);
    
    // Run the query
    const { queryIndex } = await getVectorIndexer();
    const results = await queryIndex(query, topK || 8);
    
    // Use results as-is from the vector indexer
    const enhancedResults = results;
    
    // Calculate execution time
    const executionTimeMs = Date.now() - startTime;
    
    return {
      success: true,
      results: enhancedResults,
      executionTimeMs,
      searchFolders,
      searchExts,
      searchIgnores,
      metadata: {
        structuralSearch: true,
        indexedTypes: ['file', 'function', 'class', 'method', 'property', 'import', 'export']
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      executionTimeMs: Date.now() - startTime
    };
  }
};

// Handle code execution requests
const callToolHandler = async (request) => {
  try {
    const { name, arguments: args = {} } = request.params;
    
    // Handle Node.js execution
    if (name === 'executenodejs' || name === 'execute' || name === 'mcp_mcp_repl_execute') {
      const { code, timeout = 120000, workingDirectory } = args;
      
      if (!code) {
        throw new Error("Missing code argument for execute tool");
      }
      
      // Execute the code with Node.js
      const result = await executeCode(code, timeout, workingDirectory);
      
      // Create content array with output
      const outputLines = [];
      
      // Add stdout if any
      if (result.stdout) {
        outputLines.push({
          type: 'text',
          text: result.stdout.trim()
        });
      }
      
      // Add stderr if any
      if (result.stderr) {
        outputLines.push({
          type: 'text',
          text: `ERROR: ${result.stderr.trim()}`
        });
      }
      
      // Add error message if execution failed
      if (!result.success && result.error) {
        outputLines.push({
          type: 'text',
          text: `ERROR: ${result.error}`
        });
      }
      
      // Add execution summary
      outputLines.push({
        type: 'text',
        text: `Execution completed in ${result.executionTimeMs}ms with exit code ${result.code || 0}`
      });
      
      return {
        content: outputLines
      };
    }
    
    // Handle Deno execution
    if (name === 'executedeno' || name === 'mcp_mcp_repl_executedeno') {
      const { code, timeout = 120000, workingDirectory } = args;
      
      if (!code) {
        throw new Error("Missing code argument for Deno execute tool");
      }
      
      // Execute the code with Deno
      const result = await executeDenoCode(code, timeout, workingDirectory);
      
      // Create content array with output
      const outputLines = [];
      
      // Add stdout if any
      if (result.stdout) {
        outputLines.push({
          type: 'text',
          text: result.stdout.trim()
        });
      }
      
      // Add stderr if any
      if (result.stderr) {
        outputLines.push({
          type: 'text',
          text: `ERROR: ${result.stderr.trim()}`
        });
      }
      
      // Add error message if execution failed
      if (!result.success && result.error) {
        outputLines.push({
          type: 'text',
          text: `ERROR: ${result.error}`
        });
      }
      
      // Add execution summary
      outputLines.push({
        type: 'text',
        text: `Deno execution completed in ${result.executionTimeMs}ms with exit code ${result.code || 0}`
      });
      
      return {
        content: outputLines
      };
    }
    
    // Handle code search
    if (name === 'searchcode' || name === 'mcp_mcp_repl_searchcode') {
      const { query, folders, extensions, ignores, topK, workingDirectory } = args;
      
      if (!query) {
        throw new Error("Missing query argument for code search tool");
      }
      
      // Perform code search
      const result = await performCodeSearch(query, folders, extensions, ignores, topK, workingDirectory);
      
      // Create content array with output
      const outputLines = [];
      
      if (result.success) {
        // Add a header summarizing search configuration
        outputLines.push({
          type: 'text',
          text: `Code search for "${query}"\nSearched in: ${result.searchFolders.join(', ')}\nIncluded extensions: ${result.searchExts.join(', ')}\nIgnored patterns: ${result.searchIgnores.join(', ')}`
        });
        
        if (result.results.length === 0) {
          outputLines.push({
            type: 'text',
            text: 'No results found.'
          });
        } else {
          // Add formatted results
          outputLines.push({
            type: 'text',
            text: `Found ${result.results.length} result(s):`
          });
          
          // Add each result
          for (const res of result.results) {
            const title = `[${res.score}] ${res.file}:${res.startLine}-${res.endLine} - ${res.type} ${res.qualifiedName}`;
            let details = [];
            
            if (res.structure?.parameters && res.structure.parameters.length > 0) {
              const paramText = res.structure.parameters.map(p => `${p.name}${p.type ? `: ${p.type}` : ''}`).join(', ');
              details.push(`Parameters: ${paramText}`);
            }
            if (res.structure?.returnType) details.push(`Return type: ${res.structure.returnType}`);
            if (res.structure?.parentClass) details.push(`Parent class: ${res.structure.parentClass}`);
            if (res.structure?.inheritsFrom) details.push(`Extends: ${res.structure.inheritsFrom}`);
            if (res.doc) details.push(`Doc: ${res.doc}`);
            if (res.structure?.calls && res.structure.calls.length > 0) {
              details.push(`Calls: ${res.structure.calls.join(', ')}`);
            }
            details.push(`Lines: ${res.lines}`);
            if (res.code) details.push(`Code snippet: ${res.code}`);
            
            outputLines.push({
              type: 'text',
              text: `${title}\n${details.join('\n')}`
            });
          }
        }
        
        // Add execution summary
        outputLines.push({
          type: 'text',
          text: `Search completed in ${result.executionTimeMs}ms`
        });
      } else {
        // Add error message if search failed
        outputLines.push({
          type: 'text',
          text: `ERROR: ${result.error}`
        });
      }
      
      return {
        content: outputLines
      };
    }
    
    // Handle ast-grep search
    if (name === 'astgrep_search') {
      const { astgrepHandlers } = await getAstGrepUtils();
      return await astgrepHandlers.handleAstGrepSearch(args, workingDir, getAstGrepUtils);
    }
    
    // Handle ast-grep replace
    if (name === 'astgrep_replace') {
      const { astgrepHandlers } = await getAstGrepUtils();
      return await astgrepHandlers.handleAstGrepReplace(args, workingDir, getAstGrepUtils);
    }
    
    // Handle ast-grep lint
    if (name === 'astgrep_lint') {
      const { astgrepHandlersAdvanced } = await getAstGrepUtils();
      return await astgrepHandlersAdvanced.handleAstGrepLint(args, workingDir, getAstGrepUtils);
    }
    
    // Handle ast-grep analyze
    if (name === 'astgrep_analyze') {
      const { astgrepHandlersAdvanced } = await getAstGrepUtils();
      return await astgrepHandlersAdvanced.handleAstGrepAnalyze(args, workingDir, getAstGrepUtils);
    }
    
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `ERROR: ${error.message}`
        }
      ]
    };
  }
};

// Register handlers
server.setRequestHandler(ListToolsRequestSchema, listToolsHandler);
server.setRequestHandler(CallToolRequestSchema, callToolHandler);

// Global error handlers with structured logging for debugging
process.on('uncaughtException', (err) => {
  // Log critical errors to stderr with context for debugging
  console.error(`[CRITICAL] Uncaught exception: ${err.message}`);
  if (err.stack && (process.env.NODE_ENV === 'development' || process.env.DEBUG)) {
    console.error(err.stack);
  }
  process.exit(1); // Exit on uncaught exceptions to prevent undefined state
});

process.on('unhandledRejection', (reason) => {
  // Log unhandled rejections with context for debugging
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`[ERROR] Unhandled rejection: ${message}`);
  if (reason instanceof Error && reason.stack && (process.env.NODE_ENV === 'development' || process.env.DEBUG)) {
    console.error(reason.stack);
  }
});

// Start the server
async function main() {
  try {
    // Create transport and connect
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    
    // Add a keep-alive mechanism to prevent the process from exiting
    setInterval(() => {
      // This is a no-op interval that keeps the Node.js event loop active
    }, 60000);
    
    // Also handle the SIGINT signal explicitly
    process.on('SIGINT', () => {
      process.exit(0);
    });
  } catch (error) {
    // Only log critical startup errors that prevent the server from running
    console.error(`Error starting server: ${error.message}`);
    process.exit(1);
  }
}

// Run the server
main();
