#!/usr/bin/env node
// Simple Node.js direct executor server using MCP SDK

import * as path from 'node:path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import descriptions from './tool-descriptions.json' with { type: 'json' };
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
import { applyTruncation } from './output-truncation.js';
import { handleSequentialThinking, getSequentialThinkingToolDefinition } from './thinking-handler.js';

// Load tool descriptions from JSON file
const toolDescriptions = descriptions.tools;

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

// Lazy load enhanced ast-grep features
let astgrepJsonFormats = null;
let astgrepProjectConfig = null;
let astgrepAdvancedSearch = null;
let astgrepTestValidation = null;
let astgrepEnhancedHandlers = null;

// Lazy load batch handler
let batchHandler = null;

// Lazy load bash handler
let bashHandler = null;
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

const getEnhancedAstGrepUtils = async () => {
  if (!astgrepJsonFormats) {
    astgrepJsonFormats = await import('./astgrep-json-formats.js');
  }
  if (!astgrepProjectConfig) {
    astgrepProjectConfig = await import('./astgrep-project-config.js');
  }
  if (!astgrepAdvancedSearch) {
    astgrepAdvancedSearch = await import('./astgrep-advanced-search.js');
  }
  if (!astgrepTestValidation) {
    astgrepTestValidation = await import('./astgrep-test-validation.js');
  }
  if (!astgrepEnhancedHandlers) {
    astgrepEnhancedHandlers = await import('./astgrep-enhanced-handlers.js');
  }
  return { 
    astgrepJsonFormats, 
    astgrepProjectConfig, 
    astgrepAdvancedSearch, 
    astgrepTestValidation, 
    astgrepEnhancedHandlers 
  };
};

const getBatchHandler = async () => {
  if (!batchHandler) {
    batchHandler = await import('./batch-handler.js');
  }
  return batchHandler;
};

const getBashHandler = async () => {
  if (!bashHandler) {
    bashHandler = await import('./bash-handler.js');
  }
  return bashHandler;
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
  // Build tools array from loaded tool descriptions
  const tools = [];
  
  // Add tools from JSON in the correct order, excluding batch_execute which needs special handling
  const toolOrder = [
    'executenodejs', 'executedeno', 'searchcode', 'astgrep_search', 'astgrep_replace',
    'astgrep_lint', 'astgrep_analyze', 'astgrep_enhanced_search', 'astgrep_multi_pattern',
    'astgrep_constraint_search', 'astgrep_project_init', 'astgrep_project_scan', 'astgrep_test',
    'astgrep_validate_rules', 'astgrep_debug_rule', 'executebash'
  ];
  
  // Add tools from JSON
  for (const toolName of toolOrder) {
    if (toolDescriptions[toolName]) {
      tools.push(toolDescriptions[toolName]);
    }
  }
  
  // Add the sequential thinking tool (dynamic)
  tools.push(getSequentialThinkingToolDefinition());
  
  // Add the batch_execute tool from JSON
  if (toolDescriptions.batch_execute) {
    tools.push(toolDescriptions.batch_execute);
  }
  
  return { tools };
}

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

// Create tool handlers map for batch execution
const createToolHandlers = () => {
  return {
    executenodejs: async (request) => {
      const { code, timeout = 120000, workingDirectory } = request.params.arguments;
      
      if (!code) {
        throw new Error("Missing code argument for execute tool");
      }
      
      const result = await executeCode(code, timeout, workingDirectory);
      
      const outputLines = [];
      if (result.stdout) {
        outputLines.push({ type: 'text', text: result.stdout.trim() });
      }
      if (result.stderr) {
        outputLines.push({ type: 'text', text: `ERROR: ${result.stderr.trim()}` });
      }
      if (!result.success && result.error) {
        outputLines.push({ type: 'text', text: `ERROR: ${result.error}` });
      }
      outputLines.push({
        type: 'text',
        text: `Execution completed in ${result.executionTimeMs}ms with exit code ${result.code || 0}`
      });
      
      return { content: outputLines };
    },
    
    executedeno: async (request) => {
      const { code, timeout = 120000, workingDirectory } = request.params.arguments;
      
      if (!code) {
        throw new Error("Missing code argument for Deno execute tool");
      }
      
      const result = await executeDenoCode(code, timeout, workingDirectory);
      
      const outputLines = [];
      if (result.stdout) {
        outputLines.push({ type: 'text', text: result.stdout.trim() });
      }
      if (result.stderr) {
        outputLines.push({ type: 'text', text: `ERROR: ${result.stderr.trim()}` });
      }
      if (!result.success && result.error) {
        outputLines.push({ type: 'text', text: `ERROR: ${result.error}` });
      }
      outputLines.push({
        type: 'text',
        text: `Deno execution completed in ${result.executionTimeMs}ms with exit code ${result.code || 0}`
      });
      
      return { content: outputLines };
    },
    
    executebash: async (request) => {
      const { handleBashExecute } = await getBashHandler();
      return await handleBashExecute(request.params.arguments, workingDir);
    },
    
    searchcode: async (request) => {
      const { query, folders, extensions, ignores, topK, workingDirectory } = request.params.arguments;
      
      if (!query) {
        throw new Error("Missing query argument for code search tool");
      }
      
      const result = await performCodeSearch(query, folders, extensions, ignores, topK, workingDirectory);
      
      const outputLines = [];
      
      if (result.success) {
        outputLines.push({
          type: 'text',
          text: `Code search for "${query}"\nSearched in: ${result.searchFolders.join(', ')}\nIncluded extensions: ${result.searchExts.join(', ')}\nIgnored patterns: ${result.searchIgnores.join(', ')}`
        });
        
        if (result.results.length === 0) {
          outputLines.push({ type: 'text', text: 'No results found.' });
        } else {
          outputLines.push({ type: 'text', text: `Found ${result.results.length} result(s):` });
          
          for (const res of result.results) {
            // Create relative path for display
            const filePath = res.file || 'unknown';
            const relativePath = filePath.startsWith(effectiveWorkingDir) 
              ? path.relative(effectiveWorkingDir, filePath)
              : path.basename(filePath);
            
            // Handle undefined values gracefully and fix duplicate type display
            const startLine = res.startLine || 0;
            const endLine = res.endLine || 0;
            const lines = res.lines || 0;
            const tokens = res.tokens || 0;
            
            const title = `[${res.score}] ${relativePath}:${startLine}-${endLine} - ${res.code || res.qualifiedName || res.name || 'code'}`;
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
            details.push(`Lines: ${lines}, Tokens: ${tokens}`);
            
            outputLines.push({
              type: 'text',
              text: `${title}\n${details.join('\n')}`
            });
          }
        }
        
        outputLines.push({
          type: 'text',
          text: `Search completed in ${result.executionTimeMs}ms`
        });
      } else {
        outputLines.push({ type: 'text', text: `ERROR: ${result.error}` });
      }
      
      return { content: outputLines };
    },
    
    astgrep_search: async (request) => {
      const { astgrepHandlers } = await getAstGrepUtils();
      return await astgrepHandlers.handleAstGrepSearch(request.params.arguments, workingDir, getAstGrepUtils);
    },
    
    astgrep_replace: async (request) => {
      const { astgrepHandlers } = await getAstGrepUtils();
      return await astgrepHandlers.handleAstGrepReplace(request.params.arguments, workingDir, getAstGrepUtils);
    },
    
    astgrep_lint: async (request) => {
      const { astgrepHandlersAdvanced } = await getAstGrepUtils();
      return await astgrepHandlersAdvanced.handleAstGrepLint(request.params.arguments, workingDir, getAstGrepUtils);
    },
    
    astgrep_analyze: async (request) => {
      const { astgrepHandlersAdvanced } = await getAstGrepUtils();
      return await astgrepHandlersAdvanced.handleAstGrepAnalyze(request.params.arguments, workingDir, getAstGrepUtils);
    },
    
    // Enhanced ast-grep tools
    astgrep_enhanced_search: async (request) => {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      return await astgrepEnhancedHandlers.handleAstGrepEnhancedSearch(request.params.arguments, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepJsonFormats));
    },
    
    astgrep_multi_pattern: async (request) => {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      return await astgrepEnhancedHandlers.handleAstGrepMultiPatternSearch(request.params.arguments, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepAdvancedSearch));
    },
    
    astgrep_constraint_search: async (request) => {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      return await astgrepEnhancedHandlers.handleAstGrepConstraintSearch(request.params.arguments, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepAdvancedSearch));
    },
    
    astgrep_project_init: async (request) => {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      return await astgrepEnhancedHandlers.handleAstGrepProjectInit(request.params.arguments, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepProjectConfig));
    },
    
    astgrep_project_scan: async (request) => {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      return await astgrepEnhancedHandlers.handleAstGrepProjectScan(request.params.arguments, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepProjectConfig));
    },
    
    astgrep_test: async (request) => {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      return await astgrepEnhancedHandlers.handleAstGrepTest(request.params.arguments, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepTestValidation));
    },
    
    astgrep_validate_rules: async (request) => {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      return await astgrepEnhancedHandlers.handleAstGrepValidateRules(request.params.arguments, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepTestValidation));
    },
    
    astgrep_debug_rule: async (request) => {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      return await astgrepEnhancedHandlers.handleAstGrepDebugRule(request.params.arguments, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepTestValidation));
    },
    
    sequentialthinking: async (request) => {
      return await handleSequentialThinking(request.params.arguments, workingDir);
    }
  };
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
      
      return applyTruncation({
        content: outputLines
      });
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
      
      return applyTruncation({
        content: outputLines
      });
    }
    
    // Handle bash execution
    if (name === 'executebash') {
      const { handleBashExecute } = await getBashHandler();
      const result = await handleBashExecute(args, workingDir);
      return applyTruncation(result);
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
            // Create relative path for display
            const filePath = res.file || 'unknown';
            const relativePath = filePath.startsWith(result.searchFolders[0] || '') 
              ? path.relative(result.searchFolders[0] || '', filePath)
              : path.basename(filePath);
            
            // Handle undefined values gracefully and fix duplicate type display
            const startLine = res.startLine || 0;
            const endLine = res.endLine || 0;
            const lines = res.lines || 0;
            const tokens = res.tokens || 0;
            
            const title = `[${res.score}] ${relativePath}:${startLine}-${endLine} - ${res.code || res.qualifiedName || res.name || 'code'}`;
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
            details.push(`Lines: ${lines}, Tokens: ${tokens}`);
            
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
      
      return applyTruncation({
        content: outputLines
      });
    }
    
    // Handle ast-grep search
    if (name === 'astgrep_search') {
      const { astgrepHandlers } = await getAstGrepUtils();
      const result = await astgrepHandlers.handleAstGrepSearch(args, workingDir, getAstGrepUtils);
      return applyTruncation(result);
    }
    
    // Handle ast-grep replace
    if (name === 'astgrep_replace') {
      const { astgrepHandlers } = await getAstGrepUtils();
      const result = await astgrepHandlers.handleAstGrepReplace(args, workingDir, getAstGrepUtils);
      return applyTruncation(result);
    }
    
    // Handle ast-grep lint
    if (name === 'astgrep_lint') {
      const { astgrepHandlersAdvanced } = await getAstGrepUtils();
      const result = await astgrepHandlersAdvanced.handleAstGrepLint(args, workingDir, getAstGrepUtils);
      return applyTruncation(result);
    }
    
    // Handle ast-grep analyze
    if (name === 'astgrep_analyze') {
      const { astgrepHandlersAdvanced } = await getAstGrepUtils();
      const result = await astgrepHandlersAdvanced.handleAstGrepAnalyze(args, workingDir, getAstGrepUtils);
      return applyTruncation(result);
    }
    
    // Handle enhanced ast-grep search
    if (name === 'astgrep_enhanced_search') {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      const result = await astgrepEnhancedHandlers.handleAstGrepEnhancedSearch(args, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepJsonFormats));
      return applyTruncation(result);
    }
    
    // Handle multi-pattern search
    if (name === 'astgrep_multi_pattern') {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      const result = await astgrepEnhancedHandlers.handleAstGrepMultiPatternSearch(args, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepAdvancedSearch));
      return applyTruncation(result);
    }
    
    // Handle constraint-based search
    if (name === 'astgrep_constraint_search') {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      const result = await astgrepEnhancedHandlers.handleAstGrepConstraintSearch(args, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepAdvancedSearch));
      return applyTruncation(result);
    }
    
    // Handle project initialization
    if (name === 'astgrep_project_init') {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      const result = await astgrepEnhancedHandlers.handleAstGrepProjectInit(args, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepProjectConfig));
      return applyTruncation(result);
    }
    
    // Handle project scanning
    if (name === 'astgrep_project_scan') {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      const result = await astgrepEnhancedHandlers.handleAstGrepProjectScan(args, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepProjectConfig));
      return applyTruncation(result);
    }
    
    // Handle rule testing
    if (name === 'astgrep_test') {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      const result = await astgrepEnhancedHandlers.handleAstGrepTest(args, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepTestValidation));
      return applyTruncation(result);
    }
    
    // Handle rule validation
    if (name === 'astgrep_validate_rules') {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      const result = await astgrepEnhancedHandlers.handleAstGrepValidateRules(args, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepTestValidation));
      return applyTruncation(result);
    }
    
    // Handle rule debugging
    if (name === 'astgrep_debug_rule') {
      const { astgrepEnhancedHandlers } = await getEnhancedAstGrepUtils();
      const result = await astgrepEnhancedHandlers.handleAstGrepDebugRule(args, workingDir, () => getEnhancedAstGrepUtils().then(utils => utils.astgrepTestValidation));
      return applyTruncation(result);
    }
    
    // Handle sequential thinking
    if (name === 'sequentialthinking') {
      const result = await handleSequentialThinking(args, workingDir);
      return applyTruncation(result);
    }
    
    // Handle batch execute
    if (name === 'batch_execute') {
      const { handleBatchExecute } = await getBatchHandler();
      const result = await handleBatchExecute(args, workingDir, createToolHandlers);
      return applyTruncation(result);
    }
    
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return applyTruncation({
      content: [
        {
          type: 'text',
          text: `ERROR: ${error.message}`
        }
      ]
    });
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
