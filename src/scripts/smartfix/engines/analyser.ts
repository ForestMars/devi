/**
 * @file analyser.ts
 * @description LLM engine to generate TypeScript error fix suggestions using Ollama.
 * Exported function: analyzeWithAnalyser
 *
 * @author Me and Mr. Fixit
 * @version 0.0.1
 * @license MIT
 */

import type { ErrorGroup } from '../types';
import type { Config } from '../mrfixit';

/**
 * Sends a grouped set of TypeScript errors to the LLM and returns suggested fixes.
 * Fully supports streaming mode.
 */
export async function analyzeWithAnalyser(
  groups: ErrorGroup[],
  config: Config,
  promptTemplate: string | null
): Promise<Array<{ group: ErrorGroup; fix: string }>> {
  const results: Array<{ group: ErrorGroup; fix: FixResult }> = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const startTime = Date.now(); 

    console.log(`🤖 Starting LLM analysis of ${groups.length} error groups...\n`);


    console.log(`🔧 [${i + 1}/${groups.length}] Processing ${group.code}: ${group.pattern}`);
    console.log(`   ${group.count} occurrence(s) across ${group.errors.length} file(s)`);

    // Build prompt
    const exampleErrors = group.errors.slice(0, 3).map(e => `${e.file}:${e.line} - ${e.message}`).join('\n');
    let prompt: string;

    if (promptTemplate) {
      prompt = promptTemplate
        .replace(/\{\{BUILD_ERRORS\}\}/g, exampleErrors) 
        .replace(/\{\{ERROR_CODE\}\}/g, group.code)
        .replace(/\{\{ERROR_PATTERN\}\}/g, group.pattern)
        .replace(/\{\{ERROR_COUNT\}\}/g, group.count.toString())
        .replace(/\{\{EXAMPLE_ERRORS\}\}/g, exampleErrors);
    } else {
      prompt = `Immediately return this: "Context not found. Nothing to do."`;
    }

    try {
      console.log(`   📡 Sending request to ${config.ollamaHost}...`);
      const response = await fetch(`${config.ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          prompt,
          stream: config.streaming,
          options: {
            temperature: 0.2,
            num_predict: 300
          }
        }),
        signal: AbortSignal.timeout(300_000)
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${text}`);
      }

      let fix: string;

      if (config.streaming) {
        console.log(`   ⏳ Streaming response...`);
        const text = await response.text();
        const lines = text.trim().split("\n");
        let output = "";
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.response) output += obj.response;
          } catch {}
        }
        fix = output || 'No solution generated';
      } else {
        const data = await response.json();
        fix = data.response || 'No solution generated';
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ✅ Done in ${elapsed}s\n`);

      results.push({ group, fix });

    } catch (error: any) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
        console.log(`   ⏱️  Timeout after ${elapsed}s\n`);
        results.push({ group, fix: `Error: Request timed out after 300 seconds. Try using --stream or a faster model.` });
      } else {
        console.log(`   ❌ Error after ${elapsed}s: ${error.message}\n`);
        results.push({ group, fix: `Error: ${error.message}` });
      }
    }
  }

  return results;
}
