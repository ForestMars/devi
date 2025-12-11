#!/usr/bin/env bun
/**
 * @file mrfixit.ts OLD
 * @description Analyzes TypeScript build errors using rules engine or LLM
 * @version 0.0.10
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ErrorGroup, TSError, FixResult } from './types';
import { analyzeWithRules } from './engines/rules';

interface Config {
  analyzer: 'rules' | 'llm' | 'hybrid';
  llmProvider?: 'ollama' | 'claude';
  model?: string;
  ollamaHost: string;
  maxGroups: number;
  errorsPath: string;
  outputJsonPath: string;
  outputTxtPath: string;
  outputFormat: 'markdown' | 'json' | 'aider';
}

const DEFAULTS = {
  analyzer: 'rules' as const,
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL || 'codellama:latest',
  errorsPath: join(process.cwd(), 'build-errors.txt'),
  outputJsonPath: join(process.cwd(), 'ts-fixes.json'),
  outputTxtPath: join(process.cwd(), 'ts-fixes.txt'),
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
  --output-json <path>   Output JSON file (default: ./ts-fixes.json)
  --output-txt <path>    Output text summary file (default: ./ts-fixes.txt)
  --format <type>        Output format: markdown, json, or aider (default: aider)
  --help, -h             Show this help
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

  const countArgIndex = args.indexOf('--count') !== -1 ? args.indexOf('--count') : args.indexOf('-n');
  const maxGroups = countArgIndex !== -1 && args[countArgIndex + 1] ? parseInt(args[countArgIndex + 1]) || DEFAULTS.maxGroups : DEFAULTS.maxGroups;

  return {
    analyzer: getFlagValue('--analyzer', '', DEFAULTS.analyzer) as 'rules' | 'llm' | 'hybrid',
    llmProvider: getFlagValue('--llm-provider', '', undefined) as 'ollama' | 'claude' | undefined,
    model: getFlagValue('--model', '', DEFAULTS.model),
    ollamaHost: getFlagValue('--host', '', DEFAULTS.ollamaHost),
    maxGroups,
    errorsPath: getFlagValue('--errors', '', DEFAULTS.errorsPath),
    outputJsonPath: getFlagValue('--output-json', '', DEFAULTS.outputJsonPath),
    outputTxtPath: getFlagValue('--output-txt', '', DEFAULTS.outputTxtPath),
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
        } else break;
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

function generateAiderText(fixes: Array<{ group: ErrorGroup; fix: FixResult }>): string {
  let text = '';
  for (const { group, fix } of fixes) {
    text += `${group.code} ${group.pattern}\n`;
    text += `  - ${group.count} occurrence${group.count > 1 ? 's' : ''} across ${fix.fileChanges?.length || 0} file${(fix.fileChanges?.length || 0) > 1 ? 's' : ''}\n`;
    text += `  - ${fix.description}\n`;
    if (fix.fileChanges && fix.fileChanges.length > 0) {
      text += `  - Files:\n`;
      for (const fc of fix.fileChanges) {
        const lineStr = fc.lines?.length === 1 ? `line ${fc.lines[0]}` : `lines ${fc.lines?.join(',')}`;
        text += `    ${fc.path} (${lineStr})\n`;
      }
    }
    text += `\n`;
  }
  return text.trim();
}

function generateAiderOutput(fixes: Array<{ group: ErrorGroup; fix: FixResult }>): any {
  return {
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
}

async function main() {
  const config = parseArgs();

  console.log('🔧 Smart TypeScript Error Fixer\n');
  console.log('━'.repeat(60));
  console.log(`\n⚙️  Analyzer: ${config.analyzer}`);
  console.log(`⚙️  Output Format: ${config.outputFormat}`);
  if (config.maxGroups !== Infinity) console.log(`⚙️  Max Groups: ${config.maxGroups}`);
  console.log();

  let errorInput = '';
  if (!process.stdin.isTTY) {
    for await (const chunk of process.stdin) errorInput += chunk;
  } else if (existsSync(config.errorsPath)) {
    errorInput = readFileSync(config.errorsPath, 'utf8');
  } else {
    console.error('❌ No input provided!');
    process.exit(1);
  }

  if (!errorInput.trim()) {
    console.error('❌ No errors to analyze!');
    process.exit(1);
  }

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

  const result = analyzeWithRules(groupsToProcess);

  if (result.unknown.length > 0 && config.analyzer === 'rules') {
    console.log(`\n⚠️  ${result.unknown.length} error groups have no rules.`);
    console.log(`   Run with --analyzer hybrid to research these with LLM.\n`);
  }

  console.log('\n' + '━'.repeat(60) + '\n');

  // JSON output
  await Bun.write(config.outputJsonPath, JSON.stringify(generateAiderOutput(result.fixes), null, 2));

  // Aider text output
  const aiderText = generateAiderText(result.fixes);
  await Bun.write(config.outputTxtPath, aiderText);

  console.log(`💾 Fixes written to ${config.outputJsonPath} (JSON)`);
  console.log(`💾 Fixes written to ${config.outputTxtPath} (Aider-style text)`);
  console.log(`✨ Done!\n`);
}

main();
