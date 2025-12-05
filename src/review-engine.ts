// src/review-engine.ts

import { Context } from 'probot';
import { LLMProvider } from './providers';
import { ConfigLoader } from './config-loader';
import * as path from 'path';
import * as fs from 'fs';

const MAX_FILE_SIZE_KB = 512;
const MAX_CHANGES_PER_FILE = 999;
const MAX_FILES_TO_REVIEW = 19;

interface PRFile {
  sha: string;
  filename: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch: string;
}

interface ReviewFinding {
  severity: 'high' | 'medium';
  category: 'security' | 'bug' | 'performance';
  filename: string;
  message: string;
  suggestion: string;
  line?: number;
}

interface FilterStats {
  total: number;
  reviewed: number;
  ignored: number;
  tooLarge: number;
}

export class ReviewEngine {
  private configLoader: ConfigLoader;
  private filterStats?: FilterStats;

  constructor(private llm: LLMProvider) {
    this.configLoader = new ConfigLoader();
  }

  /**
   * Main function to review a Pull Request.
   */
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

      if (findings.length > 0) {
        await this.postReview(context, owner, repoName, prNumber, pr.head.sha, findings);
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

  /**
   * Filters and limits the files to be reviewed.
   */
  private filterFiles(files: any[]): PRFile[] {
    const ignorePatterns = [
      /\.lock$/,
      /package-lock\.json$/,
      /yarn\.lock$/,
      /bun\.lockb$/,
      /\.min\.(js|css)$/,
      /\.map$/,
      /dist\//,
      /build\//,
      /node_modules\//,
      // Documentation files - don't send to code review
      /^README/i,
      /\.md$/,
      /\.rst$/,
      /^LICENSE/i,
      /^CHANGELOG/i
    ];

    const MAX_FILE_CHANGES = 800;
    const MAX_FILES = 15;

    console.log(`\n📊 FILE FILTERING:`);
    console.log(`   Total files in PR: ${files.length}`);

    const stats: FilterStats = {
      total: files.length,
      reviewed: 0,
      ignored: 0,
      tooLarge: 0
    };

    const filtered = files.filter(f => {
      if (ignorePatterns.some(pattern => pattern.test(f.filename))) {
        console.log(`   ✗ IGNORED: ${f.filename} (matched ignore pattern)`);
        stats.ignored++;
        return false;
      }
      
      if (f.changes >= MAX_FILE_CHANGES) {
        console.log(`   ✗ TOO LARGE: ${f.filename} (${f.changes} changes, limit: ${MAX_FILE_CHANGES})`);
        stats.tooLarge++;
        return false;
      }
      
      console.log(`   ✓ INCLUDED: ${f.filename} (${f.changes} changes)`);
      return true;
    });

    const result = filtered.slice(0, MAX_FILES);
    stats.reviewed = result.length;

    if (filtered.length > MAX_FILES) {
      console.log(`   ⚠️  WARNING: Truncated to first ${MAX_FILES} files (had ${filtered.length})`);
    }

    console.log(`\n   📋 FINAL: Reviewing ${result.length} of ${files.length} files\n`);

    this.filterStats = stats;

    return result;
  }

  /**
   * Generates the review by calling the LLM.
   */
  private async generateReview(pr: any, files: PRFile[]): Promise<ReviewFinding[]> {
    const allFiles = files.length;
    const reviewedFiles = files.slice(0, 15);
    
    if (reviewedFiles.length < allFiles) {
      console.warn(`⚠️  Only reviewing ${reviewedFiles.length} of ${allFiles} files due to limits`);
    }

    const prompt = this.buildReviewPrompt(pr, reviewedFiles);
    
    try {
      const response = await this.llm.generateReview(prompt);
      console.log(`✓ Got response from LLM (${response.length} chars)`);
      
      const findings = this.parseReviewResponse(response);
      console.log(`✓ Parsed ${findings.length} finding(s)`);
      
      return findings;
    } catch (error) {
      console.error('Error generating review:', error);
      throw error;
    }
  }

  /**
   * Builds the review prompt by injecting PR data into the template.
   */
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

  /**
   * Loads the review prompt template from a file.
   */
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

  /**
   * Parses the JSON response from the LLM.
   */
  private parseReviewResponse(response: string): ReviewFinding[] {
    let cleanResponse = response.trim();
    
    cleanResponse = cleanResponse.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '');
    cleanResponse = cleanResponse.replace(/^"|"$|^\[FILE_CONTEXT\]\s*/g, '');
    
    if (!cleanResponse.trim().startsWith('[')) {
      console.warn(`LLM response did not start with '[' after cleanup. Raw response start: "${response.substring(0, 50)}"`);
      cleanResponse = '[]';
    }

    try {
      return JSON.parse(cleanResponse);
    } catch (error) {
      console.error(`Failed to parse clean response: "${cleanResponse.substring(0, 100)}"`);
      throw error;
    }
  }

  /**
   * Posts the final review summary and line comments.
   */
  private async postReview(
    context: Context,
    owner: string,
    repoName: string,
    prNumber: number,
    sha: string,
    findings: ReviewFinding[]
  ): Promise<void> {
    
    const modelName = this.llm.getModelName();
    let body = `## 🤖 AI Code Review (${this.llm.name} (${modelName}))\n\n`;

    if (this.filterStats && (this.filterStats.ignored > 0 || this.filterStats.tooLarge > 0)) {
      body += `📊 **Coverage:** Reviewed ${this.filterStats.reviewed} of ${this.filterStats.total} files`;
      
      const skipped = [];
      if (this.filterStats.ignored > 0) skipped.push(`${this.filterStats.ignored} config/docs`);
      if (this.filterStats.tooLarge > 0) skipped.push(`${this.filterStats.tooLarge} too large`);
      
      if (skipped.length > 0) {
        body += ` (${skipped.join(', ')})`;
      }
      
      body += `\n\n`;
    }

    body += `Found ${findings.length} issue${findings.length > 1 ? 's' : ''}:\n\n`;

    const highFindings = findings.filter(f => f.severity === 'high');
    const mediumFindings = findings.filter(f => f.severity === 'medium');

    if (highFindings.length > 0) {
      body += `### 🔴 High Priority (${highFindings.length})\n`;
      highFindings.forEach((f, i) => {
        body += `* [${f.category.toUpperCase()}] **${f.filename}${f.line ? `:${f.line}` : ''}**: ${f.message}\n`;
      });
      body += '\n';
    }

    if (mediumFindings.length > 0) {
      body += `### 🟡 Medium Priority (${mediumFindings.length})\n`;
      mediumFindings.forEach((f, i) => {
        body += `* [${f.category.toUpperCase()}] **${f.filename}${f.line ? `:${f.line}` : ''}**: ${f.message}\n`;
      });
      body += '\n';
    }

    const comments = findings.map(f => ({
      path: f.filename,
      position: f.line || 1,
      body: `**[${f.severity.toUpperCase()} ${f.category.toUpperCase()}]** ${f.message}\n\n*Suggestion*: ${f.suggestion}`
    }));
    
    await context.octokit.pulls.createReview({
      owner,
      repo: repoName,
      pull_number: prNumber,
      commit_id: sha,
      body: body,
      event: highFindings.length > 0 ? 'REQUEST_CHANGES' : 'COMMENT',
      comments: comments
    });
  }
}