// src/review-engine.ts (Modified and Corrected Wrapper)

import { Context } from 'probot';
import { LLMProvider } from './providers';
import { ConfigLoader } from './config-loader';
import { ReviewEngineCore } from './review-engine-core';
import { PRFile, ReviewFinding, FilterStats, PostReviewContext } from './review-engine-types';
import * as path from 'path';
import * as fs from 'fs';

export class ReviewEngine { // FIX: Export is here
  private configLoader: ConfigLoader;
  private filterStats?: FilterStats;

  // FIX: This constructor is simple and does NOT contain the .map() logic,
  // preventing the TypeError when the main app calls `new ReviewEngine()`.
  constructor(private llm: LLMProvider) {
    this.configLoader = new ConfigLoader();
  }

  async reviewPR(context: Context, pr: any, repo: any): Promise<void> {
    const owner = repo.owner.login;
    const repoName = repo.name;
    const prNumber = pr.number;
    const initialModelName = this.llm.getModelName();
    
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
      
      console.log(`[DEBUG_TRACE] 1. Initial LLM model: ${this.llm.getModelName()}`);

      const findings = await this.generateReview(pr, filesToReview);
      
      console.log(`[DEBUG_TRACE] 2. LLM model after generation: ${this.llm.getModelName()}`);
      console.log(`✓ Parsed ${findings.length} finding(s)`);

      const coreContext: PostReviewContext = {
          llmName: this.llm.name,
          modelName: this.llm.getModelName(),
          filterStats: this.filterStats
      };
      
      // The ReviewEngineCore is instantiated *after* filesToReview has been filtered
      // and is correctly passed the necessary arguments.
      const core = new ReviewEngineCore(coreContext, filesToReview);
      
      if (findings.length > 0) {
        await core.postReview(context, owner, repoName, prNumber, pr.head.sha, findings);
      } else {
        console.log('✓ No issues found');
        const modelName = this.llm.getModelName();
        await context.octokit.issues.createComment({
          owner,
          repo: repoName,
          issue_number: prNumber,
          body: `## 🤖 AI Code Review (${this.llm.name} (${modelName}))\n\n✅ No significant issues found. Code looks good!`
        });
      }
      console.log('✅ Review complete!');
    } catch (error: any) {
      console.error(`🔴 Fatal error during review for PR #${prNumber}: ${error.message}`);
      await context.octokit.issues.createComment({
        owner,
        repo: repoName,
        issue_number: prNumber,
        body: `## 🤖 AI Code Review (${this.llm.name} (${initialModelName}))\n\n❌ Review failed due to internal error: \n\`\`\`\n${error.message}\n\`\`\``
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

    console.log(`\nFILE FILTERING:`);
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
      console.log(`📏 Batch prompt: ${prompt.length} chars`);
      try {
        const response = await this.llm.generateReview(prompt); 
        
        console.log(`✓ Got response (${response.length} chars)`);
        console.log(`[DEBUG_RAW_OUTPUT] Response Snippet (500 chars): ${response.substring(0, 500).trim()}`);
        
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

  private buildReviewPrompt(pr: any, files: PRFile[]): string {
    const template = this.loadPromptTemplate();
    
    const fileContext = files.map(f => `
### File: ${f.filename} (${f.status})
**Changes**: +${f.additions}/-${f.deletions} lines
\`\`\`diff
${f.patch || 'No diff available'}
\`\`\`
`).join('\n---\n');
    return template
      .replace('[PR_TITLE]', pr.title || 'No title')
      .replace('[PR_BODY]', pr.body || 'No description')
      .replace('[PR_AUTHOR]', pr.user?.login || 'unknown')
      .replace('[FILE_COUNT]', files.length.toString())
      .replace('[FILE_CONTEXT]', fileContext);
  }

  private loadPromptTemplate(): string {
    const agentContext = this.configLoader.getAgent('pr-review')?.context;
    if (agentContext) {
        return agentContext;
    }

    const promptPath = path.resolve(process.cwd(), 'src/prompts/pr-review.md');
    try {
      return fs.readFileSync(promptPath, 'utf8');
    } catch (e: any) {
      console.warn(`Could not load prompt template from ${promptPath}: ${e.message}`);
      return `# PR Review Instructions\nFocus on the following areas:\n1. Security\n2. Bugs\n3. Performance\n\nReturn ONLY a JSON array.\n[FILE_CONTEXT]`;
    }
  }

  private parseReviewResponse(rawResponse: string): ReviewFinding[] {
    let jsonString = rawResponse.trim();
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
    const start = jsonString.indexOf('[');
    const end = jsonString.lastIndexOf(']');
    if (start === -1 || end === -1 || start >= end) {
      console.error(`🔴 PARSE FAIL: Cannot find valid array boundaries in response.`);
      console.error(`RAW RESPONSE SNIPPET: ${jsonString.substring(0, 500)}`);
      return [];
    }
    const arrayContent = jsonString.substring(start, end + 1);
    console.log(`[DEBUG_PARSE_B] Guardrail Array Content: ${arrayContent.substring(0, 100)}...`);
    try {
      return JSON.parse(arrayContent) as ReviewFinding[];
    } catch (error) {
      console.error('🔴 PARSE FAIL: JSON syntax error after guardrail applied.', error);
      console.error(`[DEBUG_PARSE_C] Failed String: ${arrayContent.substring(0, 500)}...`);
      return [];
    }
  }
}