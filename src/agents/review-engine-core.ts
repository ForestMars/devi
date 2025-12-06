// src/review-engine-core.ts

import { Context } from 'probot';
import { PRFile, ReviewFinding, PostReviewContext } from './review-engine-types';

export class ReviewEngineCore {
    private filePatches: Map<string, string>;
    private context: PostReviewContext;

    constructor(context: PostReviewContext, filesToReview: PRFile[]) {
        this.context = context;
        // This is the correct location for the .map() call
        this.filePatches = new Map<string, string>(
            filesToReview.map(f => [f.filename, f.patch || ''])
        );
    }

    private isLineInHunk(patch: string, line: number): boolean {
        const hunkRegex = /@@ -\d+,\d+ \+(\d+),(\d+) @@/g;
        let match;

        while ((match = hunkRegex.exec(patch)) !== null) {
            const startLine = parseInt(match[1], 10);
            const numLines = parseInt(match[2], 10);

            if (line >= startLine && line < startLine + numLines) {
                return true;
            }
        }
        return false;
    }

    async postReview(
        githubContext: Context,
        owner: string,
        repoName: string,
        prNumber: number,
        sha: string,
        findings: ReviewFinding[]
    ): Promise<void> {
        const modelName = this.context.modelName;
        let body = `## 🤖 AI Code Review (${this.context.llmName} (${modelName}))\n\n`;
        
        // --- Reporting Coverage Statistics ---
        if (this.context.filterStats && (this.context.filterStats.ignored > 0 || this.context.filterStats.tooLarge > 0)) {
            body += `📊 **Coverage:** Reviewed ${this.context.filterStats.reviewed} of ${this.context.filterStats.total} files`;
            const skipped = [];
            if (this.context.filterStats.ignored > 0) skipped.push(`${this.context.filterStats.ignored} config/docs`);
            if (this.context.filterStats.tooLarge > 0) skipped.push(`${this.context.filterStats.tooLarge} too large`);
            
            if (skipped.length > 0) {
                body += ` (${skipped.join(', ')})`;
            }
            
            body += `\n\n`;
        }
        
        body += `Found ${findings.length} issue${findings.length !== 1 ? 's' : ''}:\n\n`;
        const highFindings = findings.filter(f => f.severity === 'high');
        const mediumFindings = findings.filter(f => f.severity === 'medium');

        // --- High Priority Findings ---
        if (highFindings.length > 0) {
            body += `### 🔴 High Priority (${highFindings.length})\n`;
            highFindings.forEach(f => {
                body += `* [${f.category.toUpperCase()}] **${f.filename}${f.line ? `:${f.line}` : ''}**: ${f.message}\n`;
            });
            body += '\n';
        }
        
        // --- Medium Priority Findings ---
        if (mediumFindings.length > 0) {
            body += `### 🟡 Medium Priority (${mediumFindings.length})\n`;
            mediumFindings.forEach(f => {
                body += `* [${f.category.toUpperCase()}] **${f.filename}${f.line ? `:${f.line}` : ''}**: ${f.message}\n`;
            });
            body += '\n';
        }

        // --- Prepare Inline Comments ---
        const comments = findings
            .filter(f => f.line !== undefined)
            .filter(f => {
                const line = f.line!;
                const patch = this.filePatches.get(f.filename);
                
                if (!patch) {
                    console.warn(`[VALIDATION_SKIP] Patch not found for ${f.filename}. Skipping inline comment.`);
                    return false;
                }

                if (line <= 0) {
                    console.warn(`[VALIDATION_FAIL] Skipping finding for ${f.filename}:${line}. Line number is invalid.`);
                    return false;
                }

                if (!this.isLineInHunk(patch, line)) {
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

        // --- Post Review or Comment ---
        if (comments.length === 0 && findings.length > 0) {
            await githubContext.octokit.issues.createComment({
                owner,
                repo: repoName,
                issue_number: prNumber,
                body: body
            });
            return;
        } else if (comments.length === 0 && findings.length === 0) {
             return; 
        }

        await githubContext.octokit.pulls.createReview({
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