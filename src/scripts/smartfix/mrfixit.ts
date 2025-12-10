#!/usr/bin/env bun
/**
 * @file mrfixit.ts
 * @description Smart TypeScript Error Fixer Harness
 *              Supports two engines: rules (deterministic) and analyser (LLM)
 * @version 0.0.11
 */



import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { join } from 'path';
import type { ErrorGroup, TSError, FixResult } from './types';
import { analyzeWithRules } from './engines/rules';
import { analyzeWithAnalyser } from './engines/analyser';

interface Config {
  engine: 'rules' | 'analyser';
  model?: string;
  ollamaHost: string;
  maxGroups: number;
  errorsPath: string;
  outputJsonPath: string;
  outputTxtPath: string;
  streaming: boolean;
}

interface FixResult {
  confidence: 'high' | 'medium' | 'low';
  fixType: 'auto' | 'suggestion' | 'manual';
  description: string;
  fileChanges: string; // The actual code change content/diff
}

interface Fix {
  group: ErrorGroup;
  fix: FixResult; // This is the required rich object
}

const DEFAULTS = {
  engine: 'rules' as const,
  model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:32b',
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  errorsPath: join(process.cwd(), 'build-errors.txt'),
  outputJsonPath: join(process.cwd(), 'ts-fixes.json'),
  outputTxtPath: join(process.cwd(), 'ts-fixes.txt'),
  maxGroups: Infinity,
  streaming: true
};

// --- Parse config from environment ---
function getConfig(): Config {
  return {
    engine: (process.env.ENGINE === 'analyser' ? 'analyser' : 'rules'),
    model: process.env.OLLAMA_MODEL || DEFAULTS.model,
    ollamaHost: process.env.OLLAMA_HOST || DEFAULTS.ollamaHost,
    errorsPath: process.env.ERRORS_PATH || DEFAULTS.errorsPath,
    outputJsonPath: process.env.OUTPUT_JSON_PATH || DEFAULTS.outputJsonPath,
    outputTxtPath: process.env.OUTPUT_TXT_PATH || DEFAULTS.outputTxtPath,
    maxGroups: process.env.MAX_GROUPS ? parseInt(process.env.MAX_GROUPS) : DEFAULTS.maxGroups,
    streaming: process.env.STREAMING !== 'false'
  };
}

// Select engine via environment variable
// Options: "RULES" or "LLM"
const engineType = process.env.SMARTFIX_ENGINE || "LLM";

// --- Parse TypeScript errors ---
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

// --- Group errors by pattern ---
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

// --- Generate Aider-style text output ---
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

// --- Generate Aider-style JSON output ---
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

// --- Main ---
async function main() {
  const config = getConfig();


  console.log('DEBUG: process.env.ENGINE =', process.env.ENGINE);
  console.log('DEBUG: config.engine =', config.engine);

  console.log('🔧 Smart TypeScript Error Fixer (Harness)');
  console.log(`Engine: ${config.engine}`);
  console.log(`LLM Model: ${config.model}`);
  console.log(`Streaming: ${config.streaming}`);
  console.log('━'.repeat(60));

  // --- Load errors ---
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
    process.exit(0);
  }

  const groups = groupErrors(errors);
  const groupsToProcess = groups.slice(0, config.maxGroups);

  console.log(`Found ${errors.length} errors in ${groups.length} categories`);
  console.log(`Processing ${groupsToProcess.length} categories\n`);
  console.log('━'.repeat(60) + '\n');
  const promptPath = join(process.cwd(), 'prompts/fix-suggestion.prompt.txt');
  const promptTemplate = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : null;

  // --- Invoke selected engine ---
  let result: { fixes: Array<{ group: ErrorGroup; fix: FixResult }>; unknown?: ErrorGroup[] };

  try {
    if (config.engine === 'rules') {
      result = analyzeWithRules(groupsToProcess);
    } else if (config.engine === 'analyser') {
      result = await analyzeWithAnalyser(groupsToProcess, config, promptTemplate);
    }
    console.log('DEBUG: result =', result);
  } catch (error) {
    console.error('ERROR calling engine:', error);
    throw error;
  }

  // --- Write outputs ---
  // Ensure fixesArray is an array, defaulting to [] if result or result.fixes is undefined
  const fixesArray = result?.fixes || [];
  console.log('DEBUG: result =', result);
  console.log('DEBUG: result.fixes =', result.fixes); 
  console.log('DEBUG: fixesArray =', fixesArray);
  console.log('DEBUG: fixesArray length =', fixesArray?.length);

  // Use the fixesArray for both output functions
  await Bun.write(config.outputJsonPath, JSON.stringify(generateAiderOutput(fixesArray), null, 2));
  await Bun.write(config.outputTxtPath, generateAiderText(fixesArray)); 

  console.log(`💾 Fixes written to ${config.outputJsonPath} (JSON)`);
  console.log(`💾 Fixes written to ${config.outputTxtPath} (Aider-style text)`);
  console.log('✨ Done!');
}

main();
