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
        await this.postReview(context, owner, repoName, prNumber, pr.head.sha, findings, filesToReview);
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
      /\.gitignore$/,
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

// ANSI Color Codes
    const COLOR_RESET = '\x1b[0m';
    const COLOR_RED = '\x1b[31m';
    const COLOR_GREEN = '\x1b[32m';
    const COLOR_YELLOW = '\x1b[33m'; // Used for warnings

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
        // Log IGNORED in RED
        console.log(`   ✗ ${COLOR_RED}IGNORED${COLOR_RESET}: ${f.filename} (matched ignore pattern)`);
        stats.ignored++;
        return false;
      }
      
      if (f.changes >= MAX_FILE_CHANGES) {
        // Log TOO LARGE in RED
        console.log(`   ✗ ${COLOR_RED}TOO LARGE${COLOR_RESET}: ${f.filename} (${f.changes} changes, limit: ${MAX_FILE_CHANGES})`);
        stats.tooLarge++;
        return false;
      }
      
      // Log INCLUDED in GREEN
      console.log(`   ✓ ${COLOR_GREEN}INCLUDED${COLOR_RESET}: ${f.filename} (${f.changes} changes)`);
      return true;
    });

    const result = filtered.slice(0, MAX_FILES);
    stats.reviewed = result.length;

    if (filtered.length > MAX_FILES) {
      // Log truncation warning in YELLOW
      console.log(`${COLOR_YELLOW}   ⚠️  WARNING: Truncated to first ${MAX_FILES} files (had ${filtered.length})${COLOR_RESET}`);
    }

    console.log(`\n   📋 FINAL: Reviewing ${result.length} of ${files.length} files\n`);

    this.filterStats = stats;

    return result;
  }

  /**
   * Generates the review by calling the LLM.
   */

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
        // --- CRITICAL FIX: Pass a configuration object with a high max_tokens value. ---
        // This forces the LLM to allocate enough budget to write out a large JSON array (10-15 findings).
        const response = await this.llm.generateReview(prompt, { max_tokens: 3000 });
        // -------------------------------------------------------------------------------
        console.log(`✓ Got response (${response.length} chars)`);
        
        const findings = this.parseReviewResponse(response);
        console.log(`✓ Found ${findings.length} issue(s) in this batch`);
        
        allFindings.push(...findings);
      } catch (error) {
        console.error(`❌ Error in batch ${batchNum}:`, error);
        // Continue with next batch instead of failing entirely
      }
    }
    
    console.log(`\n✅ Total findings across all batches: ${allFindings.length}`);
    return allFindings;
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
    
    // 1. Initial cleanup: remove common markdown fences
    cleanResponse = cleanResponse.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '');

    // 2. Find the JSON array boundaries (The Ultimate Guardrail)
    const firstBracket = cleanResponse.indexOf('[');
    const lastBracket = cleanResponse.lastIndexOf(']');

    if (firstBracket === -1 || lastBracket === -1 || lastBracket < firstBracket) {
        // This proves the LLM failed to output a recognizable JSON array.
        console.error(`🔴 PARSE FAIL: Cannot find valid array boundaries in response.`);
        console.error(`   RAW RESPONSE SNIPPET: "${response.trim().substring(0, 200)}"`);
        return []; 
    }
    
    // 3. Extract ONLY the content between the first [ and last ]
    let jsonContent = cleanResponse.substring(firstBracket, lastBracket + 1); 

    // --- DEBUG LOG B: Check if the Guardrail isolated the array correctly ---
    console.log(`[DEBUG_PARSE_B] Guardrail Array Content: "${jsonContent.substring(0, 100)}"`);
    // ------------------------------------------------------------------------

    // 4. Clean up potential trailing commas (common LLM error)
    try {
        if (jsonContent.endsWith(',]')) {
             jsonContent = jsonContent.slice(0, -2) + ']';
        }
    } catch (e) {
        // Ignore this if it fails
    }

    try {
      const findings = JSON.parse(jsonContent);
      
      // 5. Final validation: Ensure the parsed result is actually an array
      if (Array.isArray(findings)) {
          return findings;
      }
      
      console.error(`🔴 PARSE FAIL: JSON was valid but did not result in an array.`);
      return [];
      
    } catch (error: any) {
      // --- DEBUG LOG C: Log the exact string that failed JSON.parse() ---
      console.error(`❌ FAILED TO PARSE JSON. Error: ${error.message}`);
      console.error(`[DEBUG_PARSE_C] Failed String: "${jsonContent.substring(0, 100)}"`);
      // --------------------------------------------------------------------
      return []; 
    }
  }

  /**
   * Posts the final review summary and line comments.
   */
  // src/review-engine.ts (Replacing postReview method)

  /**
   * Posts the final review summary and line comments.
   */
  /**
   * Posts the final review summary and line comments.
   */
  private async postReview(
    context: Context,
    owner: string,
    repoName: string,
    prNumber: number,
    sha: string,
    findings: ReviewFinding[],
    filesToReview: PRFile[]
  ): Promise<void> {

    const filePatches = new Map<string, string>(
        filesToReview.map(f => [f.filename, f.patch || ''])
    );
    
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

    // --- CRITICAL VALIDATION AND FILTERING ---
    const comments = findings
      .filter(f => f.line !== undefined) // 1. Must have a line number
      .filter(f => {
        const line = f.line!;
        const patch = filePatches.get(f.filename);
        
        if (!patch) {
            console.warn(`[VALIDATION_SKIP] Patch not found for ${f.filename}. Skipping inline comment.`);
            return false;
        }

        // 2. Strict Check: Ensure line number is > 0
        if (line <= 0) {
            console.warn(`[VALIDATION_FAIL] Skipping finding for ${f.filename}:${line}. Line number is invalid.`);
            return false;
        }

        // 3. Containment Check: Search for the line number in the diff hunk ranges.
        // This validates if the line number falls within any added/modified hunk range in the patch.
        // The regex captures the starting line number and the number of lines added (+100,5 -> [1]=100, [2]=5)
        const hunkRegex = /@@ -\d+,\d+ \+(\d+),(\d+) @@/g;
        let match;
        let isValidHunkLine = false;

        while ((match = hunkRegex.exec(patch)) !== null) {
            const startLine = parseInt(match[1], 10);
            const numLines = parseInt(match[2], 10);
            
            // Check if the finding line is between the hunk start line and (start + number of lines - 1)
            if (line >= startLine && line < startLine + numLines) {
                isValidHunkLine = true;
                break;
            }
        }

        if (!isValidHunkLine) {
            console.warn(`[VALIDATION_FAIL] Skipping finding for ${f.filename}:${line}. Line not found in patch hunk range.`);
            return false;
        }
        
        console.log(`[VALIDATION_SUCCESS] Posting comment on ${f.filename}:${line}.`);
        return true; 
      })
      .map(f => ({
        path: f.filename,
        line: f.line,  
        side: 'RIGHT' as const,
        body: `**[${f.severity.toUpperCase()} ${f.category.toUpperCase()}]** ${f.message}\n\n*Suggestion*: ${f.suggestion}`
      }));
    // ------------------------------------------

    // If no valid inline comments, just post summary
    if (comments.length === 0) {
      await context.octokit.issues.createComment({
        owner,
        repo: repoName,
        issue_number: prNumber,
        body: body
      });
      return;
    }
    
    // Post the review with the filtered, valid comments
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