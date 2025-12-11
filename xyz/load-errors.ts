# load errors

import { parseTypeScriptErrors } from './parse-ts-errors.js';
import { groupErrors } from './group-errors.js';
import { generateGroupFix } from './generate-group-fix.js';
import * as fs from 'fs';

export async function main() {
  console.log('🤖 TypeScript Error Auto-Fixer (Smart Grouping)\n');
  console.log('━'.repeat(60) + '\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  let maxGroups = Infinity;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' || args[i] === '-n') {
      maxGroups = parseInt(args[i + 1]);
      i++;
    }
  }

  // Load errors from stdin or file
  let errorInput = '';
  if (!process.stdin.isTTY) {
    console.log('📥 Reading errors from stdin...\n');
    process.stdin.on('data', chunk => {
      errorInput += chunk;
    });
    process.stdin.on('end', () => {
      runFixer(errorInput, maxGroups);
    });
  } else {
    const errorsPath = args.find(arg => !arg.startsWith('--'));
    if (errorsPath) {
      try {
        const data = fs.readFileSync(errorsPath, 'utf8');
        runFixer(data, maxGroups);
      } catch (err) {
        console.error(`Error reading file: ${err}`);
      }
    } else {
      console.error('No errors path provided.');
    }
  }

  async function runFixer(input: string, maxGroups: number) {
    try {
      const errors = parseTypeScriptErrors(input);
      if (errors.length === 0) {
        console.log('No TypeScript errors found.');
        return;
      }

      const groups = groupErrors(errors).slice(0, maxGroups);

      for (const group of groups) {
        try {
          const fix = await generateGroupFix(group);
          console.log(`Fix for ${group.count} occurrences of error code ${group.code}:`);
          console.log(fix);
        } catch (err) {
          console.error(`Error generating fix for error code ${group.code}:`, err);
        }
      }
    } catch (err) {
      console.error('Error parsing TypeScript errors:', err);
    }
  }
}

main();
