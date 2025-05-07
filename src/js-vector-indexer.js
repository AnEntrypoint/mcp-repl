#!/usr/bin/env node
// Pure JavaScript implementation of code indexing and vector search
// This implementation avoids native dependencies for better Windows compatibility

import fs from 'fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from '@xenova/transformers';

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

    // Initialize embedding model
    try {
      embedder = await pipeline('feature-extraction', DEFAULT_MODEL);
    } catch (modelError) {
      // Fallback to a model that works well with Xenova
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
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

// Extract code chunks from a file
export async function extractChunks(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const stat = await fs.stat(filePath);
    
    // Extract chunks using regex patterns
    const chunks = [];
    
    // Extract functions
    const functionRegex = /(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*{[^}]*}/gs;
    let functionMatch;
    while ((functionMatch = functionRegex.exec(content)) !== null) {
      const code = functionMatch[0];
      const name = functionMatch[1];
      const lines = code.split('\n').length;
      const startPos = content.substring(0, functionMatch.index).split('\n').length - 1;
      const endPos = startPos + lines - 1;
      
      // Extract comments above function
      let docComment = '';
      const linesBefore = content.substring(0, functionMatch.index).split('\n');
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
      
      const chunk = {
        id: crypto.createHash('sha1').update(`function-${name}-${filePath}`).digest('hex'),
        type: 'function',
        name,
        qualifiedName: name,
        file: filePath,
        startLine: startPos,
        endLine: endPos,
        lines,
        code,
        mtime: stat.mtimeMs,
        doc: docComment.trim()
      };
      
      chunks.push(chunk);
    }
    
    // Extract classes
    const classRegex = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{[\s\S]*?}/gs;
    let classMatch;
    while ((classMatch = classRegex.exec(content)) !== null) {
      const code = classMatch[0];
      const name = classMatch[1];
      const extendedClass = classMatch[2] || null;
      const lines = code.split('\n').length;
      const startPos = content.substring(0, classMatch.index).split('\n').length - 1;
      const endPos = startPos + lines - 1;
      
      // Extract comments above class
      let docComment = '';
      const linesBefore = content.substring(0, classMatch.index).split('\n');
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
      
      const chunk = {
        id: crypto.createHash('sha1').update(`class-${name}-${filePath}`).digest('hex'),
        type: 'class',
        name,
        qualifiedName: name,
        parentClass: extendedClass,
        file: filePath,
        startLine: startPos,
        endLine: endPos,
        lines,
        code,
        mtime: stat.mtimeMs,
        doc: docComment.trim()
      };
      
      chunks.push(chunk);
      
      // Extract methods within class
      const methodRegex = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*{[^}]*}/g;
      let methodMatch;
      while ((methodMatch = methodRegex.exec(code)) !== null) {
        const methodName = methodMatch[1];
        if (methodName === 'constructor' || !methodName.match(/^[a-zA-Z]/)) continue;
        
        const methodCode = methodMatch[0];
        const methodLines = methodCode.split('\n').length;
        const methodStartPosRelative = code.substring(0, methodMatch.index).split('\n').length - 1;
        const methodStartPos = startPos + methodStartPosRelative;
        const methodEndPos = methodStartPos + methodLines - 1;
        
        const methodChunk = {
          id: crypto.createHash('sha1').update(`method-${name}-${methodName}-${filePath}`).digest('hex'),
          type: 'method',
          name: methodName,
          qualifiedName: `${name}.${methodName}`,
          parentClass: name,
          file: filePath,
          startLine: methodStartPos,
          endLine: methodEndPos,
          lines: methodLines,
          code: methodCode,
          mtime: stat.mtimeMs,
          doc: ''
        };
        
        chunks.push(methodChunk);
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
      
      const chunk = {
        id: crypto.createHash('sha1').update(`${type}-${importMatch.index}-${filePath}`).digest('hex'),
        type,
        qualifiedName: code.trim(),
        file: filePath,
        startLine: startPos,
        endLine: endPos,
        lines,
        code,
        mtime: stat.mtimeMs,
        doc: ''
      };
      
      chunks.push(chunk);
    }
    
    return chunks;
  } catch (error) {
    // Silently handle errors
    return [];
  }
}

// Generate embedding for a text
async function generateEmbedding(text) {
  try {
    if (!embedder) {
      return null;
    }
    
    const output = await embedder(text, { 
      pooling: 'mean',
      normalize: true 
    });
    
    return Array.from(output.data);
  } catch (error) {
    return null;
  }
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
        chunk.embedding = await generateEmbedding(text);
        
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

// Calculate text match score based on keyword presence
function textMatchScore(query, chunk) {
  // Normalize query and text
  const normalizedQuery = query.toLowerCase();
  const normalizedCode = chunk.code ? chunk.code.toLowerCase() : '';
  const normalizedName = chunk.name ? chunk.name.toLowerCase() : '';
  const normalizedQualifiedName = chunk.qualifiedName ? chunk.qualifiedName.toLowerCase() : '';
  const normalizedDoc = chunk.doc ? chunk.doc.toLowerCase() : '';
  
  let score = 0;
  
  // Check exact matches in name (highest weight)
  if (normalizedName === normalizedQuery || normalizedQualifiedName === normalizedQuery) {
    score += 1.0;
  }
  // Check if name contains query
  else if (normalizedName.includes(normalizedQuery) || normalizedQualifiedName.includes(normalizedQuery)) {
    score += 0.8;
  }
  
  // Check if doc contains query
  if (normalizedDoc.includes(normalizedQuery)) {
    score += 0.5;
  }
  
  // Check if code contains query
  if (normalizedCode.includes(normalizedQuery)) {
    score += 0.3;
  }
  
  // Check individual words
  const queryWords = normalizedQuery.split(/\s+/);
  for (const word of queryWords) {
    if (word.length < 3) continue; // Skip very short words
    
    if (normalizedName.includes(word) || normalizedQualifiedName.includes(word)) {
      score += 0.2;
    }
    if (normalizedDoc.includes(word)) {
      score += 0.1;
    }
    if (normalizedCode.includes(word)) {
      score += 0.05;
    }
  }
  
  return Math.min(score, 1.0); // Cap at 1.0
}

// Query the index
export async function queryIndex(query, topK = 8) {
  if (!isInitialized) {
    await initialize();
  }
  
  try {
    if (codeChunks.length === 0) {
      return [];
    }
    
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);
    
    let scoredResults = [];
    
    // If we have a valid embedding, do vector search
    if (queryEmbedding) {
      try {
        // Score all chunks using vector similarity
        scoredResults = codeChunks.map(chunk => {
          // Calculate vector similarity if chunk has embedding
          let similarityScore = 0;
          if (chunk.embedding) {
            similarityScore = cosineSimilarity(queryEmbedding, chunk.embedding);
          }
          
          // Get text match score
          const textScore = textMatchScore(query, chunk);
          
          // Combine scores (70% vector similarity, 30% text matching)
          const combinedScore = (similarityScore * 0.7) + (textScore * 0.3);
          
          return {
            score: combinedScore,
            chunk
          };
        });
      } catch (error) {
        // Fall back to text-based search
        scoredResults = codeChunks.map(chunk => ({
          score: textMatchScore(query, chunk),
          chunk
        }));
      }
    } else {
      // Use text-based search only
      scoredResults = codeChunks.map(chunk => ({
        score: textMatchScore(query, chunk),
        chunk
      }));
    }
    
    // Filter out zero scores and sort by score descending
    const filteredResults = scoredResults
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    
    // Format results for display
    const results = filteredResults.map(result => ({
      score: result.score.toFixed(3),
      file: result.chunk.file,
      startLine: result.chunk.startLine + 1,
      endLine: result.chunk.endLine + 1,
      type: result.chunk.type,
      name: result.chunk.name || '',
      qualifiedName: result.chunk.qualifiedName || '',
      lines: result.chunk.lines,
      parentClass: result.chunk.parentClass,
      doc: result.chunk.doc,
      code: result.chunk.code ? (result.chunk.code.length > 140 ? 
        result.chunk.code.replace(/\s+/g, ' ').slice(0, 140) + '...' : 
        result.chunk.code.replace(/\s+/g, ' ')
      ) : ''
    }));
    
    return results;
  } catch (error) {
    return [];
  }
} 