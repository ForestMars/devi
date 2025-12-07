#!/usr/bin/env bun

/**
 * TypeScript Error Auto-Fixer CLI
 * Groups similar errors and generates consolidated fixes
 * 
 * Usage:
 *   bun run build 2>&1 > build-errors.txt && bun src/ts-fix-agent.ts
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen3-coder:latest';

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

function parseTypeScriptErrors(output: string): TSError[] {
  const errors: TSError[] = [];
  const lines = output.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Match error pattern: src/file.ts(4,58): error TS2835: message
    const match = line.match(/^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
    
    if (match) {
      const [, file, lineNum, col, code, message] = match;
      
      // Grab the next few lines for context (for multi-line messages)
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

function groupErrors(errors: TSError[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  
  for (const error of errors) {
    // Create a pattern key based on error code and message pattern
    let pattern = error.message;
    
    // Normalize common patterns
    if (error.code === 'TS2835' || error.code === 'TS2834') {
      pattern = 'Missing file extension in import';
    } else if (error.code === 'TS7006') {
      pattern = 'Implicit any type';
    } else if (error.code === 'TS2307') {
      pattern = 'Cannot find module';
    } else if (error.code === 'TS7016') {
      pattern = 'Missing type declarations';
    } else if (error.code === 'TS2339') {
      pattern = 'Property does not exist';
    } else if (error.code === 'TS2304') {
      pattern = 'Cannot find name';
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

async function generateGroupFix(group: ErrorGroup): Promise<string> {
  const exampleErrors = group.errors.slice(0, 3).map(e => 
    `${e.file}:${e.line} - ${e.message}`
  ).join('\n');
  
  const prompt = `Fix this TypeScript error pattern that occurs ${group.count} times:

Error Code: ${group.code}
Pattern: ${group.pattern}
Occurrences: ${group.count}

Example errors:
${exampleErrors}

Provide ONE consolidated fix that addresses ALL ${group.count} occurrences. Include:
1. Root cause (1-2 sentences)
2. Exact solution (commands to run, config changes, or code pattern to apply)
3. If it's a code change, show the pattern to apply across all files

Be specific and actionable. Don't repeat yourself for each file.`;

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
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
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

async function main() {
  console.log('🤖 TypeScript Error Auto-Fixer (Smart Grouping)\n');
  console.log('━'.repeat(60) + '\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  let maxGroups = Infinity;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' || args[i] === '-n') {
      const countArg = args[i + 1];
      if (countArg && !isNaN(parseInt(countArg))) {
        maxGroups = parseInt(countArg);
        console.log(`⚙️  Limiting to ${maxGroups} error group${maxGroups === 1 ? '' : 's'}\n`);
      }
    }
  }

  // Read errors from stdin or file
  let errorInput = '';
  
  if (!process.stdin.isTTY) {
    console.log('📥 Reading errors from stdin...\n');
    for await (const chunk of process.stdin) {
      errorInput += chunk;
    }
  } else {
    const errorFile = './build-errors.txt';
    try {
      errorInput = await Bun.file(errorFile).text();
      console.log(`📄 Reading errors from ${errorFile}\n`);
    } catch (e) {
      console.error('❌ No input provided!');
      console.error('\nUsage:');
      console.error('  bun src/ts-fix-agent.ts [--count N]');
      console.error('  bun run build 2>&1 | bun src/ts-fix-agent.ts --count 3');
      console.error('  bun run build 2>&1 > build-errors.txt && bun src/ts-fix-agent.ts -n 5');
      console.error('\nOptions:');
      console.error('  --count, -n  Number of error groups to fix (default: all)');
      process.exit(1);
    }
  }

  if (!errorInput.trim()) {
    console.error('❌ No errors to analyze!');
    process.exit(1);
  }

  // Parse and group errors
  const errors = parseTypeScriptErrors(errorInput);
  
  if (errors.length === 0) {
    console.log('⚠️  No parseable TypeScript errors found');
    process.exit(1);
  }

  const groups = groupErrors(errors);
  
  // Limit to requested count
  const groupsToProcess = groups.slice(0, maxGroups);
  const skippedCount = groups.length - groupsToProcess.length;
  
  console.log(`Found ${errors.length} total errors in ${groups.length} categories`);
  if (skippedCount > 0) {
    console.log(`Processing first ${groupsToProcess.length} categories (skipping ${skippedCount})`);
  }
  console.log('\n' + '━'.repeat(60) + '\n');

  // Show error summary
  console.log('📊 Error Summary:\n');
  groupsToProcess.forEach((group, i) => {
    console.log(`${i + 1}. [${group.code}] ${group.pattern} - ${group.count} occurrences`);
  });
  if (skippedCount > 0) {
    console.log(`\n(${skippedCount} more categories not shown - use --count to process more)`);
  }
  console.log('\n' + '━'.repeat(60) + '\n');

  // Generate fixes for each group
  const fixes: Array<{ group: ErrorGroup; fix: string }> = [];

  for (let i = 0; i < groupsToProcess.length; i++) {
    const group = groupsToProcess[i];
    console.log(`🔧 [${i + 1}/${groupsToProcess.length}] Generating fix for ${group.count}× ${group.code}...`);
    
    const fix = await generateGroupFix(group);
    fixes.push({ group, fix });
    
    console.log(`   ✅ Done\n`);
  }

  // Output results
  console.log('━'.repeat(60));
  console.log('\n📋 CONSOLIDATED FIXES:\n');
  console.log('━'.repeat(60) + '\n');

  let markdown = '# TypeScript Build Fixes\n\n';
  markdown += `Generated: ${new Date().toISOString()}\n`;
  markdown += `Model: ${MODEL}\n`;
  markdown += `Total Errors: ${errors.length}\n`;
  markdown += `Error Categories: ${groups.length}\n\n`;
  markdown += '---\n\n';

  fixes.forEach(({ group, fix }, i) => {
    console.log(`\n${i + 1}. [${group.code}] ${group.pattern} (${group.count} occurrences)\n`);
    console.log('   ' + fix.split('\n').join('\n   '));
    console.log(`\n   Affected files (${group.errors.length}):`);
    group.errors.slice(0, 5).forEach(e => {
      console.log(`   - ${e.file}:${e.line}`);
    });
    if (group.errors.length > 5) {
      console.log(`   - ... and ${group.errors.length - 5} more`);
    }
    console.log('\n' + '─'.repeat(60));
    
    // Add to markdown
    markdown += `## ${i + 1}. [${group.code}] ${group.pattern}\n\n`;
    markdown += `**Occurrences:** ${group.count}\n\n`;
    markdown += `**Fix:**\n\n${fix}\n\n`;
    markdown += `**Affected Files:**\n`;
    group.errors.forEach(e => {
      markdown += `- \`${e.file}:${e.line}\` - ${e.message}\n`;
    });
    markdown += '\n---\n\n';
  });

  // Save to file
  const outputFile = './ts-fixes.md';
  await Bun.write(outputFile, markdown);
  
  console.log(`\n💾 Fixes saved to ${outputFile}`);
  console.log('✨ Done!\n');
}

main();