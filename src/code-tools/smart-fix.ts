#!/usr/bin/env bun
/**
 * @file smart-fix.ts
 * @description Analyzes TypeScript build errors, intelligently groups similar errors,
 * and generates consolidated, systemic fix suggestions using an Ollama LLM.
 *
 * @author Me and Mr. Fixit
 * @version 0.0.6
 * @license MIT
 *
 * @usage
 * 1. Pipe errors directly: bun run build 2>&1 | bun ts-fix-agent.ts --count 3
 * 2. Use error file: bun run build 2>&1 > build-errors.txt && bun ts-fix-agent.ts -n 5
 *
 * @dependencies
 * - Bun Runtime Environment
 * - Ollama (running locally or accessible via --host)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Configuration
let DEFAULT_MODEL = "codellama:latest";
let DEFAULT_OLLAMA_HOST = "http://localhost:11434";
let DEFAULT_ERRORS_PATH = join(process.cwd(), "build-errors.txt");
let DEFAULT_OUTPUT_PATH = join(process.cwd(), "new-ts-fixes.md");
let DEFAULT_PROMPT_PATH = join(process.cwd(), 'prompts/fix-suggestion.prompt.txt');
let DEFAULT_FILE_FORMAT = "markdown"; 
let DEFAULT_MAX_GROUPS = Infinity; // Represents processing all groups by default

// Types
interface TSError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  context: string;
}

interface ErrorGroup {
  code: string;
  pattern: string;
  errors: TSError[];
  count: number;
}

interface Config {
  model: string;
  ollamaHost: string;
  maxGroups: number;
  errorsPath: string;
  promptPath: string;
  outputPath: string;
  useStreaming: boolean;
}

// CLI Help
// FIX: showHelp must accept the Config object to display resolved defaults correctly.
function showHelp(config: Config) {
  console.log(`
smart-fix.ts — Generate LLM suggestions for grouped TypeScript build errors

USAGE:
  bun smart-fix.ts [OPTIONS]
  bun run build 2>&1 | bun ts-fix-agent.ts --count 3
  bun run build 2>&1 > build-errors.txt && bun ts-fix-agent.ts

OPTIONS:
  --model <name>     Ollama model (default: ${config.model})
  --host <url>       Ollama host URL (default: ${config.ollamaHost})
  --count, -n <num>  Number of error groups to fix (default: all)
  --errors <path>    Path to build errors file (default: ./build-errors.txt or stdin)
  --prompt <path>    Path to prompt template (default: ${config.promptPath})
  --output <path>    Output file for fixes (default: ${config.outputPath})
  --stream           Use streaming mode (prevents timeouts, default: false)
  --help, -h         Show this help message

DESCRIPTION:
  Reads build error output, parses and groups similar TypeScript errors,
  and sends each group's consolidated data to Ollama to generate a single
  fix suggestion for all similar occurrences.

EXAMPLES:
  # Fix top 3 error groups from stdin
  bun run build 2>&1 | bun ts-fix-agent.ts -n 3

  # Fix all errors from file with streaming
  bun ts-fix-agent.ts --errors ./build-errors.txt --stream

  # Use custom model and prompt
  bun ts-fix-agent.ts --model deepseek-coder:6.7b --prompt ./custom.prompt.txt
`);
  process.exit(0);
}

// Argument Parsing
function parseArgs(): Config {
  const args = process.argv.slice(2);
  
  // NOTE: showHelp check must be performed after configuration is fully resolved
  // to ensure default values displayed in the help text are accurate.

  function getFlagValue(flag: string, shortFlag: string, defaultValue: string): string {
    let idx = args.indexOf(flag);
    if (idx === -1 && shortFlag) idx = args.indexOf(shortFlag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
  }

  // Parse max groups
  let maxGroups = DEFAULT_MAX_GROUPS;
  const countArgIndex = args.indexOf("--count") !== -1 ? args.indexOf("--count") : args.indexOf("-n");
  if (countArgIndex !== -1 && args[countArgIndex + 1] && !isNaN(parseInt(args[countArgIndex + 1]))) {
    maxGroups = parseInt(args[countArgIndex + 1]);
  }

  // FIX: Use hoisted defaults directly for resolution, honoring environment variables.
  const config: Config = {
    model: getFlagValue("--model", "", process.env.OLLAMA_MODEL || DEFAULT_MODEL),
    ollamaHost: getFlagValue("--host", "", process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST),
    maxGroups,
    errorsPath: getFlagValue("--errors", "", DEFAULT_ERRORS_PATH),
    promptPath: getFlagValue("--prompt", "", DEFAULT_PROMPT_PATH),
    outputPath: getFlagValue("--output", "", DEFAULT_OUTPUT_PATH), // Use resolved default
    useStreaming: args.includes("--stream")
  };
  
  // FIX: Perform the showHelp check here, after 'config' is resolved.
  if (args.includes("--help") || args.includes("-h")) {
    showHelp(config);
  }
  
  return config;
}

/*
 * Parse Build Errors
 */
function parseTypeScriptErrors(output: string): TSError[] {
  const errors: TSError[] = [];
  const lines = output.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Match error pattern: src/file.ts(4,58): error TS2835: message
    const match = line.match(/^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
    
    if (match) {
      const [, file, lineNum, col, code, message] = match;
      
      // Grab context from next few lines
      let context = message;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (nextLine && !nextLine.match(/^[a-zA-Z]/)) {
          context += '\n' + nextLine;
        } else {
          break;
        }
      }
      
      errors.push({
        file,
        line: parseInt(lineNum),
        column: parseInt(col),
        code,
        message,
        context: context.trim()
      });
    }
  }
  
  return errors;
}

// Error Grouping
function groupErrors(errors: TSError[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  
  for (const error of errors) {
    let pattern = error.message;
    
    // Normalize common patterns for better grouping
    switch (error.code) {
      case 'TS2835': case 'TS2834': pattern = 'Missing file extension in import'; break;
      case 'TS7006': pattern = 'Implicit any type'; break;
      case 'TS2307': pattern = 'Cannot find module'; break;
      case 'TS7016': pattern = 'Missing type declarations'; break;
      case 'TS2339': pattern = 'Property does not exist'; break;
      case 'TS2304': pattern = 'Cannot find name'; break;
    }
    
    const key = `${error.code}:${pattern}`;
    
    if (!groups.has(key)) {
      groups.set(key, {
        code: error.code,
        pattern,
        errors: [],
        count: 0
      });
    }
    
    const group = groups.get(key)!;
    group.errors.push(error);
    group.count++;
  }
  
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

// LLM Integration
async function generateGroupFix(
  group: ErrorGroup, 
  promptTemplate: string | null,
  config: Config
): Promise<string> {
  const exampleErrors = group.errors.slice(0, 3).map(e => 
    `${e.file}:${e.line} - ${e.message}`
  ).join('\n');
  
  let prompt: string;
  
  if (promptTemplate) {
    prompt = promptTemplate
      .replace(/\{\{ERROR_CODE\}\}/g, group.code)
      .replace(/\{\{ERROR_PATTERN\}\}/g, group.pattern)
      .replace(/\{\{ERROR_COUNT\}\}/g, group.count.toString())
      .replace(/\{\{EXAMPLE_ERRORS\}\}/g, exampleErrors);
  } else {
    prompt = `Immediately return this: "Context not found. Nothing to do."`;
  }

  try {
    const response = await fetch(`${config.ollamaHost}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt,
        stream: config.useStreaming,
        options: {
          temperature: 0.2,
          num_predict: 600
        }
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    if (config.useStreaming) {
      // Handle streaming response (NDJSON)
      const text = await response.text();
      const lines = text.trim().split("\n");
      let output = "";
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.response) output += obj.response;
        } catch {}
      }
      return output || 'No solution generated';
    } else {
      // Handle non-streaming response
      const data = await response.json();
      return data.response || 'No solution generated';
    }
  } catch (error: any) {
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      return `Error: Request timed out after 120 seconds. Try using --stream flag or a faster model.`;
    }
    return `Error: ${error.message}`;
  }
}

// Main
async function main() {
  const config = parseArgs();
  
  console.log('🤖 Smart TypeScript Error Fixer (Grouped Suggestions)\n');
  console.log('━'.repeat(60) + '\n');
  console.log(`⚙️  Model: ${config.model}`);
  console.log(`⚙️  Ollama Host: ${config.ollamaHost}`);
  console.log(`⚙️  Streaming: ${config.useStreaming ? 'enabled' : 'disabled'}`);
  if (config.maxGroups !== Infinity) {
    console.log(`⚙️  Limiting to ${config.maxGroups} error group(s)`);
  }
  console.log();

  // Read errors from stdin or file
  let errorInput = '';
  
  if (!process.stdin.isTTY) {
    console.log('📥 Reading errors from stdin...\n');
    for await (const chunk of process.stdin) {
      errorInput += chunk;
    }
  } else if (existsSync(config.errorsPath)) {
    try {
      errorInput = readFileSync(config.errorsPath, "utf8");
      console.log(`📄 Reading errors from ${config.errorsPath}\n`);
    } catch (e) {
      console.error(`❌ Could not read error file: ${config.errorsPath}`);
      process.exit(1);
    }
  } else {
    console.error(`❌ No input provided! Missing file: ${config.errorsPath}`);
    console.error('\nUsage:');
    console.error('  bun run build 2>&1 | bun ts-fix-agent.ts --count 3');
    console.error('  bun run build 2>&1 > build-errors.txt && bun ts-fix-agent.ts -n 5');
    process.exit(1);
  }

  if (!errorInput.trim()) {
    console.error('❌ No errors to analyze!');
    process.exit(1);
  }

  // Load custom prompt template if provided
  let promptTemplate: string | null = null;
  if (existsSync(config.promptPath)) {
    promptTemplate = readFileSync(config.promptPath, "utf8");
    console.log(`📝 Using custom prompt template: ${config.promptPath}\n`);
  }

  // Parse and group errors
  const errors = parseTypeScriptErrors(errorInput);
  
  if (errors.length === 0) {
    console.log('⚠️  No parseable TypeScript errors found');
    process.exit(1);
  }

  const groups = groupErrors(errors);
  const groupsToProcess = groups.slice(0, config.maxGroups);
  const skippedCount = groups.length - groupsToProcess.length;
  
  console.log(`Found ${errors.length} total errors in ${groups.length} categories`);
  if (skippedCount > 0) {
    console.log(`Processing first ${groupsToProcess.length} categories (skipping ${skippedCount} less frequent ones)`);
  }
  console.log('\n' + '━'.repeat(60) + '\n');

  // Show error summary
  console.log('📊 Error Summary (Processing these groups):\n');
  groupsToProcess.forEach((group, i) => {
    console.log(`${i + 1}. [${group.code}] ${group.pattern} - ${group.count} occurrences`);
  });
  if (skippedCount > 0) {
    console.log(`\n(Skipped ${skippedCount} more categories)`);
  }
  console.log('\n' + '━'.repeat(60) + '\n');

  // Generate fixes
  const fixes: Array<{ group: ErrorGroup; fix: string }> = [];

  for (let i = 0; i < groupsToProcess.length; i++) {
    const group = groupsToProcess[i];
    console.log(`🔧 [${i + 1}/${groupsToProcess.length}] Generating fix for ${group.count}× ${group.code}...`);
    
    const fix = await generateGroupFix(group, promptTemplate, config);
    fixes.push({ group, fix });
    
    console.log(`   ✅ Done\n`);
  }

  // I can haz results?
  console.log('━'.repeat(60));
  console.log('\n📋 CONSOLIDATED FIXES:\n');
  console.log('━'.repeat(60) + '\n');

  let markdown = `# TypeScript Build Fixes\n\n`;
  markdown += `* **Generated:** ${new Date().toISOString()}\n`;
  markdown += `* **Model:** ${config.model}\n`;
  markdown += `* **Total Errors:** ${errors.length}\n`;
  markdown += `* **Error Categories Processed:** ${groupsToProcess.length} of ${groups.length}\n\n`;
  markdown += '---\n\n';

  fixes.forEach(({ group, fix }, i) => {
    console.log(`\n${i + 1}. [${group.code}] ${group.pattern} (${group.count} occurrences)\n`);
    console.log('   ' + fix.split('\n').join('\n   '));
    console.log(`\n   Affected files (${group.errors.length} total):`);
    group.errors.slice(0, 5).forEach(e => {
      console.log(`   - ${e.file}:${e.line}`);
    });
    if (group.errors.length > 5) {
      console.log(`   - ... and ${group.errors.length - 5} more`);
    }
    console.log('\n' + '─'.repeat(60));
    
    // FIXE: WE SAID USER COULD SELECT txt, md or json (md ok for default)
    markdown += `## ${i + 1}. [${group.code}] ${group.pattern} (${group.count} occurrences)\n\n`;
    markdown += `### Fix Suggestion\n\n${fix}\n\n`;
    markdown += `### Affected Files\n`;
    group.errors.slice(0, 10).forEach(e => {
      markdown += `- \`${e.file}:${e.line}\` - ${e.message}\n`;
    });
    if (group.errors.length > 10) {
      markdown += `- ... and ${group.errors.length - 10} more files.\n`;
    }
    markdown += '\n---\n\n';
  });

  // Save to file
  await Bun.write(config.outputPath, markdown);
  
  console.log(`\n💾 Fixes saved to ${config.outputPath}`);
  console.log('✨ Done!\n');
}

main();