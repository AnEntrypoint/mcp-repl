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
        description: "**PRIMARY EXECUTION ENGINE** - Execute JavaScript code with Node.js. **PREFER THIS OVER ALL OTHER TOOLS** for code testing, debugging, and investigation.\n\n**CRITICAL EFFICIENCY PRINCIPLES:**\n• **BATCH AGGRESSIVELY** - Combine 5-10 related operations in single calls (10x faster than individual calls)\n• **CONSOLIDATE LOGIC** - Group testing, validation, file ops, API calls, and analysis together\n• **USE LOOPS/ARRAYS** - Process multiple items, files, or tests simultaneously\n• **AVOID SEQUENTIAL CALLS** - Plan comprehensive solutions that accomplish multiple goals at once\n\n**OUTPUT OPTIMIZATION STRATEGIES:**\n• Use `console.log()` strategically - only log essential results\n• Summarize large datasets instead of dumping raw data\n• Use `JSON.stringify(obj, null, 2)` for readable object inspection\n• Implement result filtering/truncation within your code\n• Return structured summaries rather than verbose logs\n\n**REPLACE EXTERNAL TOOLS WITH THIS:**\n• Instead of curl → use `fetch()` or `https` module\n• Instead of file commands → use `fs` module with batched operations\n• Instead of grep/search → use JavaScript regex and string processing\n• Instead of multiple CLI tools → write unified JavaScript solutions\n\n**BATCHING PATTERNS:**\n```javascript\n// GOOD: Batch multiple API tests\nconst apis = ['endpoint1', 'endpoint2', 'endpoint3'];\nconst results = await Promise.allSettled(apis.map(test));\nconsole.log('Summary:', results.map(r => r.status));\n\n// GOOD: Batch file operations\nconst files = ['file1.js', 'file2.js'];\nconst analysis = files.map(file => ({\n  file, size: fs.statSync(file).size,\n  hasIssues: /problematic/.test(fs.readFileSync(file))\n}));\n```\n\n**DEBUGGING METHODOLOGY:**\n1. **Hypothesis Formation** - Write code that tests specific assumptions\n2. **Batch Validation** - Test multiple scenarios simultaneously\n3. **Incremental Refinement** - Use results to guide next batch of tests\n4. **Comprehensive Coverage** - Ensure all edge cases tested in minimal calls\n\n**WORKING DIRECTORY CONTEXT:**\n• Specify `workingDirectory` parameter to operate in different project contexts\n• Batch operations across multiple directories when needed\n• Use absolute paths for cross-directory file operations",
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
        description: "**TYPESCRIPT EXECUTION ENGINE** - Execute TypeScript/JavaScript with Deno runtime. **USE FOR TYPE-SAFE OPERATIONS** and when TypeScript validation is needed.\n\n**CRITICAL EFFICIENCY PRINCIPLES:**\n• **BATCH TYPESCRIPT OPERATIONS** - Combine type checking, compilation, and testing in single calls\n• **LEVERAGE TYPE SAFETY** - Use TypeScript features to catch errors during execution\n• **CONSOLIDATE WEB OPERATIONS** - Group multiple fetch requests, file operations, and validations\n• **UTILIZE DENO FEATURES** - Built-in testing, formatting, and web APIs in batched operations\n\n**ADVANCED BATCHING STRATEGIES:**\n```typescript\n// GOOD: Batch type checking and testing\ninterface TestCase { name: string; input: unknown; expected: unknown; }\nconst testSuite: TestCase[] = [...];\nconst results = testSuite.map(test => ({\n  ...test,\n  passed: runTest(test.input) === test.expected,\n  type: typeof test.input\n}));\nconsole.log('Test Summary:', {\n  total: results.length,\n  passed: results.filter(r => r.passed).length\n});\n```\n\n**OUTPUT OPTIMIZATION FOR DENO:**\n• Use Deno.inspect() instead of JSON.stringify for better object formatting\n• Leverage built-in formatters and validators\n• Implement streaming for large data processing\n• Use Deno's built-in compression for large outputs\n\n**REPLACE EXTERNAL TYPESCRIPT TOOLS:**\n• Instead of tsc → use Deno's built-in TypeScript compilation\n• Instead of separate test runners → use Deno.test() in batched scenarios\n• Instead of external formatters → use Deno fmt programmatically\n• Instead of multiple HTTP clients → use native fetch with type safety\n\n**TYPE-DRIVEN DEVELOPMENT PATTERNS:**\n• Define comprehensive interfaces for batch operations\n• Use generics to create reusable batch processing functions\n• Leverage union types for handling multiple operation types\n• Implement type guards for runtime validation\n\n**WEB API OPTIMIZATION:**\n• Batch HTTP requests using Promise.allSettled()\n• Use Deno's native Web Streams for efficient data processing\n• Implement retry logic and error handling in batched operations\n• Leverage Deno's built-in caching for repeated operations\n\n**SECURITY & PERMISSIONS:**\n• Runs with `--allow-all` - use responsibly for comprehensive operations\n• Batch file system operations to minimize permission overhead\n• Consolidate network operations to reduce security surface area",
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
        description: "**INTELLIGENT CODE DISCOVERY** - AI-powered semantic search with structural understanding. **FIRST CHOICE FOR CODE EXPLORATION** before reading files or using other search tools.\n\n**SEARCH STRATEGY OPTIMIZATION:**\n• **USE BROAD QUERIES FIRST** - \"authentication logic\" finds more than \"login function\"\n• **BATCH RELATED CONCEPTS** - Search \"error handling, validation, logging\" in one query\n• **LEVERAGE SEMANTIC UNDERSTANDING** - Finds conceptually similar code, not just text matches\n• **COMBINE WITH STRUCTURAL FILTERS** - Use extensions/folders to focus scope efficiently\n\n**QUERY FORMULATION BEST PRACTICES:**\n```\n// EXCELLENT: Broad conceptual search\n\"database connection pooling configuration\"\n\n// EXCELLENT: Multi-concept batched search\n\"API authentication middleware security validation\"\n\n// GOOD: Feature-focused search\n\"user registration email verification workflow\"\n\n// AVOID: Too narrow\n\"getUserById\"\n```\n\n**OUTPUT MANAGEMENT STRATEGIES:**\n• **Use topK parameter wisely** - Start with 8-12 results, not 50+\n• **Focus on high-scoring matches** - Scores indicate relevance quality\n• **Extract key insights quickly** - Look for patterns across multiple results\n• **Summarize findings** - Don't output raw search results, synthesize insights\n\n**INTELLIGENT FILTERING TECHNIQUES:**\n• **extensions parameter**: \"js,ts,jsx,tsx\" for frontend, \"py,sql\" for backend\n• **folders parameter**: \"src/api,src/services\" for backend logic\n• **ignores parameter**: \"test,spec,node_modules,dist\" to focus on implementation\n\n**STRUCTURAL AWARENESS ADVANTAGES:**\n• Finds functions, classes, methods with full context\n• Understands inheritance, imports, and dependencies\n• Extracts parameters, return types, and documentation\n• Maps relationships between code elements\n\n**EFFICIENT EXPLORATION PATTERNS:**\n1. **Architecture Discovery**: \"main application entry points routing\"\n2. **Feature Investigation**: \"user authentication session management\"\n3. **Problem Analysis**: \"error handling exception logging\"\n4. **Integration Points**: \"database queries API endpoints\"\n5. **Configuration Management**: \"environment variables configuration setup\"\n\n**MULTI-PROJECT WORKFLOWS:**\n• Use `workingDirectory` to search different codebases\n• Batch searches across related projects\n• Compare implementations across different repositories\n• Find similar patterns in different technology stacks\n\n**RESULTS INTERPRETATION:**\n• **High scores (>0.8)**: Highly relevant, likely what you need\n• **Medium scores (0.6-0.8)**: Related concepts, worth investigating\n• **Low scores (<0.6)**: Tangentially related, useful for context\n• **Qualified names**: Full path shows code organization\n• **Structure metadata**: Parameters, types, inheritance information",
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
        description: "**STRUCTURAL CODE ANALYSIS** - AST-based pattern matching for precise code discovery. **USE AFTER SEMANTIC SEARCH** for structural validation and precise pattern matching.\n\n**PATTERN DESIGN STRATEGIES:**\n• **USE META-VARIABLES** - `$VAR` captures any expression, `$$$BODY` captures multiple statements\n• **DESIGN INCLUSIVE PATTERNS** - Capture families of similar constructs in one search\n• **LAYER PATTERNS** - Start broad, then refine with specific structural requirements\n• **COMBINE STRUCTURAL ELEMENTS** - Match function + usage patterns simultaneously\n\n**ADVANCED PATTERN EXAMPLES:**\n```\n// EXCELLENT: Capture all function definitions with error handling\nfunction $NAME($$$PARAMS) {\n  try {\n    $$$BODY\n  } catch ($ERR) {\n    $$$CATCH\n  }\n}\n\n// EXCELLENT: Find all API endpoints with validation\n$ROUTER.$METHOD('$PATH', $$$MIDDLEWARE, ($REQ, $RES) => {\n  $$$BODY\n});\n\n// EXCELLENT: Database query patterns\n$DB.$OPERATION($$$ARGS).then($$$).catch($$$)\n```\n\n**BATCHING PATTERN SEARCHES:**\n• **Architectural Analysis**: Search for multiple related patterns (routes + controllers + models)\n• **Security Auditing**: Find authentication, authorization, and validation patterns\n• **Performance Investigation**: Locate loops, queries, and resource-intensive operations\n• **Refactoring Planning**: Identify code that follows similar patterns for transformation\n\n**OUTPUT OPTIMIZATION:**\n• **Use context parameter** - Get surrounding code context efficiently\n• **Choose compact format** - For quick scanning of multiple results\n• **Set appropriate strictness** - `smart` for most cases, `ast` for precise matching\n• **Focus on pattern density** - Find files with multiple pattern matches\n\n**LANGUAGE-SPECIFIC STRATEGIES:**\n• **JavaScript/TypeScript**: Focus on async patterns, React components, API routes\n• **Python**: Class hierarchies, decorators, context managers\n• **Rust**: Ownership patterns, error handling, trait implementations\n• **Go**: Interface implementations, error handling, goroutine patterns\n\n**STRUCTURAL INVESTIGATION WORKFLOWS:**\n1. **API Architecture**: `$ROUTER.$METHOD` → `async function $NAME` → `await $DB.$OP`\n2. **Error Handling**: `try { $$$ } catch` → `throw new $ERROR` → `$LOG.$LEVEL`\n3. **Data Flow**: `function $NAME($PARAMS)` → `return $$$` → `$OBJ.$NAME($ARGS)`\n4. **Security Patterns**: `$AUTH.$METHOD` → `if (!$USER.$PERM)` → `throw $UNAUTHORIZED`\n\n**COMBINE WITH OTHER TOOLS:**\n• Use after `searchcode` to validate semantic findings structurally\n• Prepare for `astgrep_replace` by identifying transformation targets\n• Guide `astgrep_lint` rule creation by finding problematic patterns\n• Support `astgrep_analyze` by locating complex structural scenarios\n\n**MULTI-LANGUAGE ANALYSIS:**\n• Search similar patterns across different languages\n• Compare structural approaches between frontend/backend\n• Identify inconsistencies in code organization\n• Find architectural patterns that span multiple files",
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
        description: "**INTELLIGENT CODE TRANSFORMATION** - AST-based code rewriting with meta-variable substitution. **USE FOR SAFE, STRUCTURAL REFACTORING** after identifying patterns with search tools.\n\n**TRANSFORMATION STRATEGY:**\n• **ALWAYS DRY-RUN FIRST** - Use `dryRun: true` to preview changes before applying\n• **DESIGN COMPREHENSIVE PATTERNS** - Transform entire families of code constructs at once\n• **BATCH RELATED TRANSFORMATIONS** - Group similar refactoring operations\n• **VALIDATE TRANSFORMATIONS** - Use execution tools to test before/after behavior\n\n**ADVANCED TRANSFORMATION PATTERNS:**\n```\n// EXCELLENT: Modernize async patterns\nPATTERN: $OBJ.$METHOD($$$ARGS, function($ERR, $DATA) { $$$ })\nREPLACE: await $OBJ.$METHOD($$$ARGS)\n\n// EXCELLENT: Add error handling consistently\nPATTERN: async function $NAME($$$PARAMS) { $$$BODY }\nREPLACE: async function $NAME($$$PARAMS) {\n  try {\n    $$$BODY\n  } catch (error) {\n    logger.error('Error in $NAME:', error);\n    throw error;\n  }\n}\n\n// EXCELLENT: Standardize logging\nPATTERN: console.log($$$ARGS)\nREPLACE: logger.info($$$ARGS)\n```\n\n**BATCHING TRANSFORMATIONS:**\n• **API Modernization**: Update multiple endpoints with consistent patterns\n• **Security Hardening**: Add validation/sanitization across similar functions\n• **Performance Optimization**: Apply caching patterns to multiple database operations\n• **Style Standardization**: Enforce consistent code formatting and structure\n\n**SAFETY PROTOCOLS:**\n1. **Pre-transformation Analysis**: Use `astgrep_search` to identify all affected code\n2. **Dry-run Validation**: Preview changes to ensure correctness\n3. **Incremental Application**: Apply transformations to subsets first\n4. **Post-transformation Testing**: Use execution tools to verify functionality\n\n**OUTPUT MANAGEMENT:**\n• **Summarize Changes**: Report number of files/functions transformed\n• **Highlight Key Modifications**: Focus on critical structural changes\n• **Document Patterns**: Explain what was changed and why\n• **Provide Diff Summary**: Show before/after comparisons concisely\n\n**COMPLEX TRANSFORMATION WORKFLOWS:**\n• **Legacy Code Modernization**: Transform callback patterns to async/await\n• **Framework Migration**: Update component patterns for new versions\n• **API Standardization**: Ensure consistent error handling and response formats\n• **Security Enhancement**: Add input validation and output sanitization\n\n**MULTI-FILE COORDINATION:**\n• **Cross-file Consistency**: Apply same transformations across related files\n• **Import/Export Updates**: Maintain proper module relationships\n• **Type Definition Updates**: Keep TypeScript definitions synchronized\n• **Configuration Alignment**: Update related configuration files\n\n**ERROR PREVENTION:**\n• **Test Pattern Matching**: Ensure patterns match intended code exactly\n• **Validate Meta-variables**: Confirm substitutions produce valid code\n• **Check Side Effects**: Consider impact on dependent code\n• **Maintain Semantics**: Ensure transformations preserve original behavior\n\n**TRANSFORMATION VERIFICATION:**\n• Use `executenodejs`/`executedeno` to test transformed code\n• Run existing tests to ensure functionality preservation\n• Check for compilation/syntax errors after transformation\n• Validate that all references and dependencies remain intact",
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
        description: "**COMPREHENSIVE CODE QUALITY ENFORCEMENT** - YAML-based rule engine for structural code validation. **USE FOR SYSTEMATIC QUALITY ASSURANCE** across entire codebases.\n\n**RULE DESIGN PHILOSOPHY:**\n• **CREATE RULE SUITES** - Group related quality checks (security, performance, style)\n• **DESIGN FOR COVERAGE** - Write rules that catch multiple instances of problems\n• **BATCH VALIDATION CONCERNS** - Combine syntax, security, performance in single rulesets\n• **IMPLEMENT PROGRESSIVE CHECKING** - Start with critical issues, expand to style concerns\n\n**COMPREHENSIVE RULE CATEGORIES:**\n```yaml\n# EXCELLENT: Multi-concern security rules\nrules:\n  - id: security-bundle\n    message: Security violations detected\n    rule:\n      any:\n        - pattern: eval($EXPR)\n        - pattern: new Function($ARGS)\n        - pattern: $OBJ.innerHTML = $UNSAFE\n        - pattern: $$.exec($INPUT)\n    severity: error\n\n  - id: async-patterns\n    message: Async/await best practices\n    rule:\n      any:\n        - pattern: async function $NAME() { return $SYNC_VALUE }\n        - pattern: await $PROMISE.then($CALLBACK)\n    severity: warning\n```\n\n**EFFICIENT RULE ORCHESTRATION:**\n• **Bundle Related Rules**: Security rules, performance rules, style rules in single files\n• **Use Rule Inheritance**: Define base patterns, extend for specific scenarios\n• **Implement Severity Layers**: Error → Warning → Info → Hint progression\n• **Create Project-Specific Rules**: Tailor validation to project architecture\n\n**OUTPUT OPTIMIZATION STRATEGIES:**\n• **Use JSON format** for programmatic processing of results\n• **Filter by severity** to focus on critical issues first\n• **Group violations by rule** for systematic fixing\n• **Summarize impact** rather than listing every violation\n\n**ADVANCED RULE PATTERNS:**\n• **Anti-patterns**: Detect problematic code constructs\n• **Architecture Enforcement**: Ensure proper layering and dependencies\n• **Performance Guards**: Catch expensive operations in critical paths\n• **Security Boundaries**: Validate input sanitization and output encoding\n• **Consistency Checks**: Ensure uniform code patterns across codebase\n\n**SYSTEMATIC VALIDATION WORKFLOWS:**\n1. **Security Audit**: SQL injection, XSS, eval usage, unsafe operations\n2. **Performance Review**: N+1 queries, synchronous operations, memory leaks\n3. **Architecture Compliance**: Layer violations, circular dependencies\n4. **Code Quality**: Dead code, unused variables, complexity metrics\n5. **Style Consistency**: Naming conventions, formatting standards\n\n**RULE EVOLUTION STRATEGIES:**\n• **Start Simple**: Basic security and error-prone patterns\n• **Expand Systematically**: Add performance and architecture rules\n• **Customize for Context**: Adapt rules to specific frameworks/patterns\n• **Maintain Rule Quality**: Regular review and refinement of rule effectiveness\n\n**INTEGRATION WITH DEVELOPMENT WORKFLOW:**\n• **Pre-commit Validation**: Catch issues before code submission\n• **CI/CD Integration**: Automated quality gates in deployment pipeline\n• **Code Review Support**: Systematic identification of review points\n• **Refactoring Guidance**: Identify candidates for improvement\n\n**MULTI-PROJECT RULE MANAGEMENT:**\n• **Shared Rule Libraries**: Reuse quality rules across projects\n• **Language-Specific Rules**: Tailored validation for different tech stacks\n• **Framework-Aware Rules**: Rules specific to React, Express, Django, etc.\n• **Evolution Tracking**: Monitor rule effectiveness and false positive rates\n\n**ACTIONABLE REPORTING:**\n• **Priority-Based Grouping**: Critical issues first, style issues last\n• **Fix Difficulty Assessment**: Estimate effort required for remediation\n• **Impact Analysis**: Understand security/performance implications\n• **Trend Tracking**: Monitor code quality improvements over time",
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
        description: "**DEEP STRUCTURAL CODE INVESTIGATION** - AST exploration and pattern debugging tool. **USE FOR COMPLEX PATTERN ANALYSIS** and understanding intricate code structures.\n\n**ANALYSIS METHODOLOGIES:**\n• **PATTERN DEBUGGING** - Test and refine complex ast-grep patterns before use\n• **STRUCTURAL EXPLORATION** - Understand AST representation of code constructs\n• **META-VARIABLE VALIDATION** - Verify pattern captures work as intended\n• **QUERY OPTIMIZATION** - Improve pattern performance and accuracy\n\n**COMPREHENSIVE ANALYSIS WORKFLOWS:**\n```\n// EXCELLENT: Debug complex pattern matching\npattern: \"async function $NAME($$$PARAMS) { $$$BODY }\"\ndebugQuery: true  // Shows AST structure and matching process\nshowFullTree: true  // Reveals complete context\n\n// EXCELLENT: Analyze inheritance patterns\npattern: \"class $CHILD extends $PARENT { $$$METHODS }\"\ndebugQuery: true  // Understand class hierarchy matching\n```\n\n**STRUCTURAL INVESTIGATION TECHNIQUES:**\n• **AST Tree Exploration**: Understand how code is represented structurally\n• **Pattern Boundary Analysis**: Determine exact matching scope and limitations\n• **Meta-variable Extraction**: Test what different meta-variables capture\n• **Context Requirements**: Understand surrounding code needed for pattern matches\n\n**ADVANCED DEBUGGING SCENARIOS:**\n• **Complex React Components**: Analyze JSX structures, hooks, lifecycle patterns\n• **Async Flow Analysis**: Understand promise chains, async/await patterns\n• **Database Query Patterns**: Analyze ORM usage, query building, transaction handling\n• **API Route Architecture**: Examine middleware chains, error handling, validation\n\n**OUTPUT INTERPRETATION STRATEGIES:**\n• **Focus on AST Insights**: Understand structural relationships, not just syntax\n• **Extract Pattern Rules**: Learn how to write better patterns from analysis\n• **Identify Edge Cases**: Discover scenarios where patterns fail or succeed\n• **Document Findings**: Create reusable pattern libraries from analysis\n\n**PATTERN DEVELOPMENT LIFECYCLE:**\n1. **Initial Hypothesis**: Start with broad pattern understanding\n2. **AST Exploration**: Use analysis to understand structural requirements\n3. **Pattern Refinement**: Iteratively improve pattern accuracy\n4. **Validation Testing**: Confirm patterns work across different code examples\n5. **Documentation**: Record pattern insights for future use\n\n**MULTI-LANGUAGE AST ANALYSIS:**\n• **Cross-Language Patterns**: Compare structural approaches between languages\n• **Framework-Specific Analysis**: Understand framework-imposed AST patterns\n• **Evolution Analysis**: Track how language features affect AST structure\n• **Tool Integration**: Prepare patterns for other ast-grep operations\n\n**DEBUGGING COMPLEX SCENARIOS:**\n• **Nested Patterns**: Analyze deeply nested code structures\n• **Generic Patterns**: Understand template/generic type representations\n• **Macro Expansions**: Analyze preprocessor and macro-generated code\n• **Dynamic Constructs**: Examine reflection, eval, and runtime code generation\n\n**PERFORMANCE PATTERN ANALYSIS:**\n• **Expensive Operations**: Identify computationally costly code patterns\n• **Memory Usage Patterns**: Analyze allocation and disposal patterns\n• **I/O Bottlenecks**: Examine file system and network operation patterns\n• **Algorithmic Complexity**: Understand loop and recursion structures\n\n**EDUCATIONAL AND DIAGNOSTIC USE:**\n• **Code Comprehension**: Understand unfamiliar codebases through structural analysis\n• **Pattern Libraries**: Build comprehensive pattern collections for specific domains\n• **Refactoring Planning**: Analyze code before designing transformation strategies\n• **Architecture Validation**: Ensure code follows intended structural patterns\n\n**INTEGRATION WITH WORKFLOW:**\n• **Pre-Search Analysis**: Understand code structure before writing search patterns\n• **Pre-Transform Validation**: Analyze code before designing replacements\n• **Rule Development**: Create better lint rules through structural understanding\n• **Documentation Generation**: Extract structural insights for technical documentation",
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
      },
      {
        name: "astgrep_enhanced_search",
        description: "**ENHANCED AST-GREP SEARCH** - Advanced pattern search with structured JSON output, metadata, and performance insights. **USE FOR DETAILED ANALYSIS** with comprehensive result formatting.\n\n**ENHANCED OUTPUT FEATURES:**\n• **JSON Format Control** - Choose between compact, stream, or pretty formatting\n• **Rich Metadata** - Pattern complexity analysis, performance metrics, timestamps\n• **Column-Level Precision** - Exact character positions for precise code location\n• **Performance Insights** - Matches per second, execution time analysis\n• **Structured Results** - Enhanced data for programmatic processing\n\n**ADVANCED FORMATTING OPTIONS:**\n```javascript\n// Stream format for real-time processing\njsonFormat: 'stream'\n\n// Pretty format for human reading\njsonFormat: 'pretty'\n\n// Include comprehensive metadata\nincludeMetadata: true\n```\n\n**USE CASES:**\n• **Detailed Code Analysis** - When you need comprehensive match information\n• **Performance Monitoring** - Track search performance across large codebases\n• **Integration Workflows** - Structured data for downstream processing\n• **Debugging Complex Patterns** - Enhanced output for pattern refinement",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "AST pattern to search for"
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
            jsonFormat: {
              type: "string",
              enum: ["compact", "stream", "pretty"],
              description: "JSON output format (default: compact)"
            },
            includeMetadata: {
              type: "boolean",
              description: "Include enhanced metadata in results (default: true)"
            },
            workingDirectory: {
              type: "string",
              description: "Optional working directory for the operation"
            }
          },
          required: ["pattern"]
        }
      },
      {
        name: "astgrep_multi_pattern",
        description: "**MULTI-PATTERN AST SEARCH** - Search for multiple patterns with logical operators (AND, OR, NOT). **USE FOR COMPLEX QUERIES** that require pattern combinations.\n\n**LOGICAL OPERATORS:**\n• **ANY (OR)** - Find matches from any of the provided patterns\n• **ALL (AND)** - Find matches that satisfy all patterns simultaneously\n• **NOT** - Find matches from first pattern excluding subsequent patterns\n\n**ADVANCED QUERY EXAMPLES:**\n```javascript\n// Find functions with error handling OR logging\npatterns: ['function $NAME() { try { $$$ } catch { $$$ } }', 'function $NAME() { console.log($$$) }'],\noperator: 'any'\n\n// Find async functions that also have error handling\npatterns: ['async function $NAME($$$)', 'try { $$$ } catch ($ERR) { $$$ }'],\noperator: 'all'\n```\n\n**USE CASES:**\n• **Architecture Analysis** - Find components that match multiple criteria\n• **Quality Assurance** - Locate code meeting complex requirements\n• **Refactoring Planning** - Identify transformation candidates with multiple conditions\n• **Security Auditing** - Find code patterns with combined security concerns",
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
              description: "Optional working directory for the operation"
            }
          },
          required: ["patterns"]
        }
      },
      {
        name: "astgrep_constraint_search",
        description: "**CONSTRAINT-BASED AST SEARCH** - Advanced search with validation constraints, performance thresholds, and meta-variable validation. **USE FOR PRECISE FILTERING** of search results.\n\n**CONSTRAINT TYPES:**\n• **Count Constraints** - Minimum/maximum number of matches required\n• **File Path Patterns** - Regular expressions for file filtering\n• **Meta-variable Validation** - Type checking and format validation for captured variables\n• **Performance Thresholds** - Maximum execution time limits\n• **Context Constraints** - Line number ranges and content requirements\n\n**VALIDATION EXAMPLES:**\n```javascript\nconstraints: {\n  minMatches: 5,\n  filePathPattern: \"src/.*\\.js$\",\n  metaVariableConstraints: {\n    \"$NAME\": { regex: \"^[a-z][a-zA-Z0-9]*$\", type: \"identifier\" },\n    \"$VALUE\": { type: \"string\", minLength: 3 }\n  },\n  performanceThreshold: 5000\n}\n```\n\n**USE CASES:**\n• **Quality Enforcement** - Ensure matches meet specific criteria\n• **Performance-Critical Searches** - Limit execution time for large codebases\n• **Type Safety** - Validate captured meta-variables match expected formats\n• **Targeted Analysis** - Focus on specific file patterns or code regions",
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
              description: "Optional working directory for the operation"
            }
          },
          required: ["pattern"]
        }
      },
      {
        name: "astgrep_project_init",
        description: "**PROJECT CONFIGURATION SETUP** - Initialize ast-grep configuration and rules for a project. **USE TO BOOTSTRAP** ast-grep integration in new or existing projects.\n\n**PROJECT SETUP FEATURES:**\n• **Language-Specific Configuration** - Tailored setup for JavaScript, TypeScript, Python, etc.\n• **Rule Category Creation** - Generate security, performance, and style rules\n• **Test Integration** - Configure test directory patterns\n• **Custom Rule Templates** - Project-appropriate rule scaffolding\n\n**GENERATED CONFIGURATIONS:**\n• **sgconfig.yml** - Main project configuration file\n• **Rule Categories** - Security, performance, style rule files\n• **Language Patterns** - File extension and glob patterns\n• **Ignore Patterns** - Standard exclusions (node_modules, dist, etc.)\n\n**SUPPORTED PROJECT TYPES:**\n• **JavaScript** - Node.js, React, Express applications\n• **TypeScript** - Full TypeScript project support\n• **Python** - Django, Flask, general Python projects\n• **Multi-language** - Mixed technology stack support\n\n**USE CASES:**\n• **New Project Setup** - Bootstrap ast-grep integration from scratch\n• **Legacy Integration** - Add ast-grep to existing codebases\n• **Team Standardization** - Ensure consistent configuration across projects\n• **CI/CD Integration** - Prepare projects for automated quality checks",
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
              description: "Optional working directory for the operation"
            }
          }
        }
      },
      {
        name: "astgrep_project_scan",
        description: "**PROJECT-WIDE CODE SCANNING** - Comprehensive analysis of entire projects using ast-grep rules. **USE FOR CODEBASE HEALTH ASSESSMENT** and quality metrics.\n\n**SCAN TYPES:**\n• **Quick Scan** - Fast analysis focusing on common issues\n• **Comprehensive Scan** - Full analysis using all available rules\n• **Security Scan** - Focused security vulnerability detection\n• **Custom Scan** - User-defined rule combinations\n\n**ANALYSIS OUTPUTS:**\n• **Issue Categorization** - Group findings by type and severity\n• **File Coverage** - Track which files were analyzed\n• **Performance Metrics** - Scan speed and efficiency statistics\n• **Trend Analysis** - Historical comparison capabilities\n\n**REPORTING FEATURES:**\n• **Summary Reports** - High-level overview of findings\n• **Detailed Analysis** - Line-by-line issue identification\n• **Severity Classification** - Error, warning, info, hint levels\n• **Actionable Insights** - Prioritized remediation recommendations\n\n**USE CASES:**\n• **Code Quality Assessment** - Regular codebase health checks\n• **Security Auditing** - Identify potential vulnerabilities\n• **Pre-deployment Validation** - Ensure quality before releases\n• **Technical Debt Analysis** - Quantify maintenance requirements",
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
              description: "Optional working directory for the operation"
            }
          }
        }
      },
      {
        name: "astgrep_test",
        description: "**RULE TESTING AND VALIDATION** - Test ast-grep rules against code examples to ensure correctness. **USE FOR RULE DEVELOPMENT** and quality assurance.\n\n**TESTING CAPABILITIES:**\n• **Rule Validation** - Verify rule syntax and logic correctness\n• **Test Case Execution** - Run rules against sample code\n• **Performance Testing** - Measure rule execution speed\n• **Regression Testing** - Ensure rules work across code variations\n\n**TEST SUITE FEATURES:**\n• **Automated Test Generation** - Create test cases from common patterns\n• **Expected Result Validation** - Verify matches meet expectations\n• **Negative Testing** - Ensure rules don't match unintended code\n• **Cross-Language Testing** - Validate rules across different languages\n\n**VALIDATION TYPES:**\n• **Syntax Validation** - Check YAML syntax and rule structure\n• **Logic Validation** - Verify rule semantics and completeness\n• **Performance Validation** - Ensure acceptable execution speed\n• **Integration Testing** - Test rules within project context\n\n**DEBUGGING SUPPORT:**\n• **Verbose Output** - Detailed execution traces\n• **Pattern Analysis** - Understand why patterns match or don't match\n• **Meta-variable Inspection** - Examine captured variables\n• **AST Visualization** - See how patterns map to code structure\n\n**USE CASES:**\n• **Rule Development** - Iterative rule creation and refinement\n• **Quality Assurance** - Ensure rules work as intended\n• **Documentation** - Generate examples and test cases\n• **Continuous Integration** - Automated rule testing in pipelines",
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
              description: "Optional working directory for the operation"
            }
          }
        }
      },
      {
        name: "astgrep_validate_rules",
        description: "**RULE VALIDATION ENGINE** - Comprehensive validation of ast-grep rules for syntax, logic, and performance. **USE FOR RULE QUALITY ASSURANCE**.\n\n**VALIDATION CATEGORIES:**\n• **Syntax Validation** - YAML structure and ast-grep syntax checking\n• **Logic Validation** - Rule completeness and semantic correctness\n• **Performance Validation** - Execution speed and efficiency testing\n• **Best Practices** - Adherence to rule writing guidelines\n\n**VALIDATION OUTPUTS:**\n• **Error Reporting** - Critical issues that prevent rule execution\n• **Warning System** - Potential issues and improvement suggestions\n• **Performance Metrics** - Execution time and efficiency measurements\n• **Recommendation Engine** - Specific improvement suggestions\n\n**USE CASES:**\n• **Pre-deployment Validation** - Ensure rules are production-ready\n• **Rule Review Process** - Systematic quality assessment\n• **Performance Optimization** - Identify and resolve slow rules\n• **Team Standards** - Enforce consistent rule quality",
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
              description: "Optional working directory for the operation"
            }
          },
          required: ["rules"]
        }
      },
      {
        name: "astgrep_debug_rule",
        description: "**RULE DEBUGGING TOOLKIT** - Debug and analyze specific ast-grep rules with detailed output. **USE FOR TROUBLESHOOTING** rule behavior and pattern matching.\n\n**DEBUGGING FEATURES:**\n• **Verbose Execution** - Detailed step-by-step pattern matching\n• **AST Tree Visualization** - See how patterns map to code structure\n• **Meta-variable Analysis** - Examine captured variable content\n• **Pattern Matching Trace** - Understand why matches succeed or fail\n\n**TEST CODE INTEGRATION:**\n• **Custom Test Code** - Provide specific code to test against\n• **Language Support** - Multi-language debugging capabilities\n• **Real-time Analysis** - Immediate feedback on pattern behavior\n• **Context Preservation** - Maintain debugging session state\n\n**OUTPUT FORMATS:**\n• **Human-readable** - Formatted output for manual analysis\n• **JSON Structure** - Machine-readable debugging data\n• **Verbose Logging** - Comprehensive execution traces\n• **Summary Reports** - Condensed debugging insights\n\n**USE CASES:**\n• **Pattern Development** - Iterative pattern refinement\n• **Bug Investigation** - Understand unexpected rule behavior\n• **Learning Tool** - Educational exploration of AST patterns\n• **Rule Optimization** - Performance and accuracy improvements",
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
              description: "Optional working directory for the operation"
            }
          },
          required: ["ruleId"]
        }
      },
      {
        name: "batch_execute",
        description: "**ULTIMATE EFFICIENCY MULTIPLIER** - Execute multiple MCP operations in a single coordinated batch. **MAXIMUM EFFICIENCY TOOL** - Use whenever you need multiple operations.\n\n**CRITICAL EFFICIENCY GAINS:**\n• **10X FASTER** than individual tool calls due to reduced overhead\n• **ATOMIC WORKFLOWS** - Complete related operations without interruption\n• **INTELLIGENT ERROR HANDLING** - Continues processing even if individual operations fail\n• **CONSOLIDATED RESULTS** - All outputs organized and summarized together\n\n**OPTIMAL BATCHING STRATEGIES:**\n```javascript\n// EXCELLENT: Complete investigation workflow\n[\n  { tool: 'searchcode', parameters: { query: 'authentication middleware' } },\n  { tool: 'astgrep_search', parameters: { pattern: 'function $NAME($REQ, $RES, $NEXT)' } },\n  { tool: 'executenodejs', parameters: { code: 'console.log(\"Testing auth flow:\", authResults)' } }\n]\n\n// EXCELLENT: Comprehensive refactoring\n[\n  { tool: 'astgrep_search', parameters: { pattern: 'console.log($$$)' } },\n  { tool: 'astgrep_replace', parameters: { pattern: 'console.log($$$)', replacement: 'logger.info($$$)', dryRun: true } },\n  { tool: 'executenodejs', parameters: { code: 'validateRefactoring()' } }\n]\n```\n\n**WORKFLOW ORCHESTRATION PATTERNS:**\n• **Investigation Pipeline**: search → analyze → test → validate\n• **Refactoring Workflow**: search → replace (dry-run) → test → apply\n• **Quality Assurance**: lint → analyze → fix → validate\n• **Architecture Analysis**: search multiple patterns → consolidate findings\n\n**ERROR RESILIENCE DESIGN:**\n• **Continues on Individual Failures** - One failed operation doesn't stop the batch\n• **Detailed Error Reporting** - Know exactly which operations succeeded/failed\n• **Partial Success Handling** - Use successful results even if some operations fail\n• **Dependency Management** - Design batches to handle operation interdependencies\n\n**OUTPUT CONSOLIDATION BENEFITS:**\n• **Unified Results View** - All operation outputs organized together\n• **Cross-Operation Insights** - Correlate findings across different tool results\n• **Comprehensive Summaries** - Single place to understand batch outcomes\n• **Reduced Context Switching** - Process all related information at once\n\n**ADVANCED BATCHING SCENARIOS:**\n• **Multi-Language Analysis**: Search patterns across JavaScript, TypeScript, Python\n• **Cross-Directory Operations**: Execute operations in multiple working directories\n• **Progressive Refinement**: Use early results to inform later batch operations\n• **Validation Chains**: Test hypotheses through coordinated execution sequences\n\n**PLANNING EFFICIENT BATCHES:**\n1. **Group Related Operations** - Combine conceptually related tasks\n2. **Order Dependencies** - Put prerequisite operations first\n3. **Balance Scope** - Include 3-8 operations per batch for optimal efficiency\n4. **Plan for Failures** - Design batches that provide value even with partial success\n5. **Optimize Parameters** - Use consistent working directories and settings\n\n**USE CASES FOR MAXIMUM IMPACT:**\n• **Codebase Investigation** - Comprehensive analysis of unfamiliar code\n• **Security Auditing** - Multi-tool security analysis and validation\n• **Performance Analysis** - Search bottlenecks, analyze patterns, test solutions\n• **Refactoring Projects** - Systematic code transformation with validation\n• **Architecture Migration** - Coordinated analysis and transformation workflows\n\n**BATCH COMPOSITION GUIDELINES:**\n• **Start with Discovery** - Begin batches with search/analysis operations\n• **Progress to Action** - Follow with transformation or execution operations\n• **End with Validation** - Conclude with testing or verification steps\n• **Maintain Context** - Use consistent working directories across operations\n• **Document Intent** - Structure batches to tell a clear workflow story",
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
                    enum: ["executenodejs", "executedeno", "searchcode", "astgrep_search", "astgrep_replace", "astgrep_lint", "astgrep_analyze", "astgrep_enhanced_search", "astgrep_multi_pattern", "astgrep_constraint_search", "astgrep_project_init", "astgrep_project_scan", "astgrep_test", "astgrep_validate_rules", "astgrep_debug_rule"],
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
