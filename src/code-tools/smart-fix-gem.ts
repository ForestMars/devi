#!/usr/bin/env bun

import { readFileSync, existsSync } from "fs";
import { join } from "path";

// --- Types ---

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

// --- Configuration & Argument Handling (Adopted from Script 1, enhanced with Script 2's options) ---

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
fix-suggestion.ts — Generate LLM suggestions for grouped TypeScript build errors

USAGE:
  bun smart-fix-agent.ts [--model <name>] [--errors <path>] [--host <url>] 
                         [--count <N>] [--help]

OPTIONS:
  --model <name>     Select the Ollama model (default: qwen3-coder:latest)
  --host <url>       Ollama API host URL (default: http://localhost:11434)
  --errors <path>    Path to build errors file (default: ./build-errors.txt)
  --count <N>        Number of error groups to process (default: all)
  --help             Show this help message

DESCRIPTION:
  Reads build error output, parses and groups similar TypeScript errors, 
  and sends each group's consolidated data to Ollama to generate a single 
  fix suggestion for all similar occurrences.
`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) showHelp();

function getFlagValue(flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const MODEL = getFlagValue("--model", "qwen3-coder:latest");
const OLLAMA_HOST = getFlagValue("--host", "http://localhost:11434");
const ERRORS_PATH = getFlagValue("--errors", join(process.cwd(), "build-errors.txt"));

let MAX_GROUPS = Infinity;
const countArgIndex = args.indexOf("--count") !== -1 ? args.indexOf("--count") : args.indexOf("-n");
if (countArgIndex !== -1 && args[countArgIndex + 1] && !isNaN(parseInt(args[countArgIndex + 1]))) {
    MAX_GROUPS = parseInt(args[countArgIndex + 1]);
}

// --- Error Parsing (Adopted from Script 2) ---

function parseTypeScriptErrors(output: string): TSError[] {
  const errors: TSError[] = [];
  const lines = output.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Match error pattern: src/file.ts(4,58): error TS2835: message
    const match = line.match(/^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
    
    if (match) {
      const [, file, lineNum, col, code, message] = match;
      
      // Grab the next few lines for context
      let context = message;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nextLine = lines[j].trim();
        // Check if the next line is a continuation of the error message
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

// --- Error Grouping (Adopted from Script 2) ---

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

// --- Ollama API Call (Adopted from Script 1, enhanced with Script 2's structure) ---

async function askOllamaForFix(prompt: string): Promise<string> {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL, 
        prompt, 
        stream: false, // Ensure we get a single JSON object back for simple parsing
        options: {
          temperature: 0.2, // Lower temperature for more deterministic code suggestions
          num_predict: 600
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.response || 'No solution generated';
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

async function generateGroupFix(group: ErrorGroup): Promise<string> {
  const exampleErrors = group.errors.slice(0, 3).map(e => 
    `${e.file}:${e.line} - ${e.message}`
  ).join('\n');
  
  // Script 2's prompt structure is much better for consolidated fixes
  const prompt = `Fix this TypeScript error pattern that occurs ${group.count} times:

Error Code: ${group.code}
Pattern: ${group.pattern}
Occurrences: ${group.count}

Example errors (max 3):
${exampleErrors}

Provide ONE consolidated fix that addresses ALL ${group.count} occurrences. Your response MUST be ONLY the fix suggestion, without any introductory or concluding sentences. Include:
1. Root cause (1-2 sentences)
2. Exact solution (commands to run, config changes, or a code pattern to apply)
3. If it's a code change, show the pattern to apply across all files in a code block.

Be specific, actionable, and do not repeat yourself for each file.`;

  return askOllamaForFix(prompt);
}


// --- Main Execution Logic (Adopted and improved from Script 2) ---

async function main() {
  console.log('🤖 Smart TypeScript Error Fixer (Grouped Suggestions)\n');
  console.log('━'.repeat(60) + '\n');
  console.log(`⚙️  Model: ${MODEL} | Host: ${OLLAMA_HOST}`);

  // --- Load Errors ---
  let errorInput = '';
  
  if (!process.stdin.isTTY) {
    console.log('📥 Reading errors from stdin...\n');
    for await (const chunk of process.stdin) {
      errorInput += chunk;
    }
  } else if (existsSync(ERRORS_PATH)) {
    try {
      errorInput = readFileSync(ERRORS_PATH, "utf8");
      console.log(`📄 Reading errors from ${ERRORS_PATH}\n`);
    } catch (e) {
      console.error(`❌ Could not read error file: ${ERRORS_PATH}`);
      process.exit(1);
    }
  } else {
    console.error(`❌ No input provided! Missing file: ${ERRORS_PATH}`);
    console.error('\nUsage:');
    console.error('  bun run build 2>&1 | bun smart-fix-agent.ts --count 3');
    console.error('  bun run build 2>&1 > build-errors.txt && bun smart-fix-agent.ts -n 5');
    process.exit(1);
  }

  if (!errorInput.trim()) {
    console.error('❌ No errors to analyze!');
    process.exit(1);
  }

  // --- Parse and Group Errors ---
  const errors = parseTypeScriptErrors(errorInput);
  
  if (errors.length === 0) {
    console.log('⚠️  No parseable TypeScript errors found');
    process.exit(1);
  }

  const groups = groupErrors(errors);
  
  // Limit to requested count
  const groupsToProcess = groups.slice(0, MAX_GROUPS);
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

  // --- Generate Fixes ---
  const fixes: Array<{ group: ErrorGroup; fix: string }> = [];

  for (let i = 0; i < groupsToProcess.length; i++) {
    const group = groupsToProcess[i];
    console.log(`🔧 [${i + 1}/${groupsToProcess.length}] Generating fix for ${group.count}× ${group.code}...`);
    
    const fix = await generateGroupFix(group);
    fixes.push({ group, fix });
    
    console.log(`   ✅ Done\n`);
  }

  // --- Output Results ---
  console.log('━'.repeat(60));
  console.log('\n📋 CONSOLIDATED FIXES:\n');
  console.log('━'.repeat(60) + '\n');

  // Prepare Markdown output
  const OUTPUT_FILE = './ts-fixes.md';
  let markdown = `# TypeScript Build Fixes\n\n`;
  markdown += `* **Generated:** ${new Date().toISOString()}\n`;
  markdown += `* **Model:** ${MODEL}\n`;
  markdown += `* **Total Errors:** ${errors.length}\n`;
  markdown += `* **Error Categories Processed:** ${groupsToProcess.length} of ${groups.length}\n\n`;
  markdown += '---\n\n';

  fixes.forEach(({ group, fix }, i) => {
    // Console output
    console.log(`\n${i + 1}. [${group.code}] ${group.pattern} (${group.count} occurrences)\n`);
    // Indent the fix suggestion for readability
    console.log('   ' + fix.split('\n').join('\n   '));
    console.log(`\n   Affected files (${group.errors.length} total):`);
    group.errors.slice(0, 5).forEach(e => {
      console.log(`   - ${e.file}:${e.line}`);
    });
    if (group.errors.length > 5) {
      console.log(`   - ... and ${group.errors.length - 5} more`);
    }
    console.log('\n' + '─'.repeat(60));
    
    // Markdown output
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
  await Bun.write(OUTPUT_FILE, markdown);
  
  console.log(`\n💾 Fixes saved to ${OUTPUT_FILE}`);
  console.log('✨ Done!\n');
}

main();