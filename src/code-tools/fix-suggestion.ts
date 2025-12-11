#!/usr/bin/env bun
/**
 * @file smart-fix-agent.ts
 * @description Analyzes TypeScript build errors, intelligently groups similar errors,
 * and generates consolidated, systemic fix suggestions using an Ollama LLM.
 *
 * @author Me, with help from Sonnet
 * @version 0.0.1
 * @license Unlicensed 
 *
 * @usage
 *
 * @dependencies
 * - Bun Runtime Environment
 * - Ollama (running locally or accessible via --host)
 */


import { readFileSync, existsSync } from "fs";
import { join } from "path";

// -----------------------
// CLI argument handling
// -----------------------
const args = process.argv.slice(2);

function showHelp() {
  console.log(`
fix-suggestion.ts — Generate LLM suggestions for TypeScript build errors

USAGE:
  bun fix-suggestion.ts [--model <name>] [--errors <path>] [--prompt <path>] [--help]

OPTIONS:
  --model <name>     Select the Ollama model (default: qwen-coder:latest)
  --errors <path>    Path to build errors file (default: ./build-errors.txt)
  --prompt <path>    Path to prompt template (default: ./prompts/fix-suggestion.prompt.txt)
  --help             Show this help message

DESCRIPTION:
  Reads build error output, loads a prompt template, renders it with the
  BUILD_ERROR variable, sends each error individually to Ollama, and prints
  JSON responses containing LLM-generated fix suggestions.
`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) showHelp();

function getFlagValue(flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const model = getFlagValue("--model", "qwen-coder:latest");
const errorsPath = getFlagValue("--errors", join(process.cwd(), "build-errors.txt"));
const promptPath = getFlagValue("--prompt", join(process.cwd(), "prompts/fix-suggestion.prompt.txt"));

// -----------------------
// Load build errors
// -----------------------
if (!existsSync(errorsPath)) {
  console.error(`Missing build errors file: ${errorsPath}`);
  process.exit(1);
}
const errorLines = readFileSync(errorsPath, "utf8")
  .split("\n")
  .map(line => line.trim())
  .filter(Boolean);

// -----------------------
// Load prompt template
// -----------------------
if (!existsSync(promptPath)) {
  console.error(`Missing prompt template: ${promptPath}`);
  process.exit(1);
}
const promptTemplate = readFileSync(promptPath, "utf8");

// -----------------------
// Bun-native fetch to call Ollama
// We use fetch instead of curl because Bun natively supports HTTP requests
// without needing a subprocess call, making it faster and cleaner.
// -----------------------
async function askOllama(prompt: string) {
  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt })
  });

  const text = await response.text();

  // Ollama returns NDJSON. Merge all "response" fields.
  const lines = text.trim().split("\n");
  let output = "";
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.response) output += obj.response;
    } catch {}
  }

  // Validate JSON
  try {
    return JSON.parse(output);
  } catch {
    console.error("Model output was not valid JSON:\n", output);
    process.exit(1);
  }
}

// -----------------------
// Iterate over each error individually
// -----------------------
for (const error of errorLines) {
  const prompt = promptTemplate.replace("{{BUILD_ERROR}}", error);
  console.log(`\n=== Processing Error ===\n${error}\n`);
  const fix = await askOllama(prompt);
  console.log(JSON.stringify(fix, null, 2));
}
