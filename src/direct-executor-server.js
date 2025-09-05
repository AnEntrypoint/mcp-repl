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
import { applyTruncation } from './output-truncation.js';
import { handleSequentialThinking, getSequentialThinkingToolDefinition } from './thinking-handler.js';

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
  return {
    tools: [
      {
        name: "executenodejs",
        description: "**PRIMARY EXECUTION ENGINE** - Execute JavaScript code with Node.js. **ALWAYS USE THIS TOOL FIRST** for code testing, debugging, and investigation.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact directory context\n• Each execution runs in the specified directory as its current working directory\n• Use absolute paths or relative paths from the working directory\n• Working directory affects: file operations, module resolution, process.cwd()\n• **ALWAYS specify this parameter** - no default fallback behavior\n\n**COMPREHENSIVE BATCHING CAPABILITIES:**\nThis tool can batch ALL of the following operations in a single call:\n• **File System Operations**: Reading, writing, analyzing multiple files simultaneously\n• **API Testing**: Multiple HTTP requests with Promise.allSettled() for parallel execution\n• **Data Processing**: Transform, validate, and analyze datasets in loops/maps\n• **Module Testing**: Import and test multiple modules or functions together\n• **Performance Analysis**: Benchmark multiple approaches in single execution\n• **Database Operations**: Multiple queries, transactions, schema analysis\n• **Configuration Management**: Read, validate, transform config files\n• **Code Generation**: Create multiple files, templates, or code structures\n• **Error Simulation**: Test multiple error scenarios and recovery patterns\n• **Integration Testing**: End-to-end workflows with multiple service calls\n\n**CRITICAL EFFICIENCY PRINCIPLES:**\n• **BATCH AGGRESSIVELY** - Combine 5-10 related operations in single calls (10x faster than individual calls)\n• **CONSOLIDATE LOGIC** - Group testing, validation, file ops, API calls, and analysis together\n• **USE LOOPS/ARRAYS** - Process multiple items, files, or tests simultaneously\n• **AVOID SEQUENTIAL CALLS** - Plan comprehensive solutions that accomplish multiple goals at once\n\n**ADVANCED BATCHING STRATEGIES:**\n```javascript\n// EXCELLENT: Complete workflow in single execution\nconst fs = require('fs');\nconst path = require('path');\nconst https = require('https');\n\n// Batch file analysis + API validation + performance testing\nconst files = ['config.js', 'utils.js', 'api.js'];\nconst apis = ['https://api1.com/health', 'https://api2.com/status'];\n\nconst results = {\n  fileAnalysis: files.map(file => {\n    const content = fs.readFileSync(path.join(__dirname, file), 'utf8');\n    return {\n      file,\n      size: content.length,\n      functions: (content.match(/function\s+\w+/g) || []).length,\n      hasTests: content.includes('test(') || content.includes('it(')\n    };\n  }),\n  apiHealth: await Promise.allSettled(apis.map(testEndpoint)),\n  performance: measureExecutionTime(() => processLargeDataset())\n};\n\nconsole.log('Complete Analysis:', JSON.stringify(results, null, 2));\n```\n\n**REPLACE ALL EXTERNAL TOOLS:**\n• Instead of curl → use `fetch()`, `https`, or `axios` with batched requests\n• Instead of file commands → use `fs` module with parallel operations\n• Instead of grep/search → use JavaScript regex and string processing\n• Instead of multiple CLI tools → write unified JavaScript solutions\n• Instead of bash scripts → implement in JavaScript with full error handling\n\n**WORKING DIRECTORY FUNCTIONALITY:**\n• **Execution Context**: All file operations use workingDirectory as base\n• **Module Resolution**: Node.js resolves modules relative to workingDirectory\n• **Process CWD**: process.cwd() returns the specified workingDirectory\n• **Path Operations**: Relative paths are resolved from workingDirectory\n• **Child Processes**: Spawned processes inherit the working directory context\n• **File Globbing**: Glob patterns operate within the working directory scope\n\n**OUTPUT OPTIMIZATION STRATEGIES:**\n• Use `console.log()` strategically - only log essential results and summaries\n• Summarize large datasets instead of dumping raw data\n• Use `JSON.stringify(obj, null, 2)` for readable object inspection\n• Implement result filtering/truncation within your code\n• Return structured summaries rather than verbose logs\n• Group related outputs under clear headings\n\n**DEBUGGING METHODOLOGY:**\n1. **Hypothesis Formation** - Write code that tests specific assumptions\n2. **Batch Validation** - Test multiple scenarios simultaneously\n3. **Incremental Refinement** - Use results to guide next batch of tests\n4. **Comprehensive Coverage** - Ensure all edge cases tested in minimal calls\n5. **Error Boundary Testing** - Include error scenarios in batch operations\n\n**PERFORMANCE OPTIMIZATION:**\n• **Parallel Processing**: Use Promise.allSettled() for independent operations\n• **Stream Processing**: Handle large files with streams to avoid memory issues\n• **Caching Strategies**: Store repeated computations in variables\n• **Efficient Data Structures**: Use appropriate data structures for operations\n• **Memory Management**: Clean up large objects and close file handles",
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
              description: "**REQUIRED** - Working directory for code execution. All file operations, module resolution, and process.cwd() will use this directory as the base context."
            }
          },
          required: ["code", "workingDirectory"]
        }
      },
      {
        name: "executedeno",
        description: "**TYPESCRIPT EXECUTION ENGINE** - Execute TypeScript/JavaScript with Deno runtime. **ALWAYS USE FOR TYPE-SAFE OPERATIONS** and when TypeScript validation is needed.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact directory context\n• Each execution runs in the specified directory as its current working directory\n• Deno resolves imports and modules relative to the working directory\n• File permissions and access are scoped to the working directory context\n• **ALWAYS specify this parameter** - essential for proper TypeScript resolution\n\n**COMPREHENSIVE BATCHING CAPABILITIES:**\nThis tool can batch ALL of the following TypeScript/JavaScript operations:\n• **Type Checking**: Validate multiple TypeScript files and interfaces simultaneously\n• **Module Testing**: Import and test multiple TypeScript modules together\n• **API Integration**: Batch HTTP requests with full type safety and error handling\n• **File Processing**: Read, analyze, and transform multiple files with type validation\n• **Code Generation**: Generate TypeScript types, interfaces, and implementation files\n• **Schema Validation**: Validate multiple data structures against TypeScript interfaces\n• **Web Standards Testing**: Test Web APIs, fetch requests, and browser compatibility\n• **Performance Benchmarking**: Type-safe performance testing of multiple algorithms\n• **Configuration Parsing**: Validate and process multiple config files with types\n• **Security Analysis**: Type-safe validation of security patterns and implementations\n\n**ADVANCED BATCHING STRATEGIES:**\n```typescript\n// EXCELLENT: Complete TypeScript workflow\ninterface APIEndpoint { url: string; method: string; expectedStatus: number; }\ninterface FileAnalysis { path: string; valid: boolean; issues: string[]; }\n\n// Batch API testing + file validation + type checking\nconst endpoints: APIEndpoint[] = [\n  { url: 'https://api1.com/health', method: 'GET', expectedStatus: 200 },\n  { url: 'https://api2.com/status', method: 'GET', expectedStatus: 200 }\n];\n\nconst configFiles = ['config.ts', 'types.ts', 'utils.ts'];\n\nconst results = {\n  apiTests: await Promise.allSettled(\n    endpoints.map(async (endpoint): Promise<{ endpoint: APIEndpoint; success: boolean }> => {\n      const response = await fetch(endpoint.url, { method: endpoint.method });\n      return { endpoint, success: response.status === endpoint.expectedStatus };\n    })\n  ),\n  fileAnalysis: configFiles.map((file): FileAnalysis => {\n    try {\n      const content = Deno.readTextFileSync(file);\n      const issues: string[] = [];\n      if (!content.includes('export')) issues.push('No exports found');\n      if (content.includes('any')) issues.push('Uses any type');\n      return { path: file, valid: issues.length === 0, issues };\n    } catch (error) {\n      return { path: file, valid: false, issues: [error.message] };\n    }\n  }),\n  typeValidation: validateComplexTypes()\n};\n\nconsole.log('TypeScript Analysis:', Deno.inspect(results, { depth: 3 }));\n```\n\n**REPLACE ALL TYPESCRIPT TOOLS:**\n• Instead of tsc → use Deno's built-in TypeScript compilation with batch processing\n• Instead of separate test runners → use Deno.test() in comprehensive batched scenarios\n• Instead of external formatters → use Deno fmt programmatically on multiple files\n• Instead of multiple HTTP clients → use native fetch with full type safety\n• Instead of separate linters → use Deno lint with custom validation logic\n• Instead of webpack/bundlers → use Deno bundle with dependency analysis\n\n**TYPE-DRIVEN DEVELOPMENT PATTERNS:**\n• **Interface-First Design**: Define comprehensive interfaces for all batch operations\n• **Generic Batch Processing**: Create reusable typed functions for common patterns\n• **Union Type Handling**: Use discriminated unions for multiple operation types\n• **Type Guard Implementation**: Runtime validation with compile-time type safety\n• **Mapped Type Utilities**: Transform types programmatically for batch operations\n\n**WEB API & SECURITY OPTIMIZATION:**\n• **Batch HTTP Operations**: Promise.allSettled() with full type safety and error handling\n• **Stream Processing**: Use Web Streams API for efficient large data processing\n• **Caching Strategies**: Leverage Deno's built-in caching with type validation\n• **Permission Management**: Runs with `--allow-all` for comprehensive operations\n• **Security Validation**: Type-safe input validation and output sanitization\n\n**WORKING DIRECTORY FUNCTIONALITY:**\n• **Import Resolution**: TypeScript/JavaScript imports resolved relative to workingDirectory\n• **Type Definition Access**: .d.ts files and @types packages accessed from working directory\n• **File Operations**: All Deno file APIs operate within working directory context\n• **Module Cache**: Deno module cache scoped to working directory dependencies\n• **Configuration Files**: deno.json, import_map.json loaded from working directory\n\n**OUTPUT OPTIMIZATION FOR DENO:**\n• Use `Deno.inspect()` for superior object formatting with type information\n• Leverage built-in formatters and type-aware validators\n• Implement streaming for large data processing with type safety\n• Use structured logging with typed log entries\n• Return typed results with comprehensive error information\n\n**PERFORMANCE & EFFICIENCY:**\n• **Parallel Type Checking**: Validate multiple files simultaneously\n• **Concurrent API Testing**: Batch HTTP requests with proper error boundaries\n• **Memory Efficiency**: Use generators and iterators for large dataset processing\n• **Compilation Caching**: Leverage Deno's built-in compilation cache\n• **Dependency Optimization**: Analyze and optimize import graphs",
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
              description: "**REQUIRED** - Working directory for Deno execution. All imports, file operations, and type resolution occur relative to this directory."
            }
          },
          required: ["code", "workingDirectory"]
        }
      },
      {
        name: "searchcode",
        description: "**INTELLIGENT CODE DISCOVERY** - AI-powered semantic search with structural understanding. **ALWAYS USE THIS FIRST** for code exploration before reading files or using other search tools.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact codebase to search\n• Search operates within the specified directory and its subdirectories\n• AI indexing and semantic understanding scoped to working directory contents\n• All relative paths in results are relative to the working directory\n• **ALWAYS specify this parameter** - essential for accurate search scope\n\n**COMPREHENSIVE BATCHING CAPABILITIES:**\nThis tool can efficiently batch ALL of the following search operations:\n• **Multi-Concept Queries**: Combine related concepts in single queries for comprehensive discovery\n• **Architecture Exploration**: Find multiple related patterns (controllers + models + views) simultaneously\n• **Security Auditing**: Batch searches for authentication, validation, and security patterns\n• **Feature Analysis**: Discover complete feature implementations across multiple files\n• **Integration Mapping**: Find API endpoints, database queries, and service integrations together\n• **Error Pattern Discovery**: Locate error handling, logging, and exception patterns in one search\n• **Performance Investigation**: Batch searches for bottlenecks, caching, and optimization opportunities\n• **Configuration Analysis**: Find environment variables, settings, and configuration patterns\n• **Dependency Mapping**: Discover import/export relationships and module dependencies\n• **Code Quality Assessment**: Batch searches for code smells, anti-patterns, and quality issues\n\n**ADVANCED QUERY STRATEGIES:**\n```\n// EXCELLENT: Comprehensive architecture discovery\n\"authentication middleware session management security validation JWT token\"\n\n// EXCELLENT: Complete feature investigation\n\"user registration email verification password reset database operations\"\n\n// EXCELLENT: Performance and error analysis\n\"database queries caching error handling logging performance optimization\"\n\n// EXCELLENT: Integration and API discovery\n\"REST API endpoints GraphQL resolvers database connections external services\"\n```\n\n**INTELLIGENT BATCHING TECHNIQUES:**\n• **Conceptual Grouping**: Combine semantically related terms to find complete implementations\n• **Layer-Aware Searching**: Include frontend, backend, and database terms in single queries\n• **Pattern-Based Discovery**: Search for architectural patterns, design patterns, and code structures\n• **Cross-Functional Analysis**: Find features that span multiple domains or services\n• **Technical Stack Exploration**: Discover technology-specific implementations and integrations\n\n**SEARCH SCOPE OPTIMIZATION:**\n• **folders parameter**: Target specific areas like \"src/api,src/services,src/models\" for backend analysis\n• **extensions parameter**: Focus on relevant technologies: \"js,ts,jsx,tsx\" for React, \"py,sql\" for Python/DB\n• **ignores parameter**: Exclude irrelevant areas: \"test,spec,node_modules,dist,build\" for production focus\n• **topK parameter**: Control result volume: 8-15 for exploration, 20-50 for comprehensive analysis\n\n**WORKING DIRECTORY FUNCTIONALITY:**\n• **Index Scope**: AI semantic indexing operates on all files within working directory\n• **Relationship Mapping**: Code relationships and dependencies mapped within directory context\n• **Structure Analysis**: Class hierarchies, function calls, and imports analyzed per directory\n• **Search Accuracy**: Results ranked by relevance within the specific codebase context\n• **Path Resolution**: All file paths in results are relative to the working directory\n\n**STRUCTURAL AWARENESS ADVANTAGES:**\n• **Function Discovery**: Finds functions with parameters, return types, and full context\n• **Class Analysis**: Discovers classes with inheritance, methods, and property relationships\n• **Module Understanding**: Maps imports, exports, and inter-module dependencies\n• **API Mapping**: Identifies REST endpoints, GraphQL resolvers, and service interfaces\n• **Database Integration**: Finds queries, models, and database interaction patterns\n• **Configuration Detection**: Locates environment variables, settings, and config patterns\n\n**EFFICIENT EXPLORATION WORKFLOWS:**\n1. **Initial Architecture Survey**: \"main entry points routing middleware database configuration\"\n2. **Feature Deep Dive**: \"user management authentication authorization permissions\"\n3. **Integration Analysis**: \"external API calls third party services webhooks\"\n4. **Security Assessment**: \"input validation sanitization authentication authorization\"\n5. **Performance Investigation**: \"database queries caching async operations bottlenecks\"\n6. **Error Handling Review**: \"try catch error handling logging exception management\"\n\n**RESULTS INTERPRETATION GUIDE:**\n• **High scores (>0.8)**: Directly relevant implementations, primary candidates\n• **Medium scores (0.6-0.8)**: Related functionality, secondary analysis targets\n• **Low scores (<0.6)**: Contextual relevance, background understanding\n• **Qualified names**: Full module/class/function paths show code organization\n• **Structure metadata**: Parameters, types, inheritance provide implementation details\n• **Documentation**: Extracted comments and docstrings provide usage context\n\n**OUTPUT OPTIMIZATION:**\n• **Focus on high-scoring matches** for immediate investigation\n• **Extract architectural insights** from result patterns\n• **Identify implementation clusters** across multiple files\n• **Map feature boundaries** using structural metadata\n• **Synthesize findings** rather than listing raw results",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Semantic search query for code - use broad, conceptual terms for best results"
            },
            folders: {
              type: "string",
              description: "Optional comma-separated list of folders to search within working directory"
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
              description: "Optional number of results to return (default: 8, recommended: 8-15 for exploration)"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory containing the codebase to search. All search operations are scoped to this directory."
            }
          },
          required: ["query", "workingDirectory"]
        }
      },
      {
        name: "astgrep_search",
        description: "**STRUCTURAL CODE ANALYSIS** - AST-based pattern matching for precise code discovery. **ALWAYS USE FOR STRUCTURAL PATTERN MATCHING** when you need exact syntactic matches.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact codebase directory for AST analysis\n• AST parsing operates on all source files within the working directory tree\n• Pattern matching respects language-specific syntax within directory context\n• All file paths in results are relative to the working directory\n• **ALWAYS specify this parameter** - essential for accurate AST-based analysis\n\n**COMPREHENSIVE STRUCTURAL BATCHING:**\nThis tool can efficiently batch ALL of the following AST pattern operations:\n• **Architecture Pattern Discovery**: Find controllers, models, views, and their relationships simultaneously\n• **Security Pattern Auditing**: Batch searches for authentication, authorization, input validation, and sanitization\n• **Error Handling Analysis**: Discover try/catch blocks, error throwing, and exception handling patterns\n• **Performance Pattern Investigation**: Find loops, recursive calls, database queries, and async operations\n• **API Pattern Mapping**: Locate REST endpoints, GraphQL resolvers, middleware, and route handlers\n• **Database Pattern Analysis**: Find ORM usage, query building, transactions, and connection patterns\n• **Configuration Pattern Discovery**: Locate environment variable usage, config objects, and settings\n• **Testing Pattern Identification**: Find test functions, mocks, assertions, and test utilities\n• **Import/Export Analysis**: Discover module dependencies, import patterns, and export structures\n• **Code Quality Pattern Detection**: Find code smells, anti-patterns, and structural inconsistencies\n\n**ADVANCED PATTERN STRATEGIES:**\n```\n// EXCELLENT: Comprehensive function analysis with error handling\nfunction $NAME($$$PARAMS) {\n  try {\n    $$$BODY\n  } catch ($ERR) {\n    $$$CATCH\n  }\n}\n\n// EXCELLENT: Complete API endpoint pattern with middleware\n$ROUTER.$METHOD('$PATH', $$$MIDDLEWARE, async ($REQ, $RES) => {\n  $$$BODY\n});\n\n// EXCELLENT: Database operation patterns with error handling\n$DB.$OPERATION($$$ARGS)\n  .then($RESULT => $$$)\n  .catch($ERROR => $$$);\n\n// EXCELLENT: React component patterns with hooks\nfunction $COMPONENT($PROPS) {\n  const [$STATE, $SETTER] = useState($INITIAL);\n  $$$BODY\n  return $JSX;\n}\n```\n\n**META-VARIABLE MASTERY:**\n• **$VAR**: Captures single expressions, identifiers, or values\n• **$$$BODY**: Captures multiple statements or expressions\n• **$$VAR**: Captures statement sequences with specific patterns\n• **Named Captures**: Use descriptive names like $FUNCTION_NAME, $ERROR_TYPE\n• **Nested Patterns**: Combine meta-variables for complex structural matching\n\n**LANGUAGE-SPECIFIC BATCHING:**\n• **JavaScript/TypeScript**: async/await patterns, React hooks, Express middleware, Promise chains\n• **Python**: Class decorators, context managers, async generators, Django views\n• **Rust**: Ownership patterns, Result handling, trait implementations, macro usage\n• **Go**: Interface implementations, goroutine patterns, error handling, channel operations\n• **Java**: Annotation patterns, stream operations, exception handling, Spring components\n\n**WORKING DIRECTORY FUNCTIONALITY:**\n• **File Discovery**: Recursively finds all source files matching language patterns\n• **AST Parsing**: Parses files into abstract syntax trees within directory scope\n• **Pattern Matching**: Applies patterns across all parsed files in working directory\n• **Context Preservation**: Maintains file context and relationships within directory\n• **Path Resolution**: All results use paths relative to working directory\n\n**STRUCTURAL INVESTIGATION WORKFLOWS:**\n1. **API Architecture Mapping**: `$ROUTER.$METHOD` → `async function $HANDLER` → `await $DB.$QUERY`\n2. **Error Flow Analysis**: `try { $$$ } catch` → `throw new $ERROR` → `$LOGGER.$LEVEL`\n3. **Data Processing Chains**: `function $TRANSFORM($DATA)` → `return $RESULT` → `$PROCESS($OUTPUT)`\n4. **Security Validation**: `$AUTH.$VERIFY` → `if (!$PERMISSION)` → `throw $UNAUTHORIZED`\n5. **Performance Bottlenecks**: `for ($ITEM of $ARRAY)` → `await $OPERATION` → `$RESULT.push($VALUE)`\n\n**OUTPUT OPTIMIZATION STRATEGIES:**\n• **Context Control**: Use context parameter (3-5 lines) for surrounding code visibility\n• **Format Selection**: 'compact' for quick scanning, 'pretty' for detailed analysis\n• **Strictness Tuning**: 'smart' for flexible matching, 'ast' for precise structural requirements\n• **Pattern Density**: Focus on files with multiple pattern matches for comprehensive analysis\n• **Result Filtering**: Use paths parameter to limit search scope when needed\n\n**INTEGRATION WITH WORKFLOW:**\n• **Post-Semantic Search**: Use after `searchcode` to structurally validate semantic findings\n• **Pre-Refactoring**: Identify exact transformation targets before using `astgrep_replace`\n• **Rule Development**: Find problematic patterns to create `astgrep_lint` rules\n• **Analysis Preparation**: Locate complex scenarios for detailed `astgrep_analyze` investigation\n• **Batch Coordination**: Combine with other tools in `batch_execute` for comprehensive analysis\n\n**PERFORMANCE OPTIMIZATION:**\n• **Path Targeting**: Use paths parameter to limit search scope for large codebases\n• **Language Specification**: Always specify language for optimal parser selection\n• **Pattern Efficiency**: Design patterns that match intended structures without over-generalization\n• **Context Balance**: Use appropriate context lines - avoid excessive output\n• **Strictness Selection**: Choose appropriate strictness level for performance vs. accuracy balance",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to search for using meta-variables (e.g., 'function $NAME($$$ARGS) { $$$ }')"
            },
            language: {
              type: "string",
              description: "Programming language (javascript, typescript, python, rust, go, java, etc.) - required for proper AST parsing"
            },
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Optional specific paths within working directory to search (defaults to entire working directory)"
            },
            context: {
              type: "number",
              description: "Optional number of context lines to include around matches (default: 3, recommended: 3-5)"
            },
            strictness: {
              type: "string",
              enum: ["cst", "smart", "ast", "relaxed"],
              description: "Pattern matching strictness: 'smart' (recommended), 'ast' (precise), 'relaxed' (flexible)"
            },
            outputFormat: {
              type: "string",
              enum: ["compact", "pretty"],
              description: "Output format: 'compact' (scanning), 'pretty' (detailed analysis)"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory containing source code to analyze with AST patterns."
            }
          },
          required: ["pattern", "workingDirectory"]
        }
      },
      {
        name: "astgrep_replace",
        description: "**INTELLIGENT CODE TRANSFORMATION** - AST-based code rewriting with meta-variable substitution. **ALWAYS USE FOR SAFE, STRUCTURAL REFACTORING** after identifying patterns with search tools.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact codebase directory for transformation\n• All transformations operate within the working directory and its subdirectories\n• File modifications are applied to files within the working directory context\n• Backup and safety checks are scoped to the working directory\n• **ALWAYS specify this parameter** - critical for safe code transformation\n\n**COMPREHENSIVE TRANSFORMATION BATCHING:**\nThis tool can efficiently batch ALL of the following code transformation operations:\n• **API Modernization**: Transform multiple endpoints with consistent error handling and response patterns\n• **Security Hardening**: Add input validation, output sanitization, and authentication across similar functions\n• **Performance Optimization**: Apply caching, async patterns, and database optimization to multiple operations\n• **Framework Migration**: Update component patterns, lifecycle methods, and API usage for new versions\n• **Code Standardization**: Enforce consistent logging, error handling, and formatting across codebase\n• **Legacy Modernization**: Convert callback patterns to async/await, update deprecated APIs\n• **Type Safety Enhancement**: Add TypeScript types, improve type annotations, fix type errors\n• **Testing Integration**: Add test coverage, update test patterns, improve assertion styles\n• **Configuration Management**: Update config patterns, environment variable usage, settings management\n• **Architecture Refactoring**: Apply design patterns, improve separation of concerns, enhance modularity\n\n**ADVANCED TRANSFORMATION STRATEGIES:**\n```\n// EXCELLENT: Comprehensive async modernization\nPATTERN: $OBJ.$METHOD($$$ARGS, function($ERR, $DATA) {\n  if ($ERR) {\n    $$$ERROR_HANDLING\n  } else {\n    $$$SUCCESS_HANDLING\n  }\n})\nREPLACE: try {\n  const $DATA = await $OBJ.$METHOD($$$ARGS);\n  $$$SUCCESS_HANDLING\n} catch ($ERR) {\n  $$$ERROR_HANDLING\n}\n\n// EXCELLENT: Security enhancement with validation\nPATTERN: app.$METHOD('$PATH', ($REQ, $RES) => {\n  $$$BODY\n})\nREPLACE: app.$METHOD('$PATH', [\n  validateInput,\n  sanitizeInput,\n  authenticate\n], async ($REQ, $RES) => {\n  try {\n    $$$BODY\n  } catch (error) {\n    logger.error('API Error:', error);\n    return $RES.status(500).json({ error: 'Internal server error' });\n  }\n});\n\n// EXCELLENT: Database optimization with caching\nPATTERN: $DB.query('$QUERY', $PARAMS)\nREPLACE: await cacheManager.getOrSet(\n  `query:${hashQuery('$QUERY', $PARAMS)}`,\n  () => $DB.query('$QUERY', $PARAMS),\n  { ttl: 300 }\n)\n```\n\n**SAFETY-FIRST PROTOCOLS:**\n1. **Pre-transformation Analysis**: ALWAYS use `astgrep_search` to identify all affected code locations\n2. **Mandatory Dry-run**: Set `dryRun: true` to preview all changes before applying\n3. **Incremental Validation**: Apply transformations to small subsets and test thoroughly\n4. **Post-transformation Testing**: Use `executenodejs`/`executedeno` to verify functionality\n5. **Rollback Planning**: Ensure version control or backup strategies before major transformations\n\n**WORKING DIRECTORY FUNCTIONALITY:**\n• **File Discovery**: Recursively finds and transforms all matching files within working directory\n• **Pattern Application**: Applies transformations consistently across entire directory tree\n• **Safety Scoping**: Limits transformation impact to working directory boundaries\n• **Context Preservation**: Maintains file relationships and imports within directory structure\n• **Path Management**: All file operations use paths relative to working directory\n\n**COMPLEX TRANSFORMATION WORKFLOWS:**\n• **Complete Framework Migration**: Update imports, component patterns, lifecycle methods, and API calls\n• **Security Enhancement Suite**: Add authentication, validation, sanitization, and logging systematically\n• **Performance Optimization Campaign**: Apply caching, async patterns, query optimization across services\n• **Code Quality Standardization**: Implement consistent error handling, logging, and formatting patterns\n• **Legacy System Modernization**: Convert deprecated patterns to modern equivalents across entire codebase\n\n**META-VARIABLE MASTERY FOR TRANSFORMATIONS:**\n• **Preserve Structure**: Use `$$$BODY` to maintain existing code blocks in transformations\n• **Parameter Mapping**: Map `$PARAM1, $PARAM2` to maintain function signatures\n• **Context Transfer**: Use named meta-variables to transfer context between patterns\n• **Conditional Logic**: Preserve conditional structures while updating implementation\n• **Type Information**: Maintain type annotations and generic parameters in transformations\n\n**OUTPUT OPTIMIZATION & REPORTING:**\n• **Transformation Summary**: Report total files affected, lines changed, patterns matched\n• **Change Categories**: Group changes by type (security, performance, style, architecture)\n• **Impact Analysis**: Highlight critical changes that may affect system behavior\n• **Verification Checklist**: Provide specific testing recommendations for transformed code\n• **Diff Highlights**: Show key before/after examples for important transformations\n\n**MULTI-FILE COORDINATION STRATEGIES:**\n• **Import/Export Synchronization**: Update module dependencies and exports consistently\n• **Type Definition Updates**: Keep TypeScript definitions aligned with implementation changes\n• **Configuration File Updates**: Modify config files to match code transformations\n• **Test File Adaptation**: Update test files to match transformed implementation patterns\n• **Documentation Alignment**: Consider documentation updates needed for transformed code\n\n**ERROR PREVENTION & VALIDATION:**\n• **Pattern Testing**: Validate patterns match intended code before applying transformations\n• **Syntax Verification**: Ensure replacement patterns produce syntactically valid code\n• **Semantic Preservation**: Verify transformations maintain original code behavior\n• **Dependency Analysis**: Check that transformations don't break module dependencies\n• **Side Effect Assessment**: Consider impact on external code that depends on transformed functions",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to match for transformation using meta-variables"
            },
            replacement: {
              type: "string",
              description: "Replacement pattern with meta-variable substitutions"
            },
            language: {
              type: "string",
              description: "Programming language for transformation (javascript, typescript, python, etc.)"
            },
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Optional specific paths within working directory to transform"
            },
            dryRun: {
              type: "boolean",
              description: "**RECOMMENDED** - Preview changes without applying (always use first)"
            },
            interactive: {
              type: "boolean",
              description: "Enable interactive confirmation for each transformation"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory containing code to transform. All transformations are scoped to this directory."
            }
          },
          required: ["pattern", "replacement", "workingDirectory"]
        }
      },
      {
        name: "astgrep_lint",
        description: "**COMPREHENSIVE CODE QUALITY ENFORCEMENT** - YAML-based rule engine for structural code validation. **ALWAYS USE FOR SYSTEMATIC QUALITY ASSURANCE** across entire codebases.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact codebase directory for quality analysis\n• Rule validation operates on all source files within the working directory tree\n• Quality metrics and violation reports are scoped to the working directory\n• All file paths in violation reports are relative to the working directory\n• **ALWAYS specify this parameter** - essential for accurate code quality assessment\n\n**COMPREHENSIVE QUALITY BATCHING:**\nThis tool can efficiently batch ALL of the following quality assurance operations:\n• **Security Vulnerability Scanning**: SQL injection, XSS, code injection, unsafe operations in one ruleset\n• **Performance Anti-pattern Detection**: N+1 queries, synchronous operations, memory leaks, inefficient algorithms\n• **Architecture Compliance Validation**: Layer violations, circular dependencies, improper coupling, design pattern violations\n• **Code Style Standardization**: Naming conventions, formatting consistency, comment standards, file organization\n• **Error Handling Assessment**: Missing try/catch, improper error propagation, silent failures, exception handling\n• **API Design Validation**: REST conventions, GraphQL best practices, middleware patterns, response formatting\n• **Database Interaction Quality**: Query optimization, transaction handling, connection management, ORM usage\n• **Testing Pattern Enforcement**: Test naming, assertion patterns, mock usage, coverage requirements\n• **Documentation Standards**: Function documentation, type annotations, README requirements, comment quality\n• **Dependency Management**: Import organization, unused dependencies, circular imports, version consistency\n\n**ADVANCED RULE ORCHESTRATION:**\n```yaml\n# EXCELLENT: Comprehensive security and performance ruleset\nrules:\n  - id: security-comprehensive\n    message: Critical security violations detected\n    rule:\n      any:\n        # Code injection vulnerabilities\n        - pattern: eval($EXPR)\n        - pattern: new Function($ARGS)\n        - pattern: $OBJ.innerHTML = $UNSAFE\n        - pattern: document.write($CONTENT)\n        # SQL injection patterns\n        - pattern: $DB.query('$SQL' + $VAR)\n        - pattern: $DB.raw($TEMPLATE + $INPUT)\n        # XSS vulnerabilities\n        - pattern: $ELEMENT.innerHTML = $USER_INPUT\n    severity: error\n    fix: Add input validation and use safe alternatives\n\n  - id: performance-optimization\n    message: Performance anti-patterns detected\n    rule:\n      any:\n        # Inefficient loops\n        - pattern: for ($ITEM of $ARRAY) { await $ASYNC_OP }\n        - pattern: $ARRAY.forEach(async ($ITEM) => { await $OP })\n        # N+1 query patterns\n        - pattern: for ($ITEM of $ITEMS) { $DB.query($QUERY) }\n        # Synchronous operations in async contexts\n        - pattern: fs.readFileSync($PATH)\n    severity: warning\n    fix: Use Promise.all(), batch operations, or async alternatives\n\n  - id: architecture-patterns\n    message: Architecture compliance violations\n    rule:\n      any:\n        # Direct database access from controllers\n        - pattern: class $CONTROLLER { $METHOD() { $DB.query($$$) } }\n        # Missing error boundaries\n        - pattern: async function $NAME($$$) { $$$BODY }\n          not: { has: { pattern: try { $$$ } catch { $$$ } } }\n    severity: info\n    fix: Use proper layering and error handling patterns\n```\n\n**WORKING DIRECTORY FUNCTIONALITY:**\n• **Recursive Analysis**: Scans all source files within working directory and subdirectories\n• **Rule Application**: Applies YAML rules consistently across entire directory structure\n• **Context Awareness**: Maintains file relationships and project structure during analysis\n• **Scope Management**: Limits analysis to working directory boundaries for focused results\n• **Report Generation**: Creates violation reports with paths relative to working directory\n\n**RULE DESIGN EXCELLENCE:**\n• **Multi-Pattern Rules**: Use `any`, `all`, `not` combinators for comprehensive coverage\n• **Severity Stratification**: Error (critical) → Warning (important) → Info (nice-to-have) → Hint (suggestions)\n• **Contextual Rules**: Include `has`, `inside`, `follows` for sophisticated pattern matching\n• **Fix Suggestions**: Provide actionable remediation guidance in rule messages\n• **Framework-Specific Rules**: Tailor rules to React, Express, Django, Spring, etc.\n\n**SYSTEMATIC VALIDATION WORKFLOWS:**\n1. **Critical Security Sweep**: Identify immediate security vulnerabilities requiring urgent fixes\n2. **Performance Bottleneck Analysis**: Find expensive operations and inefficient patterns\n3. **Architecture Compliance Check**: Validate adherence to design patterns and layering\n4. **Code Quality Assessment**: Review style, documentation, and maintainability issues\n5. **Framework Best Practices**: Ensure proper usage of libraries and frameworks\n6. **Testing Standards Validation**: Verify test quality and coverage patterns\n\n**OUTPUT OPTIMIZATION STRATEGIES:**\n• **JSON Format**: Use for programmatic processing, integration, and automated remediation\n• **Severity Filtering**: Focus on `error` level first, then `warning`, then `info`\n• **Rule Grouping**: Organize violations by rule ID for systematic fixing\n• **Path Filtering**: Use paths parameter to focus on specific modules or components\n• **Impact Summarization**: Provide high-level quality metrics and trend indicators\n\n**RULE EVOLUTION & MANAGEMENT:**\n• **Progressive Enhancement**: Start with critical rules, expand to comprehensive coverage\n• **False Positive Minimization**: Refine rules based on actual codebase patterns\n• **Team Collaboration**: Create shared rule libraries for consistent quality standards\n• **Continuous Improvement**: Regular rule review and effectiveness assessment\n• **Documentation Integration**: Link rules to coding standards and best practice guides\n\n**INTEGRATION WORKFLOWS:**\n• **Pre-commit Hooks**: Catch quality issues before code submission\n• **CI/CD Pipeline**: Automated quality gates with configurable failure thresholds\n• **Code Review Enhancement**: Systematic identification of review focus areas\n• **Refactoring Planning**: Identify improvement candidates and technical debt\n• **Onboarding Support**: Help new team members learn coding standards\n\n**REPORTING & ACTIONABILITY:**\n• **Priority Matrix**: Critical/High/Medium/Low classification for remediation planning\n• **Effort Estimation**: Assess complexity of fixes for project planning\n• **Trend Analysis**: Track quality improvements over time\n• **Team Metrics**: Individual and team quality performance indicators\n• **Compliance Reporting**: Generate reports for auditing and governance requirements",
        inputSchema: {
          type: "object",
          properties: {
            rules: {
              type: "string",
              description: "YAML rule content or path to rule file within working directory"
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
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory containing code to validate with quality rules."
            }
          },
          required: ["rules", "workingDirectory"]
        }
      },
      {
        name: "astgrep_analyze",
        description: "**DEEP STRUCTURAL CODE INVESTIGATION** - AST exploration and pattern debugging tool. **ALWAYS USE FOR COMPLEX PATTERN ANALYSIS** and understanding intricate code structures.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact codebase directory for AST analysis\n• AST parsing and analysis operate on source files within the working directory\n• Pattern debugging uses code examples found in the working directory\n• All analysis results are contextualized to the working directory structure\n• **ALWAYS specify this parameter** - essential for accurate structural analysis\n\n**COMPREHENSIVE ANALYSIS BATCHING:**\nThis tool can efficiently batch ALL of the following structural analysis operations:\n• **Pattern Development & Debugging**: Test multiple pattern variations and refinements simultaneously\n• **AST Structure Exploration**: Analyze complex code constructs across multiple files and languages\n• **Meta-variable Validation**: Test meta-variable captures across diverse code examples\n• **Framework Pattern Analysis**: Deep-dive into React components, Express middleware, Django views\n• **Architecture Pattern Investigation**: Analyze design patterns, architectural decisions, code organization\n• **Performance Pattern Detection**: Identify performance bottlenecks and optimization opportunities\n• **Security Pattern Assessment**: Analyze security implementations and vulnerability patterns\n• **Code Quality Deep Dive**: Understand complex quality issues and their structural causes\n• **Refactoring Preparation**: Comprehensive analysis before major code transformations\n• **Educational Code Exploration**: Learn unfamiliar codebases through structural analysis\n\n**ADVANCED ANALYSIS WORKFLOWS:**\n```\n// EXCELLENT: Comprehensive React component analysis\npattern: \"function $COMPONENT($PROPS) {\n  const [$STATE, $SETTER] = useState($INITIAL);\n  $$$HOOKS\n  $$$BODY\n  return $JSX;\n}\"\nlanguage: \"javascript\"\ndebugQuery: true\nshowFullTree: true\n\n// EXCELLENT: API endpoint security analysis\npattern: \"app.$METHOD('$PATH', $$$MIDDLEWARE, ($REQ, $RES) => {\n  $$$BODY\n})\"\nlanguage: \"javascript\"\ndebugQuery: true\n\n// EXCELLENT: Database query pattern investigation\npattern: \"$MODEL.$OPERATION({\n  where: $CONDITIONS,\n  $$$OPTIONS\n})\"\nlanguage: \"javascript\"\nshowFullTree: true\n```\n\n**WORKING DIRECTORY FUNCTIONALITY:**\n• **Code Context**: Analyzes patterns within the context of actual project code\n• **File Discovery**: Finds relevant code examples within working directory for analysis\n• **Structure Mapping**: Maps AST structures to actual file locations and relationships\n• **Pattern Testing**: Tests patterns against real code found in working directory\n• **Result Contextualization**: Provides analysis results relative to working directory structure\n\n**DEEP STRUCTURAL INVESTIGATION TECHNIQUES:**\n• **AST Tree Visualization**: Complete abstract syntax tree exploration with node relationships\n• **Pattern Boundary Analysis**: Precise understanding of what patterns match and why\n• **Meta-variable Forensics**: Detailed analysis of what each meta-variable captures\n• **Context Dependency Analysis**: Understanding how surrounding code affects pattern matching\n• **Performance Impact Assessment**: Analyzing computational cost of different pattern approaches\n\n**ADVANCED DEBUGGING SCENARIOS:**\n• **Complex Framework Components**: React hooks, Vue composition API, Angular components with dependency injection\n• **Async Flow Complexity**: Promise chains, async generators, concurrent operations, error propagation\n• **Database Integration Patterns**: ORM relationships, query optimization, transaction boundaries\n• **API Architecture Analysis**: Middleware chains, authentication flows, validation layers, error handling\n• **Type System Integration**: Generic types, conditional types, mapped types, type inference\n• **Macro and Template Analysis**: C++ templates, Rust macros, preprocessor directives\n\n**PATTERN DEVELOPMENT MASTERY:**\n1. **Hypothesis Formation**: Start with structural assumptions about code patterns\n2. **AST Exploration**: Use analysis to understand actual code structure and requirements\n3. **Pattern Iterative Refinement**: Systematically improve pattern accuracy and coverage\n4. **Validation Against Diverse Examples**: Test patterns across different code styles and contexts\n5. **Performance Optimization**: Refine patterns for optimal matching speed and accuracy\n6. **Documentation and Library Creation**: Build reusable pattern libraries with detailed explanations\n\n**OUTPUT INTERPRETATION MASTERY:**\n• **AST Node Analysis**: Deep understanding of syntax tree node types and relationships\n• **Pattern Matching Logic**: Insight into why patterns succeed or fail in specific contexts\n• **Meta-variable Behavior**: Comprehensive understanding of capture semantics and scope\n• **Edge Case Discovery**: Identification of scenarios where patterns behave unexpectedly\n• **Performance Characteristics**: Understanding of pattern matching efficiency and optimization\n\n**MULTI-LANGUAGE STRUCTURAL ANALYSIS:**\n• **Cross-Language Pattern Comparison**: Analyze how similar concepts are structured differently\n• **Framework-Specific Patterns**: Deep understanding of framework-imposed structural constraints\n• **Language Evolution Impact**: How new language features affect existing structural patterns\n• **Interoperability Analysis**: Understanding patterns that bridge different languages or systems\n\n**COMPLEX SCENARIO DEBUGGING:**\n• **Deeply Nested Structures**: Analysis of complex inheritance hierarchies, nested closures, callback chains\n• **Generic and Template Patterns**: Understanding parameterized types and template instantiation\n• **Dynamic Code Generation**: Analysis of reflection, eval, runtime code creation patterns\n• **Concurrency Patterns**: Thread safety, async operations, parallel processing structures\n• **Memory Management Patterns**: Allocation, deallocation, garbage collection, resource management\n\n**PERFORMANCE AND OPTIMIZATION ANALYSIS:**\n• **Computational Complexity**: Understanding algorithmic complexity through structural analysis\n• **Memory Usage Patterns**: Analyzing object creation, destruction, and lifecycle patterns\n• **I/O Operation Patterns**: File system, network, database operation structural analysis\n• **Caching and Optimization**: Analyzing performance optimization patterns and their effectiveness\n\n**INTEGRATION WITH WORKFLOW:**\n• **Pre-Search Pattern Development**: Understand code structure before writing search patterns\n• **Pre-Transformation Analysis**: Comprehensive analysis before designing code replacements\n• **Quality Rule Development**: Create sophisticated lint rules through deep structural understanding\n• **Architecture Documentation**: Generate technical documentation from structural analysis insights\n• **Code Review Enhancement**: Provide deep insights for thorough code review processes",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to analyze in depth with meta-variables and structural elements"
            },
            language: {
              type: "string",
              description: "Programming language for AST parsing (javascript, typescript, python, rust, etc.)"
            },
            debugQuery: {
              type: "boolean",
              description: "Enable debug mode for detailed query analysis and pattern matching insights"
            },
            showFullTree: {
              type: "boolean",
              description: "Show complete AST tree context for comprehensive structural understanding"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory containing code to analyze for structural patterns and AST investigation."
            }
          },
          required: ["pattern", "workingDirectory"]
        }
      },
      {
        name: "astgrep_enhanced_search",
        description: "**ENHANCED AST-GREP SEARCH** - Advanced pattern search with structured JSON output, metadata, and performance insights. **ALWAYS USE FOR DETAILED ANALYSIS** with comprehensive result formatting.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact codebase directory for enhanced analysis\n• Enhanced search operates on all source files within the working directory tree\n• Performance metrics and metadata are scoped to the working directory\n• All file paths in enhanced results are relative to the working directory\n• **ALWAYS specify this parameter** - essential for accurate enhanced search analysis\n\n**COMPREHENSIVE ENHANCED BATCHING:**\nThis tool can efficiently batch ALL of the following enhanced search operations:\n• **Multi-Pattern Analysis**: Search multiple related patterns with unified JSON output and metadata\n• **Performance Benchmarking**: Track search performance across different pattern complexities and codebase sizes\n• **Integration Data Generation**: Create structured data for CI/CD integration, reporting, and automation\n• **Code Quality Metrics**: Generate detailed metrics on pattern matches, code coverage, and structural analysis\n• **Cross-Language Pattern Comparison**: Compare similar patterns across different programming languages\n• **Architecture Documentation**: Generate structured architectural insights with precise location data\n• **Security Analysis Integration**: Structured vulnerability and security pattern detection with metadata\n• **Refactoring Planning**: Detailed analysis for complex refactoring projects with performance tracking\n• **Development Workflow Integration**: Structured output for IDE plugins, editor extensions, and development tools\n• **Code Review Enhancement**: Detailed pattern analysis for comprehensive code review processes\n\n**ENHANCED OUTPUT CAPABILITIES:**\n• **JSON Format Control**: Choose between compact (efficiency), stream (real-time), or pretty (human-readable)\n• **Rich Metadata Integration**: Pattern complexity analysis, execution time, memory usage, match quality scores\n• **Column-Level Precision**: Exact character positions, byte offsets, and Unicode-aware positioning\n• **Performance Insights**: Matches per second, pattern compilation time, search optimization suggestions\n• **Structured Result Data**: Enhanced AST node information, meta-variable captures, contextual relationships\n• **Quality Metrics**: Pattern match confidence scores, false positive likelihood, result reliability indicators\n\n**ADVANCED FORMATTING STRATEGIES:**\n```javascript\n// Real-time processing for large codebases\njsonFormat: 'stream'\nincludeMetadata: true\n\n// Human-readable analysis reports\njsonFormat: 'pretty'\nincludeMetadata: true\ncontext: 5\n\n// Efficient programmatic processing\njsonFormat: 'compact'\nincludeMetadata: false\ncontext: 0\n```\n\n**WORKING DIRECTORY FUNCTIONALITY:**\n• **Enhanced File Discovery**: Recursively finds and analyzes all source files with detailed metadata\n• **Context-Aware Analysis**: Maintains file relationships and project structure in enhanced results\n• **Performance Scoping**: Optimizes search performance within working directory boundaries\n• **Metadata Generation**: Creates comprehensive project-scoped metadata and statistics\n• **Result Correlation**: Links search results to project structure and file relationships\n\n**INTEGRATION USE CASES:**\n• **CI/CD Pipeline Integration**: Generate structured reports for automated quality gates and deployment decisions\n• **IDE and Editor Plugins**: Provide rich data for syntax highlighting, code navigation, and refactoring tools\n• **Code Analysis Platforms**: Feed structured data into code quality and security analysis platforms\n• **Documentation Generation**: Create automated documentation from structural pattern analysis\n• **Migration Tools**: Support large-scale code migration projects with detailed pattern mapping\n• **Performance Monitoring**: Track code pattern evolution and performance impact over time\n\n**ENHANCED METADATA FEATURES:**\n• **Pattern Complexity Scoring**: Algorithmic analysis of pattern computational complexity\n• **Match Quality Assessment**: Confidence scores and reliability indicators for each match\n• **Performance Profiling**: Detailed timing information for optimization insights\n• **Memory Usage Tracking**: Analysis of memory consumption during pattern matching\n• **Optimization Suggestions**: Recommendations for pattern and search performance improvements\n\n**STRUCTURED OUTPUT BENEFITS:**\n• **Programmatic Processing**: JSON structure optimized for automated analysis and manipulation\n• **API Integration**: Direct integration with REST APIs, GraphQL endpoints, and microservices\n• **Database Storage**: Structured format suitable for database storage and querying\n• **Analytics Integration**: Compatible with data analytics platforms and business intelligence tools\n• **Visualization Support**: Data structure optimized for creating charts, graphs, and visual reports\n\n**PERFORMANCE OPTIMIZATION:**\n• **Stream Processing**: Use 'stream' format for processing large codebases without memory issues\n• **Selective Metadata**: Include only necessary metadata to optimize processing speed\n• **Context Control**: Adjust context lines based on analysis requirements vs. performance needs\n• **Path Targeting**: Use paths parameter to limit search scope for focused analysis\n• **Strictness Tuning**: Balance pattern accuracy with search performance using appropriate strictness",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to search for with enhanced analysis capabilities"
            },
            language: {
              type: "string",
              description: "Programming language for enhanced parsing (javascript, typescript, python, etc.)"
            },
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Optional specific paths within working directory for focused enhanced analysis"
            },
            context: {
              type: "number",
              description: "Number of context lines for enhanced output (default: 3, affects output size)"
            },
            strictness: {
              type: "string",
              enum: ["cst", "smart", "ast", "relaxed"],
              description: "Pattern matching strictness for enhanced analysis precision"
            },
            jsonFormat: {
              type: "string",
              enum: ["compact", "stream", "pretty"],
              description: "Enhanced JSON output format: 'compact' (efficiency), 'stream' (large data), 'pretty' (readable)"
            },
            includeMetadata: {
              type: "boolean",
              description: "Include comprehensive metadata and performance insights (recommended: true)"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory for enhanced AST search with detailed analysis and structured output."
            }
          },
          required: ["pattern", "workingDirectory"]
        }
      },
      {
        name: "astgrep_multi_pattern",
        description: "**MULTI-PATTERN AST SEARCH** - Search for multiple patterns with logical operators (AND, OR, NOT). **ALWAYS USE FOR COMPLEX QUERIES** that require sophisticated pattern combinations.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact codebase directory for multi-pattern analysis\n• Multi-pattern search operates across all source files within the working directory\n• Logical operations are applied consistently across the entire directory structure\n• All result paths are relative to the working directory for consistent reporting\n• **ALWAYS specify this parameter** - essential for accurate multi-pattern analysis\n\n**COMPREHENSIVE MULTI-PATTERN BATCHING:**\nThis tool can efficiently batch ALL of the following complex pattern operations:\n• **Security Vulnerability Hunting**: Combine multiple vulnerability patterns (SQL injection AND missing validation)\n• **Architecture Compliance Checking**: Find components that match multiple architectural requirements\n• **Performance Bottleneck Analysis**: Locate code with multiple performance anti-patterns simultaneously\n• **Quality Assurance Automation**: Complex quality checks combining multiple code quality indicators\n• **Refactoring Candidate Identification**: Find code matching multiple refactoring criteria\n• **Framework Migration Assessment**: Identify code patterns requiring multiple migration steps\n• **Code Review Automation**: Complex pattern combinations for thorough code review\n• **Technical Debt Analysis**: Combine multiple debt indicators for comprehensive assessment\n• **API Design Validation**: Multi-pattern validation for REST/GraphQL API consistency\n• **Cross-Cutting Concern Analysis**: Find patterns spanning multiple architectural concerns\n\n**ADVANCED LOGICAL OPERATORS:**\n• **ANY (OR)** - Find code matching any of the provided patterns (union operation)\n• **ALL (AND)** - Find code that satisfies all patterns simultaneously (intersection operation)\n• **NOT** - Find matches from first pattern excluding subsequent patterns (difference operation)\n• **Complex Combinations** - Nest operators for sophisticated boolean logic expressions\n\n**SOPHISTICATED QUERY STRATEGIES:**\n```javascript\n// EXCELLENT: Comprehensive security analysis\npatterns: [\n  'app.$METHOD($PATH, ($REQ, $RES) => { $DB.query($SQL + $INPUT) })',  // SQL injection risk\n  'if (!$AUTH.verify($TOKEN)) { throw $ERROR }',                         // Authentication check\n  '$INPUT = $REQ.body.$FIELD'                                            // Input handling\n],\noperator: 'all'  // Find endpoints with ALL security concerns\n\n// EXCELLENT: Performance bottleneck hunting\npatterns: [\n  'for ($ITEM of $ARRAY) { await $ASYNC_OP }',      // Async in loop\n  '$DB.query($SQL)',                                 // Database query\n  'JSON.parse($LARGE_STRING)'                       // JSON parsing\n],\noperator: 'any'  // Find ANY performance issues\n\n// EXCELLENT: Refactoring candidate identification\npatterns: [\n  'function $NAME($$$PARAMS) { $$$BODY }',           // Function definition\n  'if ($CONDITION) { return $VALUE }',               // Early return\n  'try { $$$ } catch ($ERR) { console.log($ERR) }'  // Error handling\n],\noperator: 'all'  // Functions with ALL these patterns\n```",
        inputSchema: {
          type: "object",
          properties: {
            patterns: {
              type: "array",
              items: { type: "string" },
              description: "Array of AST patterns to search for",
              minItems: 1
            },
            operator: {
              type: "string",
              enum: ["any", "all", "not"],
              description: "Logical operator to combine patterns (default: any)"
            },
            language: {
              type: "string",
              description: "Programming language"
            },
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Specific paths to search"
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
            includeMetadata: {
              type: "boolean",
              description: "Include search metadata (default: true)"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory for multi-pattern search operations."
            }
          },
          required: ["patterns", "workingDirectory"]
        }
      },
      {
        name: "astgrep_constraint_search",
        description: "**CONSTRAINT-BASED AST SEARCH** - Advanced search with validation constraints, performance thresholds, and meta-variable validation. **ALWAYS USE FOR PRECISE FILTERING** of search results.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact codebase directory for constraint-based analysis\n• Constraint validation operates on all files within the working directory scope\n• Performance thresholds and limits are applied within the working directory context\n• All constraint results use paths relative to the working directory\n• **ALWAYS specify this parameter** - essential for accurate constraint-based search\n\n**COMPREHENSIVE CONSTRAINT BATCHING:**\nThis tool can efficiently batch ALL of the following constraint-based operations:\n• **Quality Gate Enforcement**: Apply multiple quality constraints across entire codebase simultaneously\n• **Performance-Bounded Analysis**: Set execution time limits while analyzing multiple pattern types\n• **Type Safety Validation**: Validate meta-variable captures meet type requirements across languages\n• **Compliance Checking**: Ensure code matches regulatory or organizational standards with constraints\n• **Targeted Code Analysis**: Focus analysis on specific file patterns, modules, or components\n• **Resource-Constrained Environments**: Limit memory and CPU usage during large-scale analysis\n• **CI/CD Integration**: Apply constraints suitable for automated pipeline execution\n• **Security Boundary Validation**: Enforce security constraints across different code areas\n• **Architecture Compliance**: Validate architectural constraints across multiple components\n• **Code Review Automation**: Apply reviewer-specific constraints for automated code review\n\n**ADVANCED CONSTRAINT TYPES:**\n• **Count Constraints**: Minimum/maximum match requirements, density thresholds, coverage metrics\n• **File Path Patterns**: Regex-based file filtering, directory inclusion/exclusion, extension constraints\n• **Meta-variable Validation**: Type checking, format validation, semantic constraint enforcement\n• **Performance Thresholds**: Execution time limits, memory usage caps, result size limitations\n• **Context Constraints**: Line number ranges, surrounding code requirements, dependency constraints\n• **Quality Metrics**: Complexity thresholds, maintainability scores, technical debt limits\n\n**SOPHISTICATED VALIDATION STRATEGIES:**\n```javascript\n// EXCELLENT: Comprehensive quality constraints\nconstraints: {\n  minMatches: 10,              // Must find at least 10 issues\n  maxMatches: 1000,            // Don't overwhelm with results\n  filePathPattern: \"src/.*\\.(js|ts)$\",  // Only source files\n  metaVariableConstraints: {\n    \"$FUNCTION_NAME\": {\n      regex: \"^[a-z][a-zA-Z0-9]*$\",     // camelCase naming\n      type: \"identifier\",\n      minLength: 3,\n      maxLength: 50\n    },\n    \"$ERROR_TYPE\": {\n      type: \"string\",\n      enum: [\"ValidationError\", \"AuthError\", \"DatabaseError\"]\n    }\n  },\n  performanceThreshold: 30000,  // 30 second limit\n  contextConstraints: {\n    minLineNumber: 1,\n    maxFileSize: 10000,         // Skip huge files\n    requiredImports: [\"logger\", \"validator\"]\n  }\n}\n```",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to search for"
            },
            constraints: {
              type: "object",
              description: "Constraint object with validation rules",
              properties: {
                minMatches: { type: "number" },
                maxMatches: { type: "number" },
                filePathPattern: { type: "string" },
                metaVariableConstraints: { type: "object" },
                contextConstraints: { type: "object" },
                performanceThreshold: { type: "number" }
              }
            },
            language: {
              type: "string",
              description: "Programming language"
            },
            paths: {
              type: "array",
              items: { type: "string" },
              description: "Specific paths to search"
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
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory for constraint-based search operations."
            }
          },
          required: ["pattern", "workingDirectory"]
        }
      },
      {
        name: "astgrep_project_init",
        description: "**PROJECT CONFIGURATION SETUP** - Initialize ast-grep configuration and rules for a project. **ALWAYS USE TO BOOTSTRAP** ast-grep integration in new or existing projects.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact project directory for configuration setup"\n\n**PROJECT SETUP FEATURES:**\n• **Language-Specific Configuration** - Tailored setup for JavaScript, TypeScript, Python, etc.\n• **Rule Category Creation** - Generate security, performance, and style rules\n• **Test Integration** - Configure test directory patterns\n• **Custom Rule Templates** - Project-appropriate rule scaffolding\n\n**GENERATED CONFIGURATIONS:**\n• **sgconfig.yml** - Main project configuration file\n• **Rule Categories** - Security, performance, style rule files\n• **Language Patterns** - File extension and glob patterns\n• **Ignore Patterns** - Standard exclusions (node_modules, dist, etc.)\n\n**SUPPORTED PROJECT TYPES:**\n• **JavaScript** - Node.js, React, Express applications\n• **TypeScript** - Full TypeScript project support\n• **Python** - Django, Flask, general Python projects\n• **Multi-language** - Mixed technology stack support\n\n**USE CASES:**\n• **New Project Setup** - Bootstrap ast-grep integration from scratch\n• **Legacy Integration** - Add ast-grep to existing codebases\n• **Team Standardization** - Ensure consistent configuration across projects\n• **CI/CD Integration** - Prepare projects for automated quality checks",
        inputSchema: {
          type: "object",
          properties: {
            projectType: {
              type: "string",
              enum: ["javascript", "typescript", "python", "rust", "go"],
              description: "Project type for configuration generation (default: javascript)"
            },
            includeTests: {
              type: "boolean",
              description: "Include test directory patterns (default: true)"
            },
            createRules: {
              type: "boolean",
              description: "Generate rule category files (default: true)"
            },
            ruleCategories: {
              type: "array",
              items: {
                type: "string",
                enum: ["security", "performance", "style", "architecture"]
              },
              description: "Rule categories to generate (default: [security, performance, style])"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory for project initialization operations."
            }
          },
          required: ["workingDirectory"]
        }
      },
      {
        name: "astgrep_project_scan",
        description: "**PROJECT-WIDE CODE SCANNING** - Comprehensive analysis of entire projects using ast-grep rules. **ALWAYS USE FOR CODEBASE HEALTH ASSESSMENT** and quality metrics.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact project directory for comprehensive scanning"\n\n**SCAN TYPES:**\n• **Quick Scan** - Fast analysis focusing on common issues\n• **Comprehensive Scan** - Full analysis using all available rules\n• **Security Scan** - Focused security vulnerability detection\n• **Custom Scan** - User-defined rule combinations\n\n**ANALYSIS OUTPUTS:**\n• **Issue Categorization** - Group findings by type and severity\n• **File Coverage** - Track which files were analyzed\n• **Performance Metrics** - Scan speed and efficiency statistics\n• **Trend Analysis** - Historical comparison capabilities\n\n**REPORTING FEATURES:**\n• **Summary Reports** - High-level overview of findings\n• **Detailed Analysis** - Line-by-line issue identification\n• **Severity Classification** - Error, warning, info, hint levels\n• **Actionable Insights** - Prioritized remediation recommendations\n\n**USE CASES:**\n• **Code Quality Assessment** - Regular codebase health checks\n• **Security Auditing** - Identify potential vulnerabilities\n• **Pre-deployment Validation** - Ensure quality before releases\n• **Technical Debt Analysis** - Quantify maintenance requirements",
        inputSchema: {
          type: "object",
          properties: {
            scanType: {
              type: "string",
              enum: ["quick", "comprehensive", "security"],
              description: "Type of scan to perform (default: comprehensive)"
            },
            outputFormat: {
              type: "string",
              enum: ["summary", "detailed", "json"],
              description: "Output format preference (default: summary)"
            },
            includeMetrics: {
              type: "boolean",
              description: "Include performance and coverage metrics (default: true)"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory for project scanning operations."
            }
          },
          required: ["workingDirectory"]
        }
      },
      {
        name: "astgrep_test",
        description: "**RULE TESTING AND VALIDATION** - Test ast-grep rules against code examples to ensure correctness. **ALWAYS USE FOR RULE DEVELOPMENT** and quality assurance.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact project directory for rule testing"\n\n**TESTING CAPABILITIES:**\n• **Rule Validation** - Verify rule syntax and logic correctness\n• **Test Case Execution** - Run rules against sample code\n• **Performance Testing** - Measure rule execution speed\n• **Regression Testing** - Ensure rules work across code variations\n\n**TEST SUITE FEATURES:**\n• **Automated Test Generation** - Create test cases from common patterns\n• **Expected Result Validation** - Verify matches meet expectations\n• **Negative Testing** - Ensure rules don't match unintended code\n• **Cross-Language Testing** - Validate rules across different languages\n\n**VALIDATION TYPES:**\n• **Syntax Validation** - Check YAML syntax and rule structure\n• **Logic Validation** - Verify rule semantics and completeness\n• **Performance Validation** - Ensure acceptable execution speed\n• **Integration Testing** - Test rules within project context\n\n**DEBUGGING SUPPORT:**\n• **Verbose Output** - Detailed execution traces\n• **Pattern Analysis** - Understand why patterns match or don't match\n• **Meta-variable Inspection** - Examine captured variables\n• **AST Visualization** - See how patterns map to code structure\n\n**USE CASES:**\n• **Rule Development** - Iterative rule creation and refinement\n• **Quality Assurance** - Ensure rules work as intended\n• **Documentation** - Generate examples and test cases\n• **Continuous Integration** - Automated rule testing in pipelines",
        inputSchema: {
          type: "object",
          properties: {
            rulesPath: {
              type: "string",
              description: "Path to rules file to test"
            },
            rules: {
              type: "string",
              description: "YAML rule content (alternative to rulesPath)"
            },
            testCases: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  code: { type: "string" },
                  language: { type: "string" },
                  expectedMatches: { type: "number" },
                  shouldMatch: { type: "boolean" },
                  ruleId: { type: "string" }
                }
              },
              description: "Test cases to run against the rules"
            },
            createTestSuite: {
              type: "boolean",
              description: "Generate test cases automatically (default: true if no test cases provided)"
            },
            outputFormat: {
              type: "string",
              enum: ["detailed", "summary", "json"],
              description: "Output format for test results (default: detailed)"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory for rule testing operations."
            }
          },
          required: ["workingDirectory"]
        }
      },
      {
        name: "astgrep_validate_rules",
        description: "**RULE VALIDATION ENGINE** - Comprehensive validation of ast-grep rules for syntax, logic, and performance. **ALWAYS USE FOR RULE QUALITY ASSURANCE**.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact project directory for rule validation"\n\n**VALIDATION CATEGORIES:**\n• **Syntax Validation** - YAML structure and ast-grep syntax checking\n• **Logic Validation** - Rule completeness and semantic correctness\n• **Performance Validation** - Execution speed and efficiency testing\n• **Best Practices** - Adherence to rule writing guidelines\n\n**VALIDATION OUTPUTS:**\n• **Error Reporting** - Critical issues that prevent rule execution\n• **Warning System** - Potential issues and improvement suggestions\n• **Performance Metrics** - Execution time and efficiency measurements\n• **Recommendation Engine** - Specific improvement suggestions\n\n**USE CASES:**\n• **Pre-deployment Validation** - Ensure rules are production-ready\n• **Rule Review Process** - Systematic quality assessment\n• **Performance Optimization** - Identify and resolve slow rules\n• **Team Standards** - Enforce consistent rule quality",
        inputSchema: {
          type: "object",
          properties: {
            rules: {
              type: "string",
              description: "YAML rule content to validate"
            },
            validateSyntax: {
              type: "boolean",
              description: "Enable syntax validation (default: true)"
            },
            validateLogic: {
              type: "boolean",
              description: "Enable logic validation (default: true)"
            },
            validatePerformance: {
              type: "boolean",
              description: "Enable performance validation (default: true)"
            },
            performanceThreshold: {
              type: "number",
              description: "Performance threshold in milliseconds (default: 5000)"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory for rule validation operations."
            }
          },
          required: ["rules", "workingDirectory"]
        }
      },
      {
        name: "astgrep_debug_rule",
        description: "**RULE DEBUGGING TOOLKIT** - Debug and analyze specific ast-grep rules with detailed output. **ALWAYS USE FOR TROUBLESHOOTING** rule behavior and pattern matching.\n\n**MANDATORY WORKING DIRECTORY:**\n• `workingDirectory` parameter is **REQUIRED** - specify the exact project directory for rule debugging"\n\n**DEBUGGING FEATURES:**\n• **Verbose Execution** - Detailed step-by-step pattern matching\n• **AST Tree Visualization** - See how patterns map to code structure\n• **Meta-variable Analysis** - Examine captured variable content\n• **Pattern Matching Trace** - Understand why matches succeed or fail\n\n**TEST CODE INTEGRATION:**\n• **Custom Test Code** - Provide specific code to test against\n• **Language Support** - Multi-language debugging capabilities\n• **Real-time Analysis** - Immediate feedback on pattern behavior\n• **Context Preservation** - Maintain debugging session state\n\n**OUTPUT FORMATS:**\n• **Human-readable** - Formatted output for manual analysis\n• **JSON Structure** - Machine-readable debugging data\n• **Verbose Logging** - Comprehensive execution traces\n• **Summary Reports** - Condensed debugging insights\n\n**USE CASES:**\n• **Pattern Development** - Iterative pattern refinement\n• **Bug Investigation** - Understand unexpected rule behavior\n• **Learning Tool** - Educational exploration of AST patterns\n• **Rule Optimization** - Performance and accuracy improvements",
        inputSchema: {
          type: "object",
          properties: {
            ruleId: {
              type: "string",
              description: "ID of the rule to debug"
            },
            rulesPath: {
              type: "string",
              description: "Path to rules file containing the rule"
            },
            testCode: {
              type: "string",
              description: "Code to test the rule against"
            },
            language: {
              type: "string",
              description: "Programming language for the test code (default: javascript)"
            },
            verboseOutput: {
              type: "boolean",
              description: "Enable verbose debugging output (default: true)"
            },
            workingDirectory: {
              type: "string",
              description: "**REQUIRED** - Working directory for rule debugging operations."
            }
          },
          required: ["ruleId", "workingDirectory"]
        }
      },
      {
        name: "executebash",
        description: "**BASH COMMAND EXECUTION ENGINE** - Execute bash commands with mandatory working directory context and batching support. **USE FOR SYSTEM OPERATIONS** that require shell access.\n\n**CRITICAL EXECUTION PRINCIPLES:**\n• **REQUIRED WORKING DIRECTORY** - workingDirectory parameter is mandatory for all bash operations\n• **BATCHING SUPPORT** - Execute multiple commands in sequence with comprehensive error handling\n• **SECURITY VALIDATION** - Built-in validation prevents obviously dangerous command patterns\n• **COMPREHENSIVE OUTPUT** - Captures stdout, stderr, exit codes, and execution timing\n\n**BATCHING STRATEGIES:**\n```javascript\n// EXCELLENT: Batch related file operations\ncommands: [\n  'ls -la',\n  'find . -name \"*.js\" | head -10',\n  'du -sh *'\n]\n\n// EXCELLENT: Development workflow batching\ncommands: [\n  'npm install',\n  'npm run build',\n  'npm test'\n]\n```\n\n**OUTPUT OPTIMIZATION:**\n• **Progress Tracking** - Shows command execution progress and timing\n• **Error Propagation** - Stops execution on first failure with clear error reporting\n• **Working Directory Context** - Always shows the directory where commands executed\n• **Exit Code Reporting** - Provides detailed exit status for debugging\n\n**SECURITY FEATURES:**\n• **Dangerous Command Detection** - Prevents obviously harmful operations\n• **Working Directory Validation** - Ensures target directory exists and is accessible\n• **Command Validation** - Validates command structure before execution\n• **Error Boundaries** - Comprehensive error handling with context preservation\n\n**INTEGRATION PATTERNS:**\n• **Development Workflows** - Build, test, deployment command sequences\n• **File System Operations** - Directory creation, file manipulation, cleanup\n• **System Diagnostics** - Health checks, resource monitoring, log analysis\n• **Environment Setup** - Dependency installation, configuration, initialization\n\n**WORKING DIRECTORY REQUIREMENTS:**\n• **Mandatory Parameter** - workingDirectory must be explicitly provided\n• **Path Validation** - Directory existence and accessibility verified\n• **Context Preservation** - All commands execute in the specified directory\n• **Absolute Paths** - Working directory resolved to absolute path for consistency\n\n**ERROR HANDLING:**\n• **Immediate Failure** - Execution stops on first command failure\n• **Comprehensive Reporting** - stdout, stderr, and error context provided\n• **Exit Code Analysis** - Detailed exit status information for troubleshooting\n• **Timeout Protection** - Configurable timeout prevents hanging operations\n\n**USE CASES:**\n• **CI/CD Pipelines** - Automated build and deployment sequences\n• **Development Setup** - Environment initialization and dependency management\n• **System Administration** - File system operations, service management\n• **Testing and Validation** - Integration tests, system health checks",
        inputSchema: {
          type: "object",
          properties: {
            commands: {
              type: "array",
              items: { type: "string" },
              description: "Array of bash commands to execute in sequence"
            },
            command: {
              type: "string",
              description: "Single bash command to execute (alternative to commands array)"
            },
            timeout: {
              type: "number",
              description: "Optional timeout in milliseconds (default: 120000)"
            },
            workingDirectory: {
              type: "string",
              description: "REQUIRED: Working directory for command execution"
            }
          },
          required: ["workingDirectory"]
        }
      },
      getSequentialThinkingToolDefinition(),
      {
        name: "batch_execute",
        description: "**ULTIMATE EFFICIENCY MULTIPLIER** - Execute multiple MCP operations in a single coordinated batch. **ALWAYS USE THIS TOOL** when you need multiple operations - it's 10X faster than individual calls.\n\n**MANDATORY WORKING DIRECTORY COORDINATION:**\n• Each operation in the batch **MUST** specify its own `workingDirectory` parameter\n• Operations can use the same working directory or different ones as needed\n• All file operations within each tool are scoped to their respective working directories\n• **CRITICAL**: Every operation that requires workingDirectory MUST include it in parameters\n• **ALWAYS ensure** each operation has proper working directory specification

**ALL 17 SUPPORTED TOOLS:**
This tool can batch ALL of the following MCP REPL tools in any combination:
• **executenodejs** - Execute JavaScript code with Node.js runtime
• **executedeno** - Execute TypeScript/JavaScript with Deno runtime  
• **executebash** - Execute bash commands and scripts
• **searchcode** - AI-powered semantic code search and discovery
• **astgrep_search** - AST-based structural pattern matching
• **astgrep_replace** - AST-based code transformation and refactoring
• **astgrep_lint** - YAML-based rule engine for code quality validation
• **astgrep_analyze** - Deep structural code investigation and debugging
• **astgrep_enhanced_search** - Advanced pattern search with structured JSON output
• **astgrep_multi_pattern** - Multi-pattern batch structural analysis
• **astgrep_constraint_search** - Constraint-based advanced pattern matching
• **astgrep_project_init** - Initialize AST-grep project configuration
• **astgrep_project_scan** - Comprehensive project structure analysis
• **astgrep_test** - Pattern testing and validation framework
• **astgrep_validate_rules** - Rule validation and quality assurance
• **astgrep_debug_rule** - Rule debugging and development assistance
• **sequentialthinking** - Sequential thought processing and persistence

**COMPREHENSIVE BATCH ORCHESTRATION:**\nThis tool can batch ALL of the following operation combinations:\n• **Multi-Directory Analysis**: Execute operations across different project directories simultaneously\n• **Complete Investigation Workflows**: Search → analyze → test → validate across multiple codebases\n• **Cross-Project Refactoring**: Apply consistent changes across multiple project directories\n• **Comprehensive Security Audits**: Multi-tool security analysis across entire project ecosystem\n• **Performance Analysis Campaigns**: Search bottlenecks, analyze patterns, test solutions across services\n• **Architecture Migration Projects**: Coordinate analysis and transformation across multiple components\n• **Quality Assurance Automation**: Lint → analyze → fix → validate across different project areas\n• **Code Review Automation**: Complete review workflows combining multiple analysis approaches\n• **Technical Debt Assessment**: Comprehensive debt analysis across entire project portfolio\n• **Framework Migration Support**: Coordinate migration steps across multiple project directories\n\n**CRITICAL EFFICIENCY GAINS:**\n• **10X FASTER** than individual tool calls due to reduced overhead and parallelization\n• **ATOMIC WORKFLOWS** - Complete complex multi-step operations without interruption\n• **INTELLIGENT ERROR HANDLING** - Continues processing even if individual operations fail\n• **CONSOLIDATED RESULTS** - All outputs organized, correlated, and summarized together\n• **CROSS-OPERATION INSIGHTS** - Automatic correlation of findings across different tools\n\n**SOPHISTICATED BATCH STRATEGIES:**\n```javascript\n// EXCELLENT: Multi-directory investigation workflow\n[\n  {\n    tool: 'searchcode',\n    parameters: {\n      query: 'authentication middleware security',\n      workingDirectory: '/project/backend'\n    }\n  },\n  {\n    tool: 'astgrep_search',\n    parameters: {\n      pattern: 'app.$METHOD($PATH, $$$MIDDLEWARE, ($REQ, $RES) => { $$$ })',\n      language: 'javascript',\n      workingDirectory: '/project/backend'\n    }\n  },\n  {\n    tool: 'executenodejs',\n    parameters: {\n      code: 'const results = analyzeSecurityPatterns(); console.log(\"Analysis:\", results);',\n      workingDirectory: '/project/backend'\n    }\n  },\n  {\n    tool: 'astgrep_lint',\n    parameters: {\n      rules: 'security-rules.yml',\n      workingDirectory: '/project/backend'\n    }\n  }\n]\n\n// EXCELLENT: Cross-project refactoring workflow\n[\n  {\n    tool: 'astgrep_search',\n    parameters: {\n      pattern: 'console.log($$$)',\n      workingDirectory: '/project/frontend'\n    }\n  },\n  {\n    tool: 'astgrep_search',\n    parameters: {\n      pattern: 'console.log($$$)',\n      workingDirectory: '/project/backend'\n    }\n  },\n  {\n    tool: 'astgrep_replace',\n    parameters: {\n      pattern: 'console.log($$$)',\n      replacement: 'logger.info($$$)',\n      dryRun: true,\n      workingDirectory: '/project/frontend'\n    }\n  },\n  {\n    tool: 'astgrep_replace',\n    parameters: {\n      pattern: 'console.log($$$)',\n      replacement: 'logger.info($$$)',\n      dryRun: true,\n      workingDirectory: '/project/backend'\n    }\n  }\n]\n```\n\n**WORKING DIRECTORY COORDINATION STRATEGIES:**\n• **Single Project Analysis**: All operations use the same working directory for focused analysis\n• **Multi-Project Workflows**: Operations use different working directories for cross-project analysis\n• **Hierarchical Analysis**: Analyze parent directory, then specific subdirectories\n• **Comparative Analysis**: Compare patterns across different project structures\n• **Progressive Refinement**: Start broad (root directory), then narrow to specific areas\n\n**ADVANCED ORCHESTRATION PATTERNS:**\n• **Discovery → Analysis → Action Pipeline**: Systematic workflow progression across directories\n• **Parallel Multi-Project Analysis**: Simultaneous analysis of related projects\n• **Dependency-Aware Batching**: Order operations based on cross-directory dependencies\n• **Validation Chain Workflows**: Multi-step validation across different components\n• **Migration Coordination**: Synchronized changes across multiple project areas",
        inputSchema: {
          type: "object",
          properties: {
            operations: {
              type: "array",
              description: "Array of tool operations to execute in sequence",
              items: {
                type: "object",
                properties: {
                  tool: {
                    type: "string",
                    enum: ["executenodejs", "executedeno", "executebash", "searchcode", "astgrep_search", "astgrep_replace", "astgrep_lint", "astgrep_analyze", "astgrep_enhanced_search", "astgrep_multi_pattern", "astgrep_constraint_search", "astgrep_project_init", "astgrep_project_scan", "astgrep_test", "astgrep_validate_rules", "astgrep_debug_rule", "sequentialthinking"],
                    description: "Name of the MCP tool to execute"
                  },
                  parameters: {
                    type: "object",
                    description: "Parameters to pass to the tool (same as individual tool parameters)"
                  }
                },
                required: ["tool", "parameters"]
              },
              minItems: 1
            }
          },
          required: ["operations"]
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
