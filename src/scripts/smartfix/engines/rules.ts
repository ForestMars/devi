// src/scripts/smartfix/engines/rules.ts

import type { ErrorGroup } from '../types';
import type { FixResult } from '../rules/ruleset';
import { TS_ERROR_RULES } from '../rules/ruleset';

export interface RulesEngineResult {
  fixes: Array<{ group: ErrorGroup; fix: FixResult }>;
  unknown: ErrorGroup[];
}

export function analyzeWithRules(groups: ErrorGroup[]): RulesEngineResult {
  const fixes: Array<{ group: ErrorGroup; fix: FixResult }> = [];
  const unknown: ErrorGroup[] = [];
  
  for (const group of groups) {
    // Find matching rule
    const rule = TS_ERROR_RULES.find(r => {
      const codeMatches = r.codes.includes(group.code);
      if (!codeMatches) return false;
      
      // If rule has a pattern, check if it matches
      if (r.pattern) {
        return r.pattern.test(group.errors[0].message);
      }
      
      return true;
    });
    
    if (rule) {
      const fix = rule.analyze(group);
      fixes.push({ group, fix });
      
      console.log(`✅ [${group.code}] ${group.pattern} - ${fix.confidence} confidence ${fix.fixType}`);
    } else {
      unknown.push(group);
      console.log(`⚠️  [${group.code}] ${group.pattern} - no rule found`);
    }
  }
  
  console.log(`\n📊 Rules Engine Results:`);
  console.log(`   ✅ ${fixes.length} error groups matched`);
  console.log(`   ⚠️  ${unknown.length} unknown errors`);
  
  return { fixes, unknown };
}