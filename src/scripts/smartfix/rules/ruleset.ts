// src/scripts/smartfix/rules/ruleset.ts

// import type { ErrorGroup, TSError } from '../types';
import type { ErrorGroup, ErrorRule, FixResult, FileChange } from '../types';

export interface FixResult {
  confidence: 'high' | 'medium' | 'low';
  fixType: 'batch-edit' | 'command' | 'manual';
  description: string;
  fileChanges?: FileChange[];
  commands?: string[];
  manualSteps?: string[];
}

export interface FileChange {
  path: string;
  instruction: string;
  lines?: number[];
}

export interface ErrorRule {
  codes: string[];
  pattern?: RegExp;
  analyze: (group: ErrorGroup) => FixResult;
}

export const TS_ERROR_RULES: ErrorRule[] = [
  // Rule 1: Missing .js extensions (TS2835, TS2834)
  {
    codes: ['TS2835', 'TS2834'],
    analyze: (group) => {
      // Group by file for batch changes
      const fileMap = new Map<string, number[]>();
      
      group.errors.forEach(err => {
        if (!fileMap.has(err.file)) {
          fileMap.set(err.file, []);
        }
        fileMap.get(err.file)!.push(err.line);
      });
      
      const fileChanges: FileChange[] = Array.from(fileMap.entries()).map(([file, lines]) => ({
        path: file,
        instruction: `Add .js extension to all relative import statements on lines: ${lines.join(', ')}. Change patterns like "from './foo'" to "from './foo.js'" and "from '../bar/baz'" to "from '../bar/baz.js'"`,
        lines
      }));
      
      return {
        confidence: 'high',
        fixType: 'batch-edit',
        description: `Add .js extensions to ${group.errors.length} import statements across ${fileMap.size} files`,
        fileChanges
      };
    }
  },

  // Rule 2: Implicit any (TS7006)
  {
    codes: ['TS7006'],
    analyze: (group) => {
      const fileChanges: FileChange[] = group.errors.map(err => {
        // Extract parameter name from message
        const match = err.message.match(/Parameter '(\w+)' implicitly/);
        const paramName = match?.[1] || 'parameter';
        
        return {
          path: err.file,
          instruction: `Add explicit type annotation to parameter '${paramName}' on line ${err.line}. Common types: string, number, any, or a specific interface type.`,
          lines: [err.line]
        };
      });
      
      return {
        confidence: 'medium',
        fixType: 'batch-edit',
        description: `Add type annotations to ${group.errors.length} parameters with implicit 'any'`,
        fileChanges
      };
    }
  },

  // Rule 3: Property does not exist (TS2339)
  {
    codes: ['TS2339'],
    pattern: /Property '(\w+)' does not exist on type '(\w+)'/,
    analyze: (group) => {
      const firstError = group.errors[0];
      const match = firstError.message.match(/Property '(\w+)' does not exist on type '(\w+)'/);
      const [, prop, type] = match || [];
      
      // Special case: Known issue with base class properties
      if (['host', 'model', 'maxOutputTokens', 'temperature'].includes(prop)) {
        return {
          confidence: 'high',
          fixType: 'batch-edit',
          description: `Change private properties to protected in base class so subclasses can access them`,
          fileChanges: [{
            path: 'src/providers/api-provider-base.ts',
            instruction: `In the constructor, change all 'private host', 'private model' declarations to 'protected host', 'protected model'. Keep 'public maxOutputTokens' as is.`
          }]
        };
      }
      
      // Generic case - needs investigation
      return {
        confidence: 'low',
        fixType: 'manual',
        description: `Property '${prop}' cannot be accessed on '${type}'`,
        manualSteps: [
          `Check if '${prop}' should be public or protected instead of private`,
          `Verify '${prop}' exists in the '${type}' class/interface`,
          `Consider if '${prop}' needs to be added to '${type}'`
        ]
      };
    }
  },

  // Rule 4: Cannot find name (TS2304)
  {
    codes: ['TS2304'],
    pattern: /Cannot find name '(\w+)'/,
    analyze: (group) => {
      const firstError = group.errors[0];
      const match = firstError.message.match(/Cannot find name '(\w+)'/);
      const name = match?.[1];
      
      // Check if it's a common import issue
      if (name === 'LLMProvider') {
        const fileChanges: FileChange[] = group.errors.map(err => ({
          path: err.file,
          instruction: `Add import statement at top of file: import { LLMProvider } from './llm-provider.interface.js';`,
          lines: [1]
        }));
        
        return {
          confidence: 'high',
          fixType: 'batch-edit',
          description: `Add missing import for '${name}' to ${group.errors.length} files`,
          fileChanges
        };
      }
      
      // Generic case
      return {
        confidence: 'medium',
        fixType: 'manual',
        description: `Cannot find name '${name}' - likely missing import or typo`,
        manualSteps: [
          `Check if '${name}' is imported from the correct module`,
          `Verify spelling of '${name}'`,
          `Check if '${name}' is exported from its source file`
        ]
      };
    }
  },

  // Rule 5: Cannot find module (TS2307)
  {
    codes: ['TS2307'],
    pattern: /Cannot find module '(.+)'/,
    analyze: (group) => {
      const firstError = group.errors[0];
      const match = firstError.message.match(/Cannot find module '(.+)'/);
      const moduleName = match?.[1] || '';
      
      // Check if it's a type declarations issue
      if (moduleName.startsWith('@types/')) {
        const pkg = moduleName.replace('@types/', '');
        return {
          confidence: 'high',
          fixType: 'command',
          description: `Install missing type declarations for '${pkg}'`,
          commands: [`bun add -d ${moduleName}`]
        };
      }
      
      // Check if it's a package dependency
      if (!moduleName.startsWith('.')) {
        // Check specific known packages
        if (moduleName === '@octokit/rest') {
          return {
            confidence: 'high',
            fixType: 'command',
            description: `Install missing dependency '@octokit/rest'`,
            commands: ['bun add @octokit/rest']
          };
        }
        
        return {
          confidence: 'medium',
          fixType: 'command',
          description: `Install missing package '${moduleName}'`,
          commands: [`bun add ${moduleName}`]
        };
      }
      
      // Relative import - likely missing .js extension
      return {
        confidence: 'high',
        fixType: 'batch-edit',
        description: `Add .js extension to relative import`,
        fileChanges: group.errors.map(err => ({
          path: err.file,
          instruction: `On line ${err.line}, change import from '${moduleName}' to '${moduleName}.js'`,
          lines: [err.line]
        }))
      };
    }
  },

  // Rule 6: Missing type declarations (TS7016)
  {
    codes: ['TS7016'],
    pattern: /Could not find a declaration file for module '(.+)'/,
    analyze: (group) => {
      const firstError = group.errors[0];
      const match = firstError.message.match(/Could not find a declaration file for module '(.+)'/);
      const moduleName = match?.[1] || '';
      
      // Map common packages to their @types equivalents
      const typePackageMap: Record<string, string> = {
        'js-yaml': '@types/js-yaml',
        'express': '@types/express',
        'node': '@types/node'
      };
      
      const typePackage = typePackageMap[moduleName] || `@types/${moduleName}`;
      
      return {
        confidence: 'high',
        fixType: 'command',
        description: `Install type declarations for '${moduleName}'`,
        commands: [`bun add -d ${typePackage}`]
      };
    }
  }
];