#!/usr/bin/env node
// Pure JavaScript implementation of code indexing and vector search
// This implementation avoids native dependencies for better Windows compatibility

// Force use of WASM backend to avoid onnxruntime-node dependency
process.env.TFJS_BACKEND = 'wasm';
process.env.SHARP = 'false';

import fs from 'fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { pipeline, env } from '@xenova/transformers';

// Configure transformers to use WASM backend and avoid sharp
env.backends.onnx.wasm.numThreads = 1;
env.allowRemoteModels = true;
env.allowLocalModels = true;

// Configuration constants
const INDEX_DIR = './code_search_index';
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_DIM = 384; // Dimension size for the chosen model
const DEFAULT_EXTS = ['js', 'ts'];
const DEFAULT_IGNORES = ['node_modules'];
const INDEX_FILE = 'code_index.json';
const VECTOR_INDEX_FILE = 'vector_index.json';

// Global state
let embedder;
let codeChunks = [];
let chunkIds = [];
let isInitialized = false;

// Helper to calculate cosine similarity between two vectors
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// Parse .gitignore file and get ignore patterns
function parseGitignore(rootDir) {
  const gitignorePath = path.join(rootDir, '.gitignore');
  const patterns = [];
  
  if (existsSync(gitignorePath)) {
    try {
      const content = readFileSync(gitignorePath, 'utf8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        // Skip empty lines and comments
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          patterns.push(trimmedLine);
        }
      }
    } catch (error) {
      // Silently handle errors
    }
  }
  
  return patterns;
}

// Check if a path should be ignored based on .gitignore patterns
function shouldIgnorePath(filePath, ignorePatterns, rootDir) {
  // Normalize the path relative to the root directory
  const normalizedPath = path.relative(rootDir, filePath);
  // Ensure consistent path separators (use forward slashes for matching)
  const standardPath = normalizedPath.replace(/\\/g, '/');
  
  for (const pattern of ignorePatterns) {
    // Handle exact matches
    if (standardPath === pattern || standardPath === pattern.replace(/\/$/, '')) {
      return true;
    }
    
    // Handle directory wildcards (e.g., dir/**)
    if (pattern.endsWith('/**') && standardPath.startsWith(pattern.slice(0, -2))) {
      return true;
    }
    
    // Handle file wildcards (e.g., *.log)
    if (pattern.startsWith('*.') && standardPath.endsWith(pattern.slice(1))) {
      return true;
    }
    
    // Handle simple directory patterns (e.g., node_modules/)
    if (pattern.endsWith('/') && standardPath.startsWith(pattern)) {
      return true;
    }
    
    // Handle direct file matches
    if (standardPath === pattern) {
      return true;
    }
  }
  
  return false;
}

// Initialize the in-memory index and embedding model
export async function initialize(indexDir = INDEX_DIR) {
  if (isInitialized) return true;

  try {
    // Create index directory if it doesn't exist
    if (!existsSync(indexDir)) {
      mkdirSync(indexDir, { recursive: true });
    }

    // Initialize embedding model with WASM backend
    try {
      embedder = await pipeline('feature-extraction', DEFAULT_MODEL, {
        env: {
          backends: {
            onnx: {
              wasm: {
                numThreads: 1
              }
            }
          }
        }
      });
    } catch (modelError) {
      // Fallback to a model that works well with Xenova
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        env: {
          backends: {
            onnx: {
              wasm: {
                numThreads: 1
              }
            }
          }
        }
      });
    }

    // Load existing index if available
    const indexPath = path.join(indexDir, INDEX_FILE);
    
    if (existsSync(indexPath)) {
      try {
        const data = readFileSync(indexPath, 'utf8');
        codeChunks = JSON.parse(data);
        chunkIds = codeChunks.map(chunk => chunk.id);
      } catch (error) {
        codeChunks = [];
        chunkIds = [];
      }
    } else {
      codeChunks = [];
      chunkIds = [];
    }

    isInitialized = true;
    return true;
  } catch (error) {
    return false;
  }
}

// Gather files for indexing
export async function gatherFiles(dir, exts = DEFAULT_EXTS, ignores = DEFAULT_IGNORES) {
  const results = [];
  
  try {
    // Parse .gitignore in the root directory
    const gitignorePatterns = parseGitignore(dir);
    const allIgnores = [...ignores, ...gitignorePatterns];
    
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      
      // Check if the path should be ignored based on standard ignores or .gitignore
      const isIgnoredByPattern = ignores.some(p => full.includes(p));
      const isIgnoredByGitignore = shouldIgnorePath(full, gitignorePatterns, dir);
      
      if (isIgnoredByPattern || isIgnoredByGitignore) {
        continue;
      }
      
      if (entry.isDirectory()) {
        const subDirFiles = await gatherFiles(full, exts, ignores);
        results.push(...subDirFiles);
      } else if (exts.includes(path.extname(entry.name).slice(1))) {
        results.push(full);
      }
    }
  } catch (error) {
    // Silently handle errors
  }
  
  return results;
}

// Extract comment above an element
function extractDocComment(content, position) {
  let docComment = '';
  const linesBefore = content.substring(0, position).split('\n');
  let i = linesBefore.length - 1;
  
  while (i >= 0 && i >= linesBefore.length - 5) {
    const line = linesBefore[i].trim();
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      docComment = line.replace(/^\/\/|\*\/|\*|\/\*\*?/g, '').trim() + ' ' + docComment;
    } else if (line === '') {
      i--;
      continue;
    } else {
      break;
    }
    i--;
  }
  
  return docComment.trim();
}

// Extract parameters from function or method signature
function extractParameters(signature) {
  const paramMatch = signature.match(/\((.*?)\)/);
  if (!paramMatch || !paramMatch[1]) return [];
  
  const paramString = paramMatch[1].trim();
  if (!paramString) return [];
  
  return paramString.split(',')
    .map(param => {
      // Handle destructuring or complex params
      const cleanParam = param.trim().replace(/[{}[\]]/g, '');
      const parts = cleanParam.split('='); // Handle default values
      const nameWithType = parts[0].trim();
      
      // Try to separate type annotations (for TypeScript)
      const typeSplit = nameWithType.split(':');
      const name = typeSplit[0].trim();
      const type = typeSplit.length > 1 ? typeSplit[1].trim() : '';
      
      return { name, type };
    })
    .filter(p => p.name && p.name !== '');
}

// Extract return type from function signature (TypeScript)
function extractReturnType(signature, code) {
  // Check for TypeScript return type annotation
  const returnTypeMatch = signature.match(/\)(?:\s*:\s*([^{]+))?/);
  if (returnTypeMatch && returnTypeMatch[1]) {
    return returnTypeMatch[1].trim();
  }
  
  // Try to infer from return statements
  const returnMatches = code.match(/return\s+([^;]+)/g);
  if (returnMatches && returnMatches.length > 0) {
    // Just indicate there are returns but don't try to infer type
    return 'inferred';
  }
  
  return '';
}

// Extract exported status
function isExported(content, position) {
  const linesBefore = content.substring(0, position).split('\n');
  const currentLine = linesBefore[linesBefore.length - 1];
  return currentLine.includes('export ');
}

// Calculate token count (simplified approximation)
function calculateTokenCount(code) {
  if (!code || typeof code !== 'string') return 0;
  
  // Clean the code and count meaningful tokens
  const cleanedCode = code.trim();
  if (!cleanedCode) return 0;
  
  // Count words, numbers, and meaningful punctuation as tokens
  const tokens = cleanedCode.match(/\b\w+\b|[{}();,=+\-*\/\[\]<>!&|.]/g) || [];
  return tokens.length;
}

// Extract code structure from a file
export async function extractChunks(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const stat = await fs.stat(filePath);
    const chunks = [];
    const fileName = path.basename(filePath);
    const fileScope = { 
      id: Buffer.from(`file-${filePath}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16),
      type: 'file',
      name: fileName,
      path: filePath,
      children: [],
      exports: []
    };
    
    // Map of element IDs to their relationship data
    const relationships = new Map();
    
    // Extract functions
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*{/g;
    let funcMatch;
    
    while ((funcMatch = funcRegex.exec(content)) !== null) {
      const funcName = funcMatch[1];
      const funcStart = funcMatch.index;
      
      // Find the function end
      let openBraces = 1;
      let funcEnd = funcStart + funcMatch[0].length;
      
      for (let i = funcEnd; i < content.length; i++) {
        if (content[i] === '{') openBraces++;
        else if (content[i] === '}') openBraces--;
        
        if (openBraces === 0) {
          funcEnd = i + 1;
          break;
        }
      }
      
      const funcCode = content.substring(funcStart, funcEnd);
      const lines = funcCode.split('\n').length;
      const startPos = content.substring(0, funcStart).split('\n').length - 1;
      const endPos = startPos + lines - 1;
      const docComment = extractDocComment(content, funcStart);
      const isExportedFunc = isExported(content, funcStart);
      const parameters = extractParameters(funcMatch[0]);
      const returnType = extractReturnType(funcMatch[0], funcCode);
      
      const funcChunk = {
        id: Buffer.from(`function-${funcName}-${filePath}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16),
        type: 'function',
        name: funcName,
        qualifiedName: funcName,
        file: filePath,
        startLine: startPos,
        endLine: endPos,
        lines,
        tokens: calculateTokenCount(funcCode),
        code: funcCode,
        mtime: stat.mtimeMs,
        doc: docComment,
        isExported: isExportedFunc,
        parameters,
        returnType,
        complexity: calculateComplexity(funcCode)
      };
      
      chunks.push(funcChunk);
      fileScope.children.push(funcChunk.id);
      if (isExportedFunc) {
        fileScope.exports.push(funcChunk.id);
      }
      
      // Store relationships
      relationships.set(funcChunk.id, {
        calls: extractFunctionCalls(funcCode),
        dependencies: extractDependencies(funcCode)
      });
    }
    
    // Extract classes
    const classRegex = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{/g;
    let classMatch;
    
    while ((classMatch = classRegex.exec(content)) !== null) {
      const className = classMatch[1];
      const extendedClass = classMatch[2] || null;
      const classStart = classMatch.index;
      
      // Find the class end
      let openBraces = 1;
      let classEnd = classStart + classMatch[0].length;
      
      for (let i = classEnd; i < content.length; i++) {
        if (content[i] === '{') openBraces++;
        else if (content[i] === '}') openBraces--;
        
        if (openBraces === 0) {
          classEnd = i + 1;
          break;
        }
      }
      
      const classCode = content.substring(classStart, classEnd);
      const lines = classCode.split('\n').length;
      const startPos = content.substring(0, classStart).split('\n').length - 1;
      const endPos = startPos + lines - 1;
      const docComment = extractDocComment(content, classStart);
      const isExportedClass = isExported(content, classStart);
      
      const classChunk = {
        id: Buffer.from(`class-${className}-${filePath}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16),
        type: 'class',
        name: className,
        qualifiedName: className,
        parentClass: extendedClass,
        file: filePath,
        startLine: startPos,
        endLine: endPos,
        lines,
        tokens: calculateTokenCount(classCode),
        code: classCode,
        mtime: stat.mtimeMs,
        doc: docComment,
        isExported: isExportedClass,
        methods: [],
        properties: []
      };
      
      chunks.push(classChunk);
      fileScope.children.push(classChunk.id);
      if (isExportedClass) {
        fileScope.exports.push(classChunk.id);
      }
      
      // Extract class methods
      const methodRegex = /(?:async\s+)?(?:static\s+)?(?:get|set)?\s*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*{/g;
      let methodMatch;
      const methodIds = [];
      
      while ((methodMatch = methodRegex.exec(classCode)) !== null) {
        const methodName = methodMatch[1];
        // Skip constructor and private methods
        if (methodName === 'constructor' || !methodName.match(/^[a-zA-Z]/) || methodName.startsWith('_')) continue;
        
        const methodStart = classStart + methodMatch.index;
        
        // Find the method end
        let openBraces = 1;
        let methodEnd = methodStart + methodMatch[0].length;
        
        for (let i = methodEnd; i < classEnd; i++) {
          if (content[i] === '{') openBraces++;
          else if (content[i] === '}') openBraces--;
          
          if (openBraces === 0) {
            methodEnd = i + 1;
            break;
          }
          
          // Don't go past the class boundary
          if (i >= classEnd - 1) {
            methodEnd = classEnd - 1;
            break;
          }
        }
        
        const methodCode = content.substring(methodStart, methodEnd);
        const methodLines = methodCode.split('\n').length;
        const methodStartPos = content.substring(0, methodStart).split('\n').length - 1;
        const methodEndPos = methodStartPos + methodLines - 1;
        const methodDocComment = extractDocComment(content, methodStart);
        const parameters = extractParameters(methodMatch[0]);
        const returnType = extractReturnType(methodMatch[0], methodCode);
        const isStatic = methodMatch[0].includes('static ');
        
        const methodId = Buffer.from(`method-${className}-${methodName}-${filePath}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
        methodIds.push(methodId);
        
        const methodChunk = {
          id: methodId,
          type: 'method',
          name: methodName,
          qualifiedName: `${className}.${methodName}`,
          parentClass: className,
          parentClassId: classChunk.id,
          file: filePath,
          startLine: methodStartPos,
          endLine: methodEndPos,
          lines: methodLines,
          tokens: calculateTokenCount(methodCode),
          code: methodCode,
          mtime: stat.mtimeMs,
          doc: methodDocComment,
          parameters,
          returnType,
          isStatic,
          complexity: calculateComplexity(methodCode)
        };
        
        chunks.push(methodChunk);
        classChunk.methods.push(methodId);
        
        // Store relationships
        relationships.set(methodId, {
          calls: extractFunctionCalls(methodCode),
          dependencies: extractDependencies(methodCode)
        });
      }
      
      // Extract class properties
      const propertyRegex = /(?:static\s+)?(?:readonly\s+)?(\w+)\s*(?::\s*([^;=]+))?\s*(?:=|;)/g;
      let propertyMatch;
      
      while ((propertyMatch = propertyRegex.exec(classCode)) !== null) {
        const propName = propertyMatch[1];
        // Skip private properties
        if (propName.startsWith('_') || !propName.match(/^[a-zA-Z]/)) continue;
        
        const propStart = classStart + propertyMatch.index;
        let propEnd = propStart + propertyMatch[0].length;
        
        // Find property end (could be a complex assignment)
        if (content[propEnd - 1] !== ';') {
          for (let i = propEnd; i < classEnd; i++) {
            if (content[i] === ';') {
              propEnd = i + 1;
              break;
            }
          }
        }
        
        const propCode = content.substring(propStart, propEnd);
        const propLines = propCode.split('\n').length;
        const propStartPos = content.substring(0, propStart).split('\n').length - 1;
        const propEndPos = propStartPos + propLines - 1;
        const propType = propertyMatch[2] ? propertyMatch[2].trim() : '';
        const isStatic = propertyMatch[0].includes('static ');
        
        const propId = Buffer.from(`property-${className}-${propName}-${filePath}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
        
        const propChunk = {
          id: propId,
          type: 'property',
          name: propName,
          qualifiedName: `${className}.${propName}`,
          parentClass: className,
          parentClassId: classChunk.id,
          file: filePath,
          startLine: propStartPos,
          endLine: propEndPos,
          lines: propLines,
          tokens: calculateTokenCount(propCode),
          code: propCode,
          mtime: stat.mtimeMs,
          propertyType: propType,
          isStatic
        };
        
        chunks.push(propChunk);
        classChunk.properties.push(propId);
      }
      
      // Add inheritance relationships
      if (extendedClass) {
        relationships.set(classChunk.id, {
          inheritsFrom: extendedClass,
          methods: methodIds
        });
      }
    }
    
    // Extract imports/exports
    const importExportRegex = /(import|export)[\s\S]+?;/g;
    let importMatch;
    
    while ((importMatch = importExportRegex.exec(content)) !== null) {
      const code = importMatch[0];
      const type = importMatch[1] === 'import' ? 'import' : 'export';
      const lines = code.split('\n').length;
      const startPos = content.substring(0, importMatch.index).split('\n').length - 1;
      const endPos = startPos + lines - 1;
      
      // Extract imported/exported elements and module
      let modulePath = '';
      let elements = [];
      
      if (type === 'import') {
        const moduleMatch = code.match(/from\s+['"]([^'"]+)['"]/);
        if (moduleMatch) {
          modulePath = moduleMatch[1];
        }
        
        const elementsMatch = code.match(/{\s*([^}]+)\s*}/);
        if (elementsMatch) {
          elements = elementsMatch[1].split(',').map(e => e.trim());
        } else {
          // Default import
          const defaultMatch = code.match(/import\s+(\w+)/);
          if (defaultMatch) {
            elements = [defaultMatch[1] + ' (default)'];
          }
        }
      } else {
        // Export
        const namedExport = code.match(/{\s*([^}]+)\s*}/);
        if (namedExport) {
          elements = namedExport[1].split(',').map(e => e.trim());
        } else {
          const defaultExport = code.match(/export\s+default\s+(\w+)/);
          if (defaultExport) {
            elements = [defaultExport[1] + ' (default)'];
          }
        }
      }
      
      const chunk = {
        id: Buffer.from(`${type}-${importMatch.index}-${filePath}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 16),
        type,
        qualifiedName: code.trim(),
        file: filePath,
        startLine: startPos,
        endLine: endPos,
        lines,
        tokens: calculateTokenCount(code),
        code,
        mtime: stat.mtimeMs,
        doc: '',
        modulePath,
        elements
      };
      
      chunks.push(chunk);
      
      if (type === 'import') {
        // Add dependency relationships
        relationships.set(chunk.id, {
          dependsOn: modulePath,
          imports: elements
        });
      }
    }
    
    // Add file metadata chunk as the first item
    const fileChunk = {
      id: fileScope.id,
      type: 'file',
      name: fileName,
      qualifiedName: filePath,
      file: filePath,
      startLine: 0,
      endLine: content.split('\n').length - 1,
      lines: content.split('\n').length,
      tokens: calculateTokenCount(content),
      code: content.substring(0, Math.min(150, content.length)) + '...',
      mtime: stat.mtimeMs,
      doc: extractFileHeader(content),
      children: fileScope.children,
      exports: fileScope.exports
    };
    
    chunks.unshift(fileChunk);
    
    // Add relationships data to chunks
    for (const chunk of chunks) {
      if (relationships.has(chunk.id)) {
        chunk.relationships = relationships.get(chunk.id);
      }
    }
    
    return chunks;
  } catch (error) {
    return [];
  }
}

// Calculate code complexity (simplified)
function calculateComplexity(code) {
  let complexity = 1; // Base complexity
  
  // Count control flow statements
  const controlFlow = (code.match(/if|else|for|while|switch|case|catch|try|return|throw/g) || []).length;
  complexity += controlFlow * 0.5;
  
  // Count logical operators
  const logicalOps = (code.match(/&&|\|\|/g) || []).length;
  complexity += logicalOps * 0.3;
  
  return parseFloat(complexity.toFixed(1));
}

// Extract function calls from code
function extractFunctionCalls(code) {
  const calls = [];
  const callRegex = /(\w+)\s*\(/g;
  let callMatch;
  
  while ((callMatch = callRegex.exec(code)) !== null) {
    const calledFunc = callMatch[1];
    // Filter out common keywords that can appear before parentheses
    if (!['if', 'for', 'while', 'switch', 'catch', 'function'].includes(calledFunc)) {
      calls.push(calledFunc);
    }
  }
  
  return [...new Set(calls)]; // Remove duplicates
}

// Extract dependencies from code
function extractDependencies(code) {
  // Simple regex to find variable usage
  const dependencies = [];
  const varRegex = /(\b\w+\b)(?!\s*\(|:)/g;
  let varMatch;
  
  while ((varMatch = varRegex.exec(code)) !== null) {
    const varName = varMatch[1];
    // Filter out keywords and common primitives
    if (!['let', 'const', 'var', 'function', 'class', 'if', 'else', 'return', 
         'true', 'false', 'null', 'undefined', 'this', 'super'].includes(varName)) {
      dependencies.push(varName);
    }
  }
  
  return [...new Set(dependencies)]; // Remove duplicates
}

// Extract file header comments
function extractFileHeader(content) {
  const headerLines = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i].trim();
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      headerLines.push(line.replace(/^\/\/|\*\/|\*|\/\*\*?/g, '').trim());
    } else if (headerLines.length > 0 && line === '') {
      continue;
    } else if (headerLines.length > 0) {
      break;
    }
  }
  
  return headerLines.join(' ');
}

// Create text representation of a chunk for embedding
function createEmbeddingText(chunk) {
  const parts = [];
  
  parts.push(`${chunk.type}: ${chunk.name || chunk.qualifiedName || ''}`);
  
  if (chunk.doc) {
    parts.push(`Documentation: ${chunk.doc}`);
  }
  
  if (chunk.parentClass) {
    parts.push(`In class: ${chunk.parentClass}`);
  }
  
  // Add structural info
  if (chunk.parameters) {
    const paramText = chunk.parameters
      .map(p => p.type ? `${p.name}: ${p.type}` : p.name)
      .join(', ');
    parts.push(`Parameters: ${paramText}`);
  }
  
  if (chunk.returnType) {
    parts.push(`Returns: ${chunk.returnType}`);
  }
  
  if (chunk.complexity) {
    parts.push(`Complexity: ${chunk.complexity}`);
  }
  
  if (chunk.isExported) {
    parts.push('Exported: true');
  }
  
  if (chunk.relationships) {
    if (chunk.relationships.calls && chunk.relationships.calls.length > 0) {
      parts.push(`Calls: ${chunk.relationships.calls.join(', ')}`);
    }
    
    if (chunk.relationships.inheritsFrom) {
      parts.push(`Inherits from: ${chunk.relationships.inheritsFrom}`);
    }
  }
  
  if (chunk.code) {
    // Clean up code to focus on semantics
    const cleanCode = chunk.code
      .replace(/[{};,=()[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    parts.push(`Code: ${cleanCode}`);
  }
  
  return parts.join(' ');
}

// Generate embedding for a text
// Enhanced text preparation for better embeddings
function prepareTextForEmbedding(chunk) {
  let text = '';
  
  // Add type and name for context
  if (chunk.type && chunk.name) {
    text += `${chunk.type} ${chunk.name}. `;
  }
  
  // Add documentation/comments (highest semantic value)
  if (chunk.doc) {
    text += `Documentation: ${chunk.doc}. `;
  }
  
  // Add parameter information for functions
  if (chunk.parameters && chunk.parameters.length > 0) {
    const paramText = chunk.parameters.map(p => `${p.name}${p.type ? ': ' + p.type : ''}`).join(', ');
    text += `Parameters: ${paramText}. `;
  }
  
  // Add return type if available
  if (chunk.returnType) {
    text += `Returns: ${chunk.returnType}. `;
  }
  
  // Add semantic keywords extracted from code
  const semanticKeywords = extractSemanticKeywords(chunk.code || '');
  if (semanticKeywords.length > 0) {
    text += `Keywords: ${semanticKeywords.join(', ')}. `;
  }
  
  // Add clean code snippet (without excessive syntax)
  if (chunk.code) {
    const cleanCode = cleanCodeForEmbedding(chunk.code);
    text += `Code: ${cleanCode}`;
  }
  
  // Limit text length for embedding model
  return text.substring(0, 512); // Keep within reasonable limits
}

// Extract semantic keywords from code
function extractSemanticKeywords(code) {
  const keywords = new Set();
  
  // Extract variable names, function calls, and meaningful identifiers
  const identifierRegex = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
  const matches = code.match(identifierRegex) || [];
  
  for (const match of matches) {
    // Skip common keywords and short names
    if (match.length < 3 || isCommonKeyword(match)) continue;
    
    // Split camelCase and snake_case
    const words = match
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase()
      .split(' ')
      .filter(w => w.length >= 3 && !isCommonKeyword(w));
    
    words.forEach(word => keywords.add(word));
  }
  
  return Array.from(keywords).slice(0, 10); // Limit to most relevant
}

// Clean code for better embedding
function cleanCodeForEmbedding(code) {
  return code
    // Remove comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove common syntax noise
    .replace(/[{}();,]/g, ' ')
    // Trim and limit length
    .trim()
    .substring(0, 200);
}

// Check if word is a common programming keyword
function isCommonKeyword(word) {
  const commonWords = new Set([
    'const', 'let', 'var', 'function', 'class', 'if', 'else', 'for', 'while',
    'return', 'import', 'export', 'from', 'async', 'await', 'try', 'catch',
    'throw', 'new', 'this', 'super', 'extends', 'implements', 'interface',
    'type', 'enum', 'public', 'private', 'protected', 'static', 'readonly',
    'true', 'false', 'null', 'undefined', 'void', 'any', 'string', 'number',
    'boolean', 'object', 'array', 'map', 'set', 'date', 'error', 'promise'
  ]);
  
  return commonWords.has(word.toLowerCase());
}

async function generateEmbedding(text, chunk = null) {
  try {
    if (!embedder) {
      return null;
    }
    
    // Use enhanced text preparation for chunks
    const embeddingText = chunk ? prepareTextForEmbedding(chunk) : text;
    
    const output = await embedder(embeddingText, { 
      pooling: 'mean',
      normalize: true 
    });
    
    return Array.from(output.data);
  } catch (error) {
    return null;
  }
}

// Save index to disk
async function saveIndex(indexDir = INDEX_DIR) {
  try {
    // Save code chunks
    const indexPath = path.join(indexDir, INDEX_FILE);
    await fs.writeFile(indexPath, JSON.stringify(codeChunks));
    
    return true;
  } catch (error) {
    return false;
  }
}

// Synchronize the index with the file system
export async function syncIndex(folders, exts = DEFAULT_EXTS, ignores = DEFAULT_IGNORES) {
  if (!isInitialized) {
    await initialize();
  }
  
  // Gather all files
  const files = [];
  for (const folder of folders) {
    const folderFiles = await gatherFiles(folder, exts, ignores);
    files.push(...folderFiles);
  }
  
  // Process files and extract chunks
  let newChunksCount = 0;
  const allNewChunks = [];
  const updatedChunkIds = new Set();
  
  for (const file of files) {
    try {
      const fileChunks = await extractChunks(file);
      
      for (const chunk of fileChunks) {
        updatedChunkIds.add(chunk.id);
        
        // Check if chunk exists with the same mtime
        const existingIndex = chunkIds.indexOf(chunk.id);
        if (existingIndex !== -1 && codeChunks[existingIndex].mtime === chunk.mtime) {
          continue;
        }
        
        // Generate embedding for the chunk
        const text = createEmbeddingText(chunk);
        chunk.embedding = await generateEmbedding(text, chunk);
        
        allNewChunks.push(chunk);
        newChunksCount++;
      }
    } catch (error) {
      // Silently handle errors
    }
  }
  
  // Find chunks to delete (chunks not in updated files)
  const chunksToDelete = codeChunks.filter(chunk => !updatedChunkIds.has(chunk.id));
  
  // Update the in-memory index
  if (allNewChunks.length > 0 || chunksToDelete.length > 0) {
    // Remove deleted chunks
    for (const chunk of chunksToDelete) {
      const index = chunkIds.indexOf(chunk.id);
      if (index !== -1) {
        // Remove from code chunks array
        codeChunks.splice(index, 1);
        chunkIds.splice(index, 1);
      }
    }
    
    // Add new chunks
    for (const chunk of allNewChunks) {
      const existingIndex = chunkIds.indexOf(chunk.id);
      if (existingIndex !== -1) {
        // Update existing chunk
        codeChunks[existingIndex] = chunk;
      } else {
        // Add new chunk
        codeChunks.push(chunk);
        chunkIds.push(chunk.id);
      }
    }
    
    // Save the updated index
    await saveIndex();
  }
  
  return { 
    total: codeChunks.length, 
    new: newChunksCount,
    deleted: chunksToDelete.length
  };
}

// Enhanced natural language code search scoring
function textMatchScore(query, chunk) {
  // Normalize query and text
  const normalizedQuery = query.toLowerCase();
  const normalizedCode = chunk.code ? chunk.code.toLowerCase() : '';
  const normalizedName = chunk.name ? chunk.name.toLowerCase() : '';
  const normalizedQualifiedName = chunk.qualifiedName ? chunk.qualifiedName.toLowerCase() : '';
  const normalizedDoc = chunk.doc ? chunk.doc.toLowerCase() : '';
  
  let score = 0;
  
  // Enhanced exact matching with camelCase and snake_case handling
  const queryVariants = generateQueryVariants(query);
  const nameVariants = generateNameVariants(chunk.name || '');
  
  // Exact matches (highest priority)
  for (const queryVariant of queryVariants) {
    for (const nameVariant of nameVariants) {
      if (nameVariant === queryVariant) {
        score += 2.0;
        break;
      }
    }
  }
  
  // Partial name matches with intelligent scoring
  if (score === 0) {
    for (const queryVariant of queryVariants) {
      if (normalizedName.includes(queryVariant) || normalizedQualifiedName.includes(queryVariant)) {
        // Score based on match quality and position
        const matchQuality = queryVariant.length / Math.max(normalizedName.length, normalizedQualifiedName.length);
        const isAtStart = normalizedName.startsWith(queryVariant) || normalizedQualifiedName.startsWith(queryVariant);
        score += (isAtStart ? 1.2 : 0.8) * matchQuality;
      }
    }
  }
  
  // Documentation and comments scoring (for natural language)
  if (normalizedDoc.includes(normalizedQuery)) {
    const docWords = normalizedDoc.split(/\s+/);
    const queryWords = normalizedQuery.split(/\s+/);
    const matchRatio = queryWords.filter(word => docWords.some(docWord => docWord.includes(word))).length / queryWords.length;
    score += 0.8 * matchRatio;
  }
  
  // Code context scoring with semantic understanding
  const codeScore = calculateCodeContextScore(normalizedQuery, normalizedCode, chunk);
  score += codeScore;
  
  // Natural language intent scoring
  const intentScore = calculateIntentScore(query, chunk);
  score += intentScore;
  
  // Type-specific boosting
  const typeBoost = getTypeBoost(query, chunk.type);
  score *= typeBoost;
  
  return Math.min(score, 2.0); // Allow higher scores for better matches
}

// Generate query variants for better matching
function generateQueryVariants(query) {
  const variants = [query.toLowerCase()];
  
  // Add camelCase variant
  const camelCase = query.replace(/\s+/g, '').replace(/\b\w/g, (l, i) => i === 0 ? l.toLowerCase() : l.toUpperCase());
  variants.push(camelCase.toLowerCase());
  
  // Add snake_case variant
  const snakeCase = query.toLowerCase().replace(/\s+/g, '_');
  variants.push(snakeCase);
  
  // Add kebab-case variant
  const kebabCase = query.toLowerCase().replace(/\s+/g, '-');
  variants.push(kebabCase);
  
  // Add individual words
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  variants.push(...words);
  
  return [...new Set(variants)];
}

// Generate name variants for better matching
function generateNameVariants(name) {
  if (!name) return [''];
  
  const variants = [name.toLowerCase()];
  
  // Split camelCase
  const camelSplit = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  variants.push(camelSplit);
  
  // Split snake_case
  const snakeSplit = name.replace(/_/g, ' ').toLowerCase();
  variants.push(snakeSplit);
  
  // Split kebab-case
  const kebabSplit = name.replace(/-/g, ' ').toLowerCase();
  variants.push(kebabSplit);
  
  return [...new Set(variants)];
}

// Calculate code context score with semantic understanding
function calculateCodeContextScore(query, code, chunk) {
  let score = 0;
  
  // Direct code inclusion
  if (code.includes(query)) {
    score += 0.4;
  }
  
  // Word-level matching with context
  const queryWords = query.split(/\s+/).filter(w => w.length >= 2);
  const codeWords = code.split(/[^a-zA-Z0-9_$]/).filter(w => w.length >= 2);
  
  for (const queryWord of queryWords) {
    const matchingWords = codeWords.filter(codeWord => 
      codeWord.toLowerCase().includes(queryWord.toLowerCase()) ||
      queryWord.toLowerCase().includes(codeWord.toLowerCase())
    );
    
    if (matchingWords.length > 0) {
      score += 0.1 * Math.min(matchingWords.length / codeWords.length, 0.5);
    }
  }
  
  return score;
}

// Calculate intent-based scoring for natural language queries
function calculateIntentScore(query, chunk) {
  let score = 0;
  const lowerQuery = query.toLowerCase();
  
  // Action intent patterns
  const actionPatterns = {
    'find': ['find', 'search', 'get', 'retrieve', 'fetch'],
    'create': ['create', 'make', 'generate', 'build', 'add'],
    'update': ['update', 'modify', 'change', 'edit', 'set'],
    'delete': ['delete', 'remove', 'destroy', 'clear'],
    'validate': ['validate', 'check', 'verify', 'test'],
    'parse': ['parse', 'process', 'analyze', 'extract'],
    'format': ['format', 'transform', 'convert', 'serialize']
  };
  
  // Type-specific intent matching
  for (const [intent, keywords] of Object.entries(actionPatterns)) {
    if (keywords.some(keyword => lowerQuery.includes(keyword))) {
      // Boost functions that match the intent
      if (chunk.type === 'function' && chunk.name && 
          chunk.name.toLowerCase().includes(intent)) {
        score += 0.3;
      }
      
      // Check if code contains related patterns
      const code = chunk.code?.toLowerCase() || '';
      if (keywords.some(keyword => code.includes(keyword))) {
        score += 0.2;
      }
    }
  }
  
  // Domain-specific patterns
  const domainPatterns = {
    'api': ['api', 'endpoint', 'request', 'response', 'http'],
    'data': ['data', 'model', 'schema', 'database', 'sql'],
    'ui': ['ui', 'component', 'render', 'display', 'view'],
    'util': ['util', 'helper', 'utility', 'common', 'shared']
  };
  
  for (const [domain, keywords] of Object.entries(domainPatterns)) {
    if (keywords.some(keyword => lowerQuery.includes(keyword))) {
      const fileName = chunk.file?.toLowerCase() || '';
      const code = chunk.code?.toLowerCase() || '';
      
      if (fileName.includes(domain) || keywords.some(keyword => code.includes(keyword))) {
        score += 0.15;
      }
    }
  }
  
  return score;
}

// Get type-specific boost for relevance
function getTypeBoost(query, type) {
  const lowerQuery = query.toLowerCase();
  
  // Query suggests looking for specific types
  if (lowerQuery.includes('function') && type === 'function') return 1.3;
  if (lowerQuery.includes('class') && type === 'class') return 1.3;
  if (lowerQuery.includes('method') && type === 'method') return 1.3;
  if (lowerQuery.includes('variable') && type === 'property') return 1.2;
  if (lowerQuery.includes('file') && type === 'file') return 1.2;
  
  // Default boosts by type importance
  switch (type) {
    case 'function': return 1.1; // Functions are often what users search for
    case 'class': return 1.05;
    case 'method': return 1.0;
    case 'export': return 0.95;
    case 'property': return 0.9;
    case 'import': return 0.8;
    case 'file': return 0.7; // Files are less likely to be direct search targets
    default: return 1.0;
  }
}

// Enhanced query preprocessing for natural language
function preprocessQuery(query) {
  // Clean and normalize the query
  let processedQuery = query.trim().toLowerCase();
  
  // Handle common natural language patterns
  const patterns = {
    // "find function that does X" -> "X"
    'find\\s+(?:function|method|class)\\s+(?:that\\s+)?(?:does\\s+|for\\s+|to\\s+)?(.+)': '$1',
    // "how to X" -> "X"
    'how\\s+to\\s+(.+)': '$1',
    // "function for X" -> "X"
    '(?:function|method|class)\\s+(?:for|to)\\s+(.+)': '$1',
    // "where is X" -> "X"
    'where\\s+is\\s+(.+)': '$1',
    // "what does X do" -> "X"
    'what\\s+does\\s+(.+?)\\s+do': '$1',
    // "show me X" -> "X"
    'show\\s+me\\s+(.+)': '$1'
  };
  
  for (const [pattern, replacement] of Object.entries(patterns)) {
    const regex = new RegExp(pattern, 'i');
    const match = processedQuery.match(regex);
    if (match) {
      processedQuery = match[1].trim();
      break;
    }
  }
  
  return {
    original: query,
    processed: processedQuery,
    isNaturalLanguage: query.length > processedQuery.length + 5 // Significant reduction indicates NL
  };
}

// Query the index with enhanced natural language support
export async function queryIndex(query, topK = 8) {
  if (!isInitialized) {
    await initialize();
  }
  
  try {
    if (codeChunks.length === 0) {
      return [];
    }
    
    // Preprocess the query for better understanding
    const queryInfo = preprocessQuery(query);
    const searchQuery = queryInfo.processed;
    
    // Generate embeddings for both original and processed queries
    const [originalEmbedding, processedEmbedding] = await Promise.all([
      generateEmbedding(query),
      searchQuery !== query ? generateEmbedding(searchQuery) : null
    ]);
    
    let scoredResults = [];
    
    // Enhanced scoring with multiple query variants
    scoredResults = codeChunks.map(chunk => {
      let bestScore = 0;
      
      // Try original query
      if (originalEmbedding && chunk.embedding) {
        const vectorScore = cosineSimilarity(originalEmbedding, chunk.embedding);
        const textScore = textMatchScore(query, chunk);
        const combinedScore = (vectorScore * 0.6) + (textScore * 0.4);
        bestScore = Math.max(bestScore, combinedScore);
      }
      
      // Try processed query if different
      if (processedEmbedding && chunk.embedding && searchQuery !== query) {
        const vectorScore = cosineSimilarity(processedEmbedding, chunk.embedding);
        const textScore = textMatchScore(searchQuery, chunk);
        const combinedScore = (vectorScore * 0.6) + (textScore * 0.4);
        bestScore = Math.max(bestScore, combinedScore);
      }
      
      // Fallback to text-only scoring
      if (bestScore === 0) {
        bestScore = Math.max(
          textMatchScore(query, chunk),
          textMatchScore(searchQuery, chunk)
        );
      }
      
      // Apply natural language boost
      if (queryInfo.isNaturalLanguage) {
        bestScore *= 1.1; // Slight boost for NL queries to surface more relevant results
      }
      
      return {
        score: bestScore,
        chunk
      };
    });
    
    // Filter out zero scores and sort by score descending
    const filteredResults = scoredResults
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    
    // Format results for display
    const results = filteredResults.map(result => {
      const chunk = result.chunk;
      
      // Base result structure with safe property access
      const formattedResult = {
        score: parseFloat(result.score.toFixed(3)),
        file: chunk.file || 'unknown',
        startLine: (chunk.startLine !== undefined) ? chunk.startLine + 1 : 0,
        endLine: (chunk.endLine !== undefined) ? chunk.endLine + 1 : 0,
        type: chunk.type || 'unknown',
        name: chunk.name || '',
        qualifiedName: chunk.qualifiedName || '',
        lines: chunk.lines || 0,
        tokens: chunk.tokens || 0,
        doc: chunk.doc || '',
        code: chunk.code ? (chunk.code.length > 140 ? 
          chunk.code.replace(/\s+/g, ' ').slice(0, 140) + '...' : 
          chunk.code.replace(/\s+/g, ' ')
        ) : ''
      };
      
      // Add structural metadata based on chunk type
      switch (chunk.type) {
        case 'file':
          formattedResult.structure = {
            childCount: chunk.children ? chunk.children.length : 0,
            exportCount: chunk.exports ? chunk.exports.length : 0
          };
          break;
          
        case 'function':
          formattedResult.structure = {
            isExported: chunk.isExported || false,
            complexity: chunk.complexity || 1,
            parameters: chunk.parameters || [],
            returnType: chunk.returnType || '',
            calls: chunk.relationships?.calls || []
          };
          break;
          
        case 'class':
          formattedResult.structure = {
            isExported: chunk.isExported || false,
            methodCount: chunk.methods ? chunk.methods.length : 0,
            propertyCount: chunk.properties ? chunk.properties.length : 0,
            parentClass: chunk.parentClass || null,
            inheritsFrom: chunk.relationships?.inheritsFrom || null
          };
          break;
          
        case 'method':
          formattedResult.structure = {
            parentClass: chunk.parentClass || '',
            isStatic: chunk.isStatic || false,
            complexity: chunk.complexity || 1,
            parameters: chunk.parameters || [],
            returnType: chunk.returnType || '',
            calls: chunk.relationships?.calls || []
          };
          break;
          
        case 'property':
          formattedResult.structure = {
            parentClass: chunk.parentClass || '',
            isStatic: chunk.isStatic || false,
            propertyType: chunk.propertyType || ''
          };
          break;
          
        case 'import':
          formattedResult.structure = {
            modulePath: chunk.modulePath || '',
            importedElements: chunk.elements || []
          };
          break;
          
        case 'export':
          formattedResult.structure = {
            exportedElements: chunk.elements || []
          };
          break;
      }
      
      // Add relationships data if available
      if (chunk.relationships) {
        formattedResult.relationships = {};
        
        if (chunk.relationships.calls && chunk.relationships.calls.length > 0) {
          formattedResult.relationships.calls = chunk.relationships.calls;
        }
        
        if (chunk.relationships.dependencies && chunk.relationships.dependencies.length > 0) {
          formattedResult.relationships.dependencies = chunk.relationships.dependencies;
        }
        
        if (chunk.relationships.inheritsFrom) {
          formattedResult.relationships.inheritsFrom = chunk.relationships.inheritsFrom;
        }
        
        if (chunk.relationships.dependsOn) {
          formattedResult.relationships.dependsOn = chunk.relationships.dependsOn;
        }
      }
      
      return formattedResult;
    });
    
    return results;
  } catch (error) {
    return [];
  }
} 