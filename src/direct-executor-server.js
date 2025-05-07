#!/usr/bin/env node
// Simple Node.js direct executor server using MCP SDK

import * as path from 'node:path';
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js"; 
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from 'child_process';
import { initialize, syncIndex, queryIndex } from './js-vector-indexer.js';

// Get the working directory from command line or use current directory
const workingDir = process.argv[2] 
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
    await initialize();
    // Perform initial indexing of the working directory
    await syncIndex([workingDir]);
  } catch (error) {
    // Silently handle errors
  }
})();

// List available tools
const listToolsHandler = async () => {
  return {
    tools: [
      {
        name: "executenodejs",
        description: "Execute JavaScript code directly with Node.js - supports ESM imports and all Node.js features",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "JavaScript code to execute"
            },
            timeout: {
              type: "number",
              description: "Optional timeout in milliseconds (default: 120000)"
            }
          },
          required: ["code"]
        }
      },
      {
        name: "executedeno",
        description: "Execute JavaScript/TypeScript code with Deno - supports ESM imports and all Deno features",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "JavaScript/TypeScript code to execute"
            },
            timeout: {
              type: "number",
              description: "Optional timeout in milliseconds (default: 120000)"
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
            }
          },
          required: ["query"]
        }
      }
    ],
  };
};

// Execute code function - simplified to pipe code into Node instead of using temp files
const executeCode = async (code, timeout = 120000) => {
  const startTime = Date.now();
  
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
      const tempDir = path.join(workingDir, 'temp');
      
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
          cwd: workingDir,
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
          cwd: workingDir,
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
const executeDenoCode = async (code, timeout = 120000) => {
  const startTime = Date.now();

  try {
    return new Promise((resolve) => {
      // Build Deno command with --allow-all and stdin reading
      const denoArgs = ['run', '--allow-all', '-']; // '-' tells Deno to read from stdin

      // Execute with Deno
      const denoProcess = spawn('deno', denoArgs, {
        cwd: workingDir,
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
const performCodeSearch = async (query, folders, extensions, ignores, topK) => {
  const startTime = Date.now();
  
  try {
    // Default to working directory if no folders provided
    const searchFolders = folders 
      ? folders.split(',').map(f => path.resolve(f.trim()))
      : [workingDir];
    
    // Parse extensions and ignores
    const searchExts = extensions 
      ? extensions.split(',').map(e => e.trim().replace(/^\./, ''))
      : ['js', 'ts'];
      
    const searchIgnores = ignores
      ? ignores.split(',').map(i => i.trim())
      : ['node_modules'];
    
    // Sync index with current file system
    await syncIndex(searchFolders, searchExts, searchIgnores);
    
    // Run the query
    const results = await queryIndex(query, topK || 8);
    
    // Calculate execution time
    const executionTimeMs = Date.now() - startTime;
    
    return {
      success: true,
      results,
      executionTimeMs,
      searchFolders,
      searchExts,
      searchIgnores
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
      const { code, timeout = 120000 } = args;
      
      if (!code) {
        throw new Error("Missing code argument for execute tool");
      }
      
      // Execute the code with Node.js (ignore any workingDir passed in args)
      const result = await executeCode(code, timeout);
      
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
      const { code, timeout = 120000 } = args;
      
      if (!code) {
        throw new Error("Missing code argument for Deno execute tool");
      }
      
      // Execute the code with Deno (ignore any workingDir passed in args)
      const result = await executeDenoCode(code, timeout);
      
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
      const { query, folders, extensions, ignores, topK } = args;
      
      if (!query) {
        throw new Error("Missing query argument for code search tool");
      }
      
      // Perform code search
      const result = await performCodeSearch(query, folders, extensions, ignores, topK);
      
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
            
            if (res.parameters) details.push(`Parameters: ${res.parameters}`);
            if (res.parameterTypes) details.push(`Parameter types: ${res.parameterTypes}`);
            if (res.returnType) details.push(`Return type: ${res.returnType}`);
            if (res.parentClass) details.push(`Parent class: ${res.parentClass}`);
            if (res.extends) details.push(`Extends: ${res.extends}`);
            if (res.doc) details.push(`Doc: ${res.doc}`);
            if (res.controlFlow && res.controlFlow.length > 0) {
              details.push(`Contains: ${res.controlFlow.join(', ')}`);
            }
            details.push(`Lines: ${res.lines}, Tokens: ${res.tokens}`);
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

// Global error handlers that are silent to keep stdio clean
process.on('uncaughtException', (err) => {
  // Silently handle uncaught exceptions
});

process.on('unhandledRejection', (reason) => {
  // Silently handle unhandled rejections
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
