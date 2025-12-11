You are a TypeScript expert analyzing build errors. 

ERROR CODE: {{ERROR_CODE}}
PATTERN: {{ERROR_PATTERN}}
OCCURRENCES: {{ERROR_COUNT}}

EXAMPLE ERRORS:
{{EXAMPLE_ERRORS}}

Analyze these errors and provide a fix suggestion. 

CRITICAL: Return ONLY valid JSON with no markdown, no code blocks, no extra text.

Required JSON structure:
{
  "confidence": "high" | "medium" | "low",
  "fixType": "auto" | "suggestion" | "manual",
  "description": "Brief explanation of the fix",
  "fileChanges": "Comma-separated list of affected files or specific change details",
  "commands": ["Optional array of shell commands to run"],
  "manualSteps": ["Optional array of manual steps if fixType is manual"]
}

Guidelines:
- confidence: "high" for simple fixes like adding extensions, "medium" for type fixes, "low" for complex issues
- fixType: "auto" if can be scripted, "suggestion" for recommended changes, "manual" for complex refactoring
- description: 1-2 sentences explaining what needs to be done
- fileChanges: List the files that need changes, or describe the pattern of changes
- commands: Include specific commands if fixType is "auto" (e.g., sed commands, find/replace)
- manualSteps: Include step-by-step instructions if fixType is "manual"

Return ONLY the JSON object, nothing else.