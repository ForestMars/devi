/**
 * @file analyser.ts
 * @description LLM engine to generate TypeScript error fix suggestions using Ollama.
 * Exported function: analyzeWithAnalyser
 *
 * @author Me and Mr. Fixit
 * @version 0.0.2
 * @license MIT
 */

import type { ErrorGroup, FixResult } from '../types';

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

/**
 * Parse LLM response and extract FixResult JSON
 */
function parseLLMResponse(responseText: string): Partial<FixResult> {
  try {
    // Try direct JSON parse first
    return JSON.parse(responseText);
  } catch (firstError) {
    // Try to extract JSON from markdown code blocks
    try {
      const jsonBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        return JSON.parse(jsonBlockMatch[1].trim());
      }

      // Try to find JSON object boundaries
      const jsonObjectMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        return JSON.parse(jsonObjectMatch[0]);
      }

      // If all parsing fails, treat as plain text description
      return {
        confidence: 'low',
        fixType: 'suggestion',
        description: responseText.trim(),
        fileChanges: ''
      };
    } catch (extractError) {
      // Last resort: return the raw text as description
      return {
        confidence: 'low',
        fixType: 'suggestion',
        description: responseText.trim() || 'No solution generated',
        fileChanges: ''
      };
    }
  }
}

/**
 * Sends a grouped set of TypeScript errors to the LLM and returns suggested fixes.
 * Fully supports streaming mode.
 */
export async function analyzeWithAnalyser(
  groups: ErrorGroup[],
  config: Config,
  promptTemplate: string | null
): Promise<{ fixes: Array<{ group: ErrorGroup; fix: FixResult }> }> {
  const results: Array<{ group: ErrorGroup; fix: FixResult }> = [];

  console.log(`🤖 Starting LLM analysis of ${groups.length} error groups...\n`);

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const startTime = Date.now(); 

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
      prompt = `Analyze TypeScript error ${group.code}: ${group.pattern}. Return JSON with: confidence, fixType, description, fileChanges.`;
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
            num_predict: 500
          }
        }),
        signal: AbortSignal.timeout(300_000)
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${text}`);
      }

      let rawResponse: string;

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
        rawResponse = output || 'No solution generated';
      } else {
        const data = await response.json();
        rawResponse = data.response || 'No solution generated';
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ✅ Done in ${elapsed}s`);

      // Parse the LLM response into a FixResult structure
      const parsed = parseLLMResponse(rawResponse);
      
      // Build complete FixResult with defaults for missing fields
      const fixResult: FixResult = {
        confidence: parsed.confidence || 'medium',
        fixType: parsed.fixType || 'suggestion',
        description: parsed.description || rawResponse,
        fileChanges: parsed.fileChanges || group.errors.map(e => e.file).join(', '),
        commands: parsed.commands || [],
        manualSteps: parsed.manualSteps || []
      };

      console.log(`   📋 Fix type: ${fixResult.fixType}, confidence: ${fixResult.confidence}\n`);

      results.push({ group, fix: fixResult });

    } catch (error: any) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const errorMsg = error.name === 'TimeoutError' || error.message.includes('timeout')
        ? `Request timed out after 300 seconds. Try using --stream or a faster model.`
        : error.message;

      if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
        console.log(`   ⏱️  Timeout after ${elapsed}s\n`);
      } else {
        console.log(`   ❌ Error after ${elapsed}s: ${error.message}\n`);
      }

      // Return a properly structured error FixResult
      const errorFixResult: FixResult = {
        confidence: 'low',
        fixType: 'manual',
        description: `Error: ${errorMsg}`,
        fileChanges: '',
        commands: [],
        manualSteps: ['Investigate the error manually', 'Check Ollama service status']
      };

      results.push({ group, fix: errorFixResult });
    }
  }

  return { fixes: results };
}