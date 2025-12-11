// src/scripts/smartfix/types.ts

export interface TSError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  context: string;
}

export interface ErrorGroup {
  code: string;
  pattern: string;
  errors: TSError[];
  count: number;
}

export interface FileChange {
  path: string;
  instruction: string;
  lines?: number[];
}

export interface FixResult {
  confidence: 'high' | 'medium' | 'low';
  fixType: 'batch-edit' | 'command' | 'manual';
  description: string;
  fileChanges?: FileChange[];
  commands?: string[];
  manualSteps?: string[];
}

export interface ErrorRule {
  codes: string[];
  pattern?: RegExp;
  analyze: (group: ErrorGroup) => FixResult;
}