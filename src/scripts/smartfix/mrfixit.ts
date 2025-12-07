#!/usr/bin/env bun
/**
 * @file mrfixit.ts
 * @description Analyzes TypeScript build errors using rules engine or LLM
 * @version 0.0.9
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ErrorGroup, TSError, FixResult } from './types';
import { analyzeWithRules } from './engines/rules';

// Configuration
interface Config {
  analyzer: 'rules' | 'llm' | 'hybrid';
  llmProvider?: 'ollama' | 'claude';
  model?: string;
  ollamaHost: string;
  maxGroups: number;
  errorsPath: string;
  outputPath: string;
  outputFormat: 'markdown' | 'json' | 'aider';
}

// Default values
const DEFAULTS = {
  analyzer: 'rules' as const,
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL || 'codellama:latest',
  errorsPath: join(process.cwd(), 'build-errors.txt'),
  outputPath: join(process.cwd(), 'ts-fixes.md'),
  maxGroups: Infinity,
  outputFormat: 'aider' as const
};

function showHelp() {
  console.log(`
smart-fix - Analyze and fix TypeScript build errors

USAGE:
  bun smart-fix.ts [OPTIONS]
  bun run build 2>&1 | bun smart-fix.ts

OPTIONS:
  --analyzer <type>      Analysis mode: rules (default), llm, or hybrid
  --llm-provider <name>  LLM provider: ollama or claude (for llm/hybrid mode)
  --model <name>         Model name (default: codellama:latest)
  --count, -n <num>      Max error groups to process (default: all)
  --errors <path>        Path to error file (default: ./build-errors.txt or stdin)
  --output <path>        Output file (default: ./ts-fixes.md)
  --format <type>        Output format: markdown, json, or aider (default: aider)
  --help, -h             Show this help

EXAMPLES:
  # Analyze build errors with rules engine (fast)
  bun run build 2>&1 | bun smart-fix.ts

  # Top 5 error groups only
  bun smart-fix.ts --count 5 --errors build-errors.txt

  # Use LLM for unknown errors (research mode)
  bun smart-fix.ts --analyzer hybrid --llm-provider claude
`);
  process.exit(0);
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
  }
  
  function getFlagValue(flag: string, shortFlag: string = '', defaultValue: any): any {
    let idx = args.indexOf(flag);
    if (idx === -1 && shortFlag) idx = args.indexOf(shortFlag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
  }
  
  // Parse max groups
  let maxGroups = DEFAULTS.maxGroups;
  const countArgIndex = args.indexOf('--count') !== -1 ? args.indexOf('--count') : args.indexOf('-n');
  if (countArgIndex !== -1 && args[countArgIndex + 1]) {
    maxGroups = parseInt(args[countArgIndex + 1]) || DEFAULTS.maxGroups;
  }
  
  return {
    analyzer: getFlagValue('--analyzer', '', DEFAULTS.analyzer) as 'rules' | 'llm' | 'hybrid',
    llmProvider: getFlagValue('--llm-provider', '', undefined) as 'ollama' | 'claude' | undefined,
    model: getFlagValue('--model', '', DEFAULTS.model),
    ollamaHost: getFlagValue('--host', '', DEFAULTS.ollamaHost),
    maxGroups,
    errorsPath: getFlagValue('--errors', '', DEFAULTS.errorsPath),
    outputPath: getFlagValue('--output', '', DEFAULTS.outputPath),
    outputFormat: getFlagValue('--format', '', DEFAULTS.outputFormat) as 'markdown' | 'json' | 'aider'
  };
}

function parseTypeScriptErrors(output: string): TSError[] {
  const errors: TSError[] = [];
  const lines = output.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
    
    if (match) {
      const [, file, lineNum, col, code, message] = match;
      
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
    let pattern = error.message;
    
    // Normalize patterns
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
      groups.set(key, { code: error.code, pattern, errors: [], count: 0 });
    }
    
    const group = groups.get(key)!;
    group.errors.push(error);
    group.count++;
  }
  
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

function generateAiderOutput(fixes: Array<{ group: ErrorGroup; fix: FixResult }>): any {
  const output = {
    summary: `Fixed ${fixes.length} error groups`,
    fixes: fixes.map(({ group, fix }) => ({
      errorCode: group.code,
      pattern: group.pattern,
      count: group.count,
      confidence: fix.confidence,
      fixType: fix.fixType,
      description: fix.description,
      fileChanges: fix.fileChanges || [],
      commands: fix.commands || [],
      manualSteps: fix.manualSteps || []
    }))
  };
  
  return output;
}

function generateMarkdown(fixes: Array<{ group: ErrorGroup; fix: FixResult }>): string {
  let md = `# TypeScript Build Fixes\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n`;
  md += `**Total Fixes:** ${fixes.length}\n\n`;
  md += '---\n\n';
  
  fixes.forEach(({ group, fix }, i) => {
    md += `## ${i + 1}. [${group.code}] ${group.pattern}\n\n`;
    md += `**Occurrences:** ${group.count}\n`;
    md += `**Confidence:** ${fix.confidence}\n`;
    md += `**Fix Type:** ${fix.fixType}\n\n`;
    md += `### Description\n${fix.description}\n\n`;
    
    if (fix.fileChanges && fix.fileChanges.length > 0) {
      md += `### File Changes\n`;
      fix.fileChanges.forEach(fc => {
        md += `- **${fc.path}**${fc.lines ? ` (lines: ${fc.lines.join(', ')})` : ''}\n`;
        md += `  - ${fc.instruction}\n\n`;
      });
    }
    
    if (fix.commands && fix.commands.length > 0) {
      md += `### Commands\n\`\`\`bash\n${fix.commands.join('\n')}\n\`\`\`\n\n`;
    }
    
    if (fix.manualSteps && fix.manualSteps.length > 0) {
      md += `### Manual Steps\n`;
      fix.manualSteps.forEach(step => md += `- ${step}\n`);
      md += '\n';
    }
    
    md += '---\n\n';
  });
  
  return md;
}

async function main() {
  const config = parseArgs();
  
  console.log('🔧 Smart TypeScript Error Fixer\n');
  console.log('━'.repeat(60));
  console.log(`\n⚙️  Analyzer: ${config.analyzer}`);
  console.log(`⚙️  Output Format: ${config.outputFormat}`);
  if (config.maxGroups !== Infinity) {
    console.log(`⚙️  Max Groups: ${config.maxGroups}`);
  }
  console.log();
  
  // Read errors
// Read errors
  let errorInput = '';
  
  if (!process.stdin.isTTY) {
    // Stdin has data piped to it - use that (highest priority)
    console.log('📥 Reading errors from stdin...\n');
    for await (const chunk of process.stdin) {
      errorInput += chunk;
    }
  } else {
    // No stdin - check for file
    const errorFile = config.errorsPath;
    
    if (existsSync(errorFile)) {
      errorInput = readFileSync(errorFile, 'utf8');
      console.log(`📄 Reading errors from ${errorFile}\n`);
    } else {
      console.error(`❌ No input provided!`);
      console.error(`   Either pipe errors: bun run build 2>&1 | bun smart-fix.ts`);
      console.error(`   Or create file: ${errorFile}`);
      process.exit(1);
    }
  }
  
  if (!errorInput.trim()) {
    console.error('❌ No errors to analyze!');
    process.exit(1);
  }
  
  // Parse and group
  const errors = parseTypeScriptErrors(errorInput);
  
  if (errors.length === 0) {
    console.log('⚠️  No parseable TypeScript errors found');
    process.exit(1);
  }
  
  const groups = groupErrors(errors);
  const groupsToProcess = groups.slice(0, config.maxGroups);
  
  console.log(`Found ${errors.length} errors in ${groups.length} categories`);
  console.log(`Processing ${groupsToProcess.length} categories\n`);
  console.log('━'.repeat(60) + '\n');
  
  // Analyze with rules engine
  console.log('🔍 Analyzing with rules engine...\n');
  const result = analyzeWithRules(groupsToProcess);
  
  if (result.unknown.length > 0 && config.analyzer === 'rules') {
    console.log(`\n⚠️  ${result.unknown.length} error groups have no rules.`);
    console.log(`   Run with --analyzer hybrid to research these with LLM.\n`);
  }
  
  // TODO: If analyzer is 'llm' or 'hybrid', analyze unknowns with LLM
  
  console.log('\n' + '━'.repeat(60) + '\n');
  
  // Generate output
  let outputContent: string;
  
  if (config.outputFormat === 'json') {
    const json = generateAiderOutput(result.fixes);
    await Bun.write('ts-fixes.json', JSON.stringify(json, null, 2));
  console.log(`💾 JSON fixes written to ts-fixes.json`);
  }

  // Also always generate aider-friendly text
  const aiderText = result.fixes
    .map(({ group, fix }) => `${group.code} ${group.pattern} - ${fix.description}`)
    .join('\n\n');

  await Bun.write('ts-fixes.txt', aiderText);
  console.log(`💾 Aider-friendly text written to ts-fixes.txt`);
  console.log(`💾 Fixes written to ${config.outputPath}`);
  console.log(`✨ Done!\n`);
}

main();