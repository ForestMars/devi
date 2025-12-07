# TypeScript Build Fixes

* **Generated:** 2025-12-07T05:12:08.819Z
* **Model:** qwen-coder:latest
* **Total Errors:** 35
* **Error Categories Processed:** 7 of 7

---

## 1. [TS2835] Missing file extension in import (15 occurrences)

### Fix Suggestion

Error: Ollama API error: 404 - {"error":"model 'qwen-coder:latest' not found"}

### Affected Files
- `src/agents/review-engine-core.ts:4` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './review-engine-types.js'?
- `src/agents/review-engine.ts:5` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../config/config-loader.js'?
- `src/agents/review-engine.ts:6` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './review-engine-core.js'?
- `src/agents/review-engine.ts:7` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './review-engine-types.js'?
- `src/config/config-loader.ts:10` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../providers/index.js'?
- `src/index.ts:4` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './config/config-loader.js'?
- `src/index.ts:5` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './agents/review-engine.js'?
- `src/pr-test.ts:5` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './agents/review-engine.js'?
- `src/providers/index.ts:5` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './api-provider-base.js'?
- `src/providers/index.ts:6` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './claude-provider.js'?
- ... and 5 more files.

---

## 2. [TS7006] Implicit any type (6 occurrences)

### Fix Suggestion

Error: Ollama API error: 404 - {"error":"model 'qwen-coder:latest' not found"}

### Affected Files
- `src/agents/review-engine.ts:102` - Parameter 'pattern' implicitly has an 'any' type.
- `src/pr-test.ts:60` - Parameter 'f' implicitly has an 'any' type.
- `src/pr-test.ts:131` - Parameter 'finding' implicitly has an 'any' type.
- `src/pr-test.ts:131` - Parameter 'i' implicitly has an 'any' type.
- `src/pr-test.ts:141` - Parameter 'f' implicitly has an 'any' type.
- `src/pr-test.ts:142` - Parameter 'f' implicitly has an 'any' type.

---

## 3. [TS2339] Property does not exist (4 occurrences)

### Fix Suggestion

Error: Ollama API error: 404 - {"error":"model 'qwen-coder:latest' not found"}

### Affected Files
- `src/index.ts:84` - Property 'action' does not exist on type 'BranchProtectionConfigurationDisabledEvent | BranchProtectionConfigurationEnabledEvent | ... 436 more ... | WorkflowDispatchEvent'.
- `src/providers/ollama-provider.ts:18` - Property 'host' does not exist on type 'OllamaProvider'.
- `src/providers/ollama-provider.ts:21` - Property 'model' does not exist on type 'OllamaProvider'.
- `src/providers/ollama-provider.ts:26` - Property 'maxOutputTokens' does not exist on type 'OllamaProvider'.

---

## 4. [TS2304] Cannot find name (4 occurrences)

### Fix Suggestion

Error: Ollama API error: 404 - {"error":"model 'qwen-coder:latest' not found"}

### Affected Files
- `src/providers/claude-provider.ts:3` - Cannot find name 'LLMProvider'.
- `src/providers/gemini-provider.ts:3` - Cannot find name 'LLMProvider'.
- `src/providers/openai-provider.ts:3` - Cannot find name 'LLMProvider'.
- `src/providers/openrouter-provider.ts:3` - Cannot find name 'LLMProvider'.

---

## 5. [TS2307] Cannot find module (3 occurrences)

### Fix Suggestion

Error: Ollama API error: 404 - {"error":"model 'qwen-coder:latest' not found"}

### Affected Files
- `src/pr-test.ts:4` - Cannot find module '@octokit/rest' or its corresponding type declarations.
- `src/providers/api-provider-base.ts:1` - Cannot find module './llm-provider.interface' or its corresponding type declarations.
- `src/providers/index.ts:8` - Cannot find module './llm-provider.interface' or its corresponding type declarations.

---

## 6. [TS2834] Missing file extension in import (2 occurrences)

### Fix Suggestion

Error: Ollama API error: 404 - {"error":"model 'qwen-coder:latest' not found"}

### Affected Files
- `src/agents/review-engine.ts:4` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Consider adding an extension to the import path.
- `src/pr-test.ts:6` - Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Consider adding an extension to the import path.

---

## 7. [TS7016] Missing type declarations (1 occurrences)

### Fix Suggestion

Error: Ollama API error: 404 - {"error":"model 'qwen-coder:latest' not found"}

### Affected Files
- `src/config/config-loader.ts:11` - Could not find a declaration file for module 'js-yaml'. '/Users/forestmars/sandbox/pedal/node_modules/js-yaml/dist/js-yaml.mjs' implicitly has an 'any' type.

---

