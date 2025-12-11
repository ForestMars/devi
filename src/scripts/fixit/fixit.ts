#!/usr/bin/env bun

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { spawn } from "bun";

// ---- Paths ----
// Get absolute path to repo root more reliably
const SCRIPT_DIR = import.meta.dir; // Directory containing this script
const ROOT_DIR = join(SCRIPT_DIR, "../../.."); // Go up to repo root
const FIX_FILE = join(ROOT_DIR, "ts-fixes.json");
const WORK_DIR = join(ROOT_DIR, ".fixit");
const PROMPT_DIR = join(WORK_DIR, "prompts");
const LOG_DIR = join(WORK_DIR, "logs");

console.log(`Script dir: ${SCRIPT_DIR}`);
console.log(`Root dir: ${ROOT_DIR}`);

if (!existsSync(PROMPT_DIR)) mkdirSync(PROMPT_DIR, { recursive: true });
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

// ---- Load JSON ----
console.log(`Loading fixes from ${FIX_FILE}`);
const json = JSON.parse(readFileSync(FIX_FILE, "utf-8"));

// ---- Build pipeline stages ----
type Stage = { promptPath: string; filePath: string; logPath: string; prompt: string };
const pipeline: Stage[] = [];

for (const [fi, fix] of json.fixes.entries()) {
  for (const [ci, fc] of fix.fileChanges.entries()) {
    const promptPath = join(PROMPT_DIR, `fix-${fi}-${ci}.txt`);
    const logPath = join(LOG_DIR, `fix-${fi}-${ci}.log`);
    const fullFilePath = join(ROOT_DIR, fc.path);

    // Read the actual lines from the file to make prompts specific
    let specificInstruction = fc.instruction;
    if (existsSync(fullFilePath) && fc.lines && fc.lines.length > 0) {
      try {
        const fileContent = readFileSync(fullFilePath, 'utf-8');
        const fileLines = fileContent.split('\n');
        
        // For import fixes, show more context (all imports)
        if (fix.errorCode.match(/TS2835|TS2834/) && fc.path.includes('index.ts')) {
          // Show all export lines for index files
          const allExports = fileLines
            .map((line, idx) => ({ line, num: idx + 1 }))
            .filter(({ line }) => line.trim().startsWith('export'))
            .map(({ line, num }) => `Line ${num}: ${line.trim()}`)
            .join('\n');
          specificInstruction = `${fc.instruction}\n\nCurrent file exports:\n${allExports}`;
        } else {
          // Show specific lines mentioned
          const relevantLines = fc.lines
            .map(lineNum => {
              const line = fileLines[lineNum - 1]; // Convert 1-indexed to 0-indexed
              return line ? `Line ${lineNum}: ${line.trim()}` : null;
            })
            .filter(Boolean)
            .join('\n');
          
          if (relevantLines) {
            specificInstruction = `${fc.instruction}\n\nCurrent code:\n${relevantLines}`;
          }
        }
      } catch (err) {
        console.warn(`Warning: Could not read ${fc.path} for specific context`);
      }
    }

    const prompt = `Error group: ${fix.errorCode}
Group description: ${fix.description}

Target file: ${fc.path}
Lines involved: ${JSON.stringify(fc.lines)}

Instruction:
${specificInstruction}

IMPORTANT: Only add .js extension to relative imports/exports (those starting with ./ or ../). Do NOT add .js to npm packages or directory re-exports that are already correct.
Make only the minimal changes needed to fix this error. Do not modify anything else.`;

    pipeline.push({ promptPath, filePath: fc.path, logPath, prompt });

    writeFileSync(promptPath, prompt);
    console.log(`Prepared prompt: ${promptPath}`);
  }
}

// ---- Run pipeline ----
async function runPipeline() {
  console.log(`Running pipeline with ${pipeline.length} stages`);
  const TIMEOUT_MS = 180000; // 3 minutes timeout per stage (7B model is slower)

  for (const [index, stage] of pipeline.entries()) {
    console.log(`\n=== Stage ${index + 1}/${pipeline.length} ===`);
    console.log(`Target file: ${stage.filePath}`);
    console.log(`Prompt file: ${stage.promptPath}`);
    console.log(`Log file: ${stage.logPath}`);

    const startTime = Date.now();
    let timedOut = false;

    try {
      const process = spawn({
        cmd: [
          "aider",
          stage.filePath, // Use relative path from ROOT_DIR
          "--model", "ollama/qwen2.5-coder:7b", // 7B model for better accuracy
          "--edit-format", "diff", // Use search/replace format instead of udiff
          "--yes",
          "--no-auto-commits", // Don't auto-commit, but still use git
          "--message", stage.prompt
        ],
        cwd: ROOT_DIR, // Run from repo root
        stdout: "pipe",
        stderr: "pipe",
      });

      // Set up timeout that will kill the process
      const timeoutId = setTimeout(() => {
        console.log(`⏱️  Timeout reached, killing process...`);
        timedOut = true;
        process.kill();
      }, TIMEOUT_MS);

      const stdout = await process.stdout.text();
      const stderr = await process.stderr.text();
      const exit = await process.exited;

      clearTimeout(timeoutId);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Completed in ${elapsed}s`);

      if (timedOut) {
        console.error(`✗ Process was killed due to timeout`);
        writeFileSync(stage.logPath, `ERROR: Timeout after ${TIMEOUT_MS / 1000}s\n\nPartial STDOUT:\n${stdout}\n\nPartial STDERR:\n${stderr}`);
        continue;
      }

      // Bun returns exit code directly, not in exitCode property
      const exitCode = typeof exit === 'number' ? exit : (exit as any).exitCode ?? -1;
      console.log(`Aider exit code: ${exitCode}`);
      if (stderr.trim().length > 0) console.log(`Aider stderr: ${stderr}`);

      writeFileSync(stage.logPath, `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`);
      console.log(`Aider output saved to: ${stage.logPath}`);

      if (exitCode === 0) {
        console.log(`✓ File updated successfully`);
      } else {
        console.error(`✗ Aider failed with exit code ${exitCode}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message === "Timeout") {
        console.error(`✗ Aider timed out after ${TIMEOUT_MS / 1000}s for ${stage.filePath}`);
        writeFileSync(stage.logPath, `ERROR: Timeout after ${TIMEOUT_MS / 1000}s`);
      } else {
        console.error(`Error running Aider for ${stage.filePath}:`, err);
        writeFileSync(stage.logPath, `ERROR: ${err}`);
      }
    }
  }

  console.log("\nPipeline complete.");
}

// ---- Entry point ----
if (process.argv[2] === "run") {
  runPipeline();
} else {
  console.log(
    "Prompts emitted. Run `bun ./src/scripts/fixit/fixit.ts run` to execute the Ollama pipeline."
  );
}