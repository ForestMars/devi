{
  "summary": "Fixed 6 error groups",
  "fixes": [
    {
      "errorCode": "TS2835",
      "pattern": "Missing file extension in import",
      "count": 15,
      "confidence": "high",
      "fixType": "batch-edit",
      "description": "Add .js extensions to 15 import statements across 7 files",
      "fileChanges": [
        {
          "path": "src/agents/review-engine-core.ts",
          "instruction": "Add .js extension to all relative import statements on lines: 4. Change patterns like \"from './foo'\" to \"from './foo.js'\" and \"from '../bar/baz'\" to \"from '../bar/baz.js'\"",
          "lines": [
            4
          ]
        },
        {
          "path": "src/agents/review-engine.ts",
          "instruction": "Add .js extension to all relative import statements on lines: 5, 6, 7. Change patterns like \"from './foo'\" to \"from './foo.js'\" and \"from '../bar/baz'\" to \"from '../bar/baz.js'\"",
          "lines": [
            5,
            6,
            7
          ]
        },
        {
          "path": "src/config/config-loader.ts",
          "instruction": "Add .js extension to all relative import statements on lines: 10. Change patterns like \"from './foo'\" to \"from './foo.js'\" and \"from '../bar/baz'\" to \"from '../bar/baz.js'\"",
          "lines": [
            10
          ]
        },
        {
          "path": "src/index.ts",
          "instruction": "Add .js extension to all relative import statements on lines: 4, 5. Change patterns like \"from './foo'\" to \"from './foo.js'\" and \"from '../bar/baz'\" to \"from '../bar/baz.js'\"",
          "lines": [
            4,
            5
          ]
        },
        {
          "path": "src/pr-test.ts",
          "instruction": "Add .js extension to all relative import statements on lines: 5. Change patterns like \"from './foo'\" to \"from './foo.js'\" and \"from '../bar/baz'\" to \"from '../bar/baz.js'\"",
          "lines": [
            5
          ]
        },
        {
          "path": "src/providers/index.ts",
          "instruction": "Add .js extension to all relative import statements on lines: 5, 6, 7, 9, 10, 11. Change patterns like \"from './foo'\" to \"from './foo.js'\" and \"from '../bar/baz'\" to \"from '../bar/baz.js'\"",
          "lines": [
            5,
            6,
            7,
            9,
            10,
            11
          ]
        },
        {
          "path": "src/providers/ollama-provider.ts",
          "instruction": "Add .js extension to all relative import statements on lines: 3. Change patterns like \"from './foo'\" to \"from './foo.js'\" and \"from '../bar/baz'\" to \"from '../bar/baz.js'\"",
          "lines": [
            3
          ]
        }
      ],
      "commands": [],
      "manualSteps": []
    },
    {
      "errorCode": "TS7006",
      "pattern": "Implicit any type",
      "count": 6,
      "confidence": "medium",
      "fixType": "batch-edit",
      "description": "Add type annotations to 6 parameters with implicit 'any'",
      "fileChanges": [
        {
          "path": "src/agents/review-engine.ts",
          "instruction": "Add explicit type annotation to parameter 'pattern' on line 102. Common types: string, number, any, or a specific interface type.",
          "lines": [
            102
          ]
        },
        {
          "path": "src/pr-test.ts",
          "instruction": "Add explicit type annotation to parameter 'f' on line 60. Common types: string, number, any, or a specific interface type.",
          "lines": [
            60
          ]
        },
        {
          "path": "src/pr-test.ts",
          "instruction": "Add explicit type annotation to parameter 'finding' on line 131. Common types: string, number, any, or a specific interface type.",
          "lines": [
            131
          ]
        },
        {
          "path": "src/pr-test.ts",
          "instruction": "Add explicit type annotation to parameter 'i' on line 131. Common types: string, number, any, or a specific interface type.",
          "lines": [
            131
          ]
        },
        {
          "path": "src/pr-test.ts",
          "instruction": "Add explicit type annotation to parameter 'f' on line 141. Common types: string, number, any, or a specific interface type.",
          "lines": [
            141
          ]
        },
        {
          "path": "src/pr-test.ts",
          "instruction": "Add explicit type annotation to parameter 'f' on line 142. Common types: string, number, any, or a specific interface type.",
          "lines": [
            142
          ]
        }
      ],
      "commands": [],
      "manualSteps": []
    },
    {
      "errorCode": "TS2304",
      "pattern": "Cannot find name",
      "count": 4,
      "confidence": "high",
      "fixType": "batch-edit",
      "description": "Add missing import for 'LLMProvider' to 4 files",
      "fileChanges": [
        {
          "path": "src/providers/claude-provider.ts",
          "instruction": "Add import statement at top of file: import { LLMProvider } from './llm-provider.interface.js';",
          "lines": [
            1
          ]
        },
        {
          "path": "src/providers/gemini-provider.ts",
          "instruction": "Add import statement at top of file: import { LLMProvider } from './llm-provider.interface.js';",
          "lines": [
            1
          ]
        },
        {
          "path": "src/providers/openai-provider.ts",
          "instruction": "Add import statement at top of file: import { LLMProvider } from './llm-provider.interface.js';",
          "lines": [
            1
          ]
        },
        {
          "path": "src/providers/openrouter-provider.ts",
          "instruction": "Add import statement at top of file: import { LLMProvider } from './llm-provider.interface.js';",
          "lines": [
            1
          ]
        }
      ],
      "commands": [],
      "manualSteps": []
    },
    {
      "errorCode": "TS2307",
      "pattern": "Cannot find module",
      "count": 3,
      "confidence": "high",
      "fixType": "command",
      "description": "Install missing dependency '@octokit/rest'",
      "fileChanges": [],
      "commands": [
        "bun add @octokit/rest"
      ],
      "manualSteps": []
    },
    {
      "errorCode": "TS2834",
      "pattern": "Missing file extension in import",
      "count": 2,
      "confidence": "high",
      "fixType": "batch-edit",
      "description": "Add .js extensions to 2 import statements across 2 files",
      "fileChanges": [
        {
          "path": "src/agents/review-engine.ts",
          "instruction": "Add .js extension to all relative import statements on lines: 4. Change patterns like \"from './foo'\" to \"from './foo.js'\" and \"from '../bar/baz'\" to \"from '../bar/baz.js'\"",
          "lines": [
            4
          ]
        },
        {
          "path": "src/pr-test.ts",
          "instruction": "Add .js extension to all relative import statements on lines: 6. Change patterns like \"from './foo'\" to \"from './foo.js'\" and \"from '../bar/baz'\" to \"from '../bar/baz.js'\"",
          "lines": [
            6
          ]
        }
      ],
      "commands": [],
      "manualSteps": []
    },
    {
      "errorCode": "TS7016",
      "pattern": "Missing type declarations",
      "count": 1,
      "confidence": "high",
      "fixType": "command",
      "description": "Install type declarations for 'js-yaml'. '/Users/forestmars/sandbox/pedal/node_modules/js-yaml/dist/js-yaml.mjs' implicitly has an 'any'",
      "fileChanges": [],
      "commands": [
        "bun add -d @types/js-yaml'. '/Users/forestmars/sandbox/pedal/node_modules/js-yaml/dist/js-yaml.mjs' implicitly has an 'any"
      ],
      "manualSteps": []
    }
  ]
}