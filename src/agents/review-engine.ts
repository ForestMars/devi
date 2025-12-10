// src/review-engine.ts - CLEANED UP VERSION

import { Context } from 'probot';
import { LLMProvider } from '../providers';
import { ConfigLoader } from '../config/config-loader';
import { ReviewEngineCore } from './review-engine-core';
import { PRFile, ReviewFinding, FilterStats, PostReviewContext } from './review-engine-types';
import * as fs from 'fs';
import * as path from 'path';

const agent = 'pr-review';

export class ReviewEngine {
  private configLoader: ConfigLoader;
  private filterStats?: FilterStats;
  private promptTemplate: string;

  constructor(private llm: LLMProvider, configLoader: ConfigLoader) {
    this.configLoader = configLoader;
    const modelName = this.llm.getModelName();
    console.log(`🤖 ReviewEngine using: ${this.llm.name} - ${modelName}`);
    
    // Load prompt ONCE at construction - with fallback to file reading
    this.promptTemplate = this.configLoader.getAgentContext(agent);
    
    if (!this.promptTemplate || this.promptTemplate.trim().length === 0) {
      console.warn(`⚠️  getAgentContext returned empty, trying direct file read...`);
      const promptPath = this.configLoader.getPromptFilePath(agent);
      try {
        this.promptTemplate = fs.readFileSync(promptPath, 'utf8');
        console.log(`✓ Loaded prompt from file: ${promptPath} (${this.promptTemplate.length} chars)`);
      } catch (e: any) {
        throw new Error(`Failed to load prompt template for agent ${agent}: ${e.message}`);
      }
    } else {
      console.log(`✓ Loaded prompt template (${this.promptTemplate.length} chars)`);
    }
  }

  async reviewPR(context: Context, pr: any, repo: any): Promise<void> {
    const owner = repo.owner.login;
    const repoName = repo.name;
    const prNumber = pr.number;
    const initialModelName = this.llm.getModelName();
    const llmDisplayName = `${this.llm.name} (${initialModelName})`;
    
    console.log(`🔍 Starting review with ${llmDisplayName}`);
    
    try {
      const { data: files } = await context.octokit.pulls.listFiles({
        owner,
        repo: repoName,
        pull_number: prNumber,
        per_page: 100
      });
      
      const filesToReview = this.filterFiles(files as PRFile[]);
      
      if (filesToReview.length === 0) {
        console.log('✓ No reviewable files found.');
        return;
      }

      const findings = await this.generateReview(pr, filesToReview);
      
      console.log(`✓ Parsed ${findings.length} finding(s)`);

      const coreContext: PostReviewContext = {
          llmName: this.llm.name,
          modelName: initialModelName,
          filterStats: this.filterStats
      };
      
      const core = new ReviewEngineCore(coreContext, filesToReview);
      
      if (findings.length > 0) {
        await core.postReview(context, owner, repoName, prNumber, pr.head.sha, findings);
      } else {
        console.log(`✓ No issues found by ${llmDisplayName}`);
        await context.octokit.issues.createComment({
          owner,
          repo: repoName,
          issue_number: prNumber,
          body: `## 🤖 AI Code Review (${llmDisplayName})\n\n✅ No significant issues found. Code looks good!`
        });
      }
      console.log(`✅ Review complete with ${llmDisplayName}!`);
    } catch (error: any) {
      console.error(`🔴 Fatal error during review for PR #${prNumber} using ${llmDisplayName}: ${error.message}`);
      await context.octokit.issues.createComment({
        owner,
        repo: repoName,
        issue_number: prNumber,
        body: `## 🤖 AI Code Review (${llmDisplayName})\n\n❌ Review failed due to internal error: \n\`\`\`\n${error.message}\n\`\`\``
      });
    }
  }

  private filterFiles(files: any[]): PRFile[] {
    const isFilteringEnabled = process.env.FILTER_LARGE_FILES === 'yes';
    const MAX_FILE_CHANGES = 800;
    const MAX_FILES = 15; 

    if (isFilteringEnabled) {
        console.log(`\nFILE FILTERING: (STRICT MODE - Max changes: ${MAX_FILE_CHANGES})`);
    } else {
        console.log(`\nFILE FILTERING: (NORMAL MODE - Max changes: ${MAX_FILE_CHANGES})`);
    }
    
    const ignorePatterns = this.configLoader.getIgnorePatterns();
    console.log(`Total files in PR: ${files.length}`);
    
    const stats: FilterStats = {
      total: files.length,
      reviewed: 0,
      ignored: 0,
      tooLarge: 0
    };
    
    const filtered = files.filter(f => {
      if (ignorePatterns.some(pattern => pattern.test(f.filename))) {
        console.log(`✗ IGNORED: ${f.filename} (matched ignore pattern)`);
        stats.ignored++;
        return false;
      }
      if (f.changes >= MAX_FILE_CHANGES) {
        console.log(`✗ TOO LARGE: ${f.filename} (${f.changes} changes, limit: ${MAX_FILE_CHANGES})`);
        stats.tooLarge++;
        return false;
      }
      console.log(`✓ INCLUDED: ${f.filename} (${f.changes} changes)`);
      return true;
    });
    
    const result = filtered.slice(0, MAX_FILES);
    stats.reviewed = result.length;
    
    if (filtered.length > MAX_FILES) {
      console.log(`WARNING: Truncated to first ${MAX_FILES} files (had ${filtered.length})`);
    }
    
    console.log(`FINAL: Reviewing ${result.length} of ${files.length} files\n`);
    this.filterStats = stats;

    return result as PRFile[];
  }

  private async generateReview(pr: any, files: PRFile[]): Promise<ReviewFinding[]> {
    const multipassEnabled = process.env.PR_REVIEW_MULTIPASS === 'true';
    const numPasses = parseInt(process.env.PR_REVIEW_PASSES || '1');
    const mergeStrategy = process.env.PR_REVIEW_MERGE_STRATEGY || 'union';
    
    if (!multipassEnabled || numPasses <= 1) {
      return this.generateSinglePassReview(pr, files);
    }
    
    console.log(`🔄 Running ${numPasses}-pass review with ${mergeStrategy} merge strategy`);
    
    const allRuns: ReviewFinding[][] = [];
    
    for (let pass = 1; pass <= numPasses; pass++) {
      console.log(`\n📦 Pass ${pass}/${numPasses}`);
      const findings = await this.generateSinglePassReview(pr, files);
      allRuns.push(findings);
      console.log(`✓ Pass ${pass} found ${findings.length} issues`);
    }
    
    const merged = this.mergeFindings(allRuns, mergeStrategy);
    console.log(`\n✅ Final: ${merged.length} unique issues after ${mergeStrategy} merge`);
    
    return merged;
  }

  private async generateSinglePassReview(pr: any, files: PRFile[]): Promise<ReviewFinding[]> {
    const BATCH_SIZE = 1; 
    const allFindings: ReviewFinding[] = [];
    
    console.log(`📦 Splitting ${files.length} files into batches of ${BATCH_SIZE}`);
    
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(files.length / BATCH_SIZE);
      
      console.log(`\n📦 Reviewing batch ${batchNum}/${totalBatches} (${batch.length} files):`);
      batch.forEach(f => console.log(`   - ${f.filename}`));
      
      const prompt = this.buildReviewPrompt(pr, batch);
      
      // Validate prompt is not empty
      if (!prompt || prompt.trim().length === 0) {
        console.error(`❌ ERROR: Empty prompt generated for batch ${batchNum}!`);
        console.error(`   This should never happen - prompt template is validated at construction.`);
        continue;
      }
      
      console.log(`📏 Batch prompt: ${prompt.length} chars`);

      try {
        const response = await this.llm.generateReview(prompt); 
        console.log(`✓ Got response (${response.length} chars)`);
        
        const findings = this.parseReviewResponse(response);
        console.log(`✓ Found ${findings.length} issue(s) in this batch`);
        
        allFindings.push(...findings);
      } catch (error) {
        console.error(`❌ Error in batch ${batchNum}:`, error);
      }
    }
    
    console.log(`\n✅ Total findings across all batches: ${allFindings.length}`);
    return allFindings;
  }

  private mergeFindings(runs: ReviewFinding[][], strategy: string): ReviewFinding[] {
    if (strategy === 'union') {
      const all = runs.flat();
      return this.deduplicateFindings(all);
    }
    
    if (strategy === 'intersection') {
      const first = runs[0];
      return first.filter(f1 => 
        runs.every(run => 
          run.some(f2 => this.isSameFinding(f1, f2))
        )
      );
    }
    
    if (strategy === 'majority') {
      const all = runs.flat();
      const threshold = Math.ceil(runs.length / 2);
      
      return this.deduplicateFindings(all).filter(finding => {
        const count = runs.filter(run => 
          run.some(f => this.isSameFinding(finding, f))
        ).length;
        return count >= threshold;
      });
    }
    
    return runs.flat();
  }

  private deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
    const seen = new Map<string, ReviewFinding>();
    
    for (const finding of findings) {
      const key = `${finding.filename}:${finding.line}:${finding.category}`;
      if (!seen.has(key)) {
        seen.set(key, finding);
      }
    }
    
    return Array.from(seen.values());
  }

  private isSameFinding(f1: ReviewFinding, f2: ReviewFinding): boolean {
    return f1.filename === f2.filename &&
           Math.abs((f1.line || 0) - (f2.line || 0)) <= 2 &&
           f1.category === f2.category;
  }

  private buildReviewPrompt(pr: any, files: PRFile[]): string {
    const fileContext = files.map(f => `
### File: ${f.filename} (${f.status})
**Changes**: +${f.additions}/-${f.deletions} lines
\`\`\`diff
${f.patch || 'No diff available'}
\`\`\`
`).join('\n---\n');

    // Use the prompt template loaded once at construction
    const prompt = this.promptTemplate
      .replace('[PR_TITLE]', pr.title || 'No title')
      .replace('[PR_BODY]', pr.body || 'No description')
      .replace('[PR_AUTHOR]', pr.user?.login || 'unknown')
      .replace('[FILE_COUNT]', files.length.toString())
      .replace('[FILE_CONTEXT]', fileContext);

    return prompt;
  }

  private parseReviewResponse(rawResponse: string): ReviewFinding[] {
    let jsonString = rawResponse.trim();
    
    // Remove markdown code fences if present
    if (jsonString.startsWith('```')) {
      const firstFenceEnd = jsonString.indexOf('\n');
      if (firstFenceEnd !== -1) {
        jsonString = jsonString.substring(firstFenceEnd).trim();
      }
    }
    if (jsonString.endsWith('```')) {
      const lastFenceStart = jsonString.lastIndexOf('```');
      if (lastFenceStart !== -1) {
        jsonString = jsonString.substring(0, lastFenceStart).trim();
      }
    }
    
    // Extract JSON array
    const start = jsonString.indexOf('[');
    const end = jsonString.lastIndexOf(']');
    
    if (start === -1 || end === -1 || start >= end) {
      console.error(`🔴 PARSE FAIL: Cannot find valid array boundaries in response.`);
      console.error(`RAW RESPONSE SNIPPET: ${jsonString.substring(0, 500)}`);
      return [];
    }
    
    const arrayContent = jsonString.substring(start, end + 1);
    
    try {
      return JSON.parse(arrayContent) as ReviewFinding[];
    } catch (error) {
      console.error('🔴 PARSE FAIL: JSON syntax error', error);
      console.error(`Failed String: ${arrayContent.substring(0, 500)}...`);
      return [];
    }
  }
}