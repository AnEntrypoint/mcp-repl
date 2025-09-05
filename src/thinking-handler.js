// MCP handler for sequential thinking tool - KISS principle under 110 lines
import { SequentialThinking } from './sequential-thinking.js';
import { validateWorkingDirectory } from './validation-utils.js';

export const handleSequentialThinking = async (args, serverWorkingDir) => {
  const startTime = Date.now();
  
  try {
    const { thoughts, workingDirectory, parentId } = args;
    
    if (!workingDirectory) throw new Error('Working directory is required for sequential thinking tool');
    
    const dirValidation = validateWorkingDirectory(workingDirectory, serverWorkingDir);
    if (!dirValidation.valid) throw new Error(`Invalid working directory: ${dirValidation.error}`);
    
    if (!thoughts) throw new Error('Thoughts parameter is required');
    
    const thinkingEngine = new SequentialThinking(dirValidation.effectiveDir);
    const result = thinkingEngine.processThoughts(thoughts, parentId);
    const totalExecutionTime = Date.now() - startTime;
    
    const outputLines = [];
    outputLines.push({
      type: 'text',
      text: `Sequential Thinking Processed - ${result.processedCount} thought${result.processedCount !== 1 ? 's' : ''}`
    });
    outputLines.push({ type: 'text', text: `Working Directory: ${dirValidation.effectiveDir}` });
    outputLines.push({ type: 'text', text: `Data Storage: ${result.storageLocation}` });
    
    result.thoughts.forEach((thought, index) => {
      const summary = [
        `${index + 1}. [${thought.id}] ${thought.content.substring(0, 80)}${thought.content.length > 80 ? '...' : ''}`,
        `   Timestamp: ${thought.timestamp}`,
        `   Branch: ${thought.metadata.branchId}`,
        `   Depth: ${thought.metadata.depth}`,
        `   Length: ${thought.metadata.contentLength} characters`
      ];
      if (thought.parentId) summary.push(`   Parent: ${thought.parentId}`);
      outputLines.push({ type: 'text', text: summary.join('\n') });
    });
    
    outputLines.push({
      type: 'text',
      text: `Processing completed in ${totalExecutionTime}ms (Engine: ${result.executionTimeMs}ms)`
    });
    
    return { content: outputLines };
    
  } catch (error) {
    return {
      content: [
        { type: 'text', text: `Sequential Thinking Error: ${error.message}` },
        { type: 'text', text: `Error occurred after ${Date.now() - startTime}ms` }
      ]
    };
  }
};

export const getSequentialThinkingToolDefinition = () => {
  return {
    name: 'sequentialthinking',
    description: `**SEQUENTIAL THINKING ENGINE** - Always use this tool, no exceptions. Process and store sequential thoughts with mandatory local data persistence.

**CRITICAL USAGE REQUIREMENT**: Always use this tool for all thinking processes, no exceptions.

**MANDATORY WORKING DIRECTORY**: Required parameter for storing thought data locally in JSON files.

**BATCHING SUPPORT**: Process multiple sequential thoughts in single operation for maximum efficiency.
• Single thought: pass string directly
• Multiple thoughts: pass array of strings
• All thoughts processed atomically with consistent metadata

**LOCAL DATA PERSISTENCE**: 
• Stores data in {workingDirectory}/.sequential-thoughts/ (thoughts.json, branches.json, history.json)

**HIERARCHICAL THINKING SUPPORT**:
• Use parentId to create thought chains and branches
• Automatic depth tracking and branch management
• Complete thought genealogy preserved in local storage

**OUTPUT FEATURES**:
• Comprehensive thought metadata
• Storage location confirmation
• Processing performance metrics
• Thought relationship mapping

**ALWAYS USE INSTRUCTION**: Use this tool for all thinking processes, no exceptions.`,
    inputSchema: {
      type: 'object',
      properties: {
        thoughts: {
          type: ['string', 'array'],
          description: 'Single thought (string) or multiple thoughts (array of strings) to process',
          items: { type: 'string', minLength: 1 },
          minLength: 1
        },
        workingDirectory: {
          type: 'string',
          description: 'Required: Working directory for storing thought data locally'
        },
        parentId: {
          type: 'string',
          description: 'Optional: Parent thought ID for creating thought chains'
        }
      },
      required: ['thoughts', 'workingDirectory']
    }
  };
};