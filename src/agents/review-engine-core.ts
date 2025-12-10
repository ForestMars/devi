// src/review-engine-core.ts

import { Context } from 'probot';
import { PRFile, ReviewFinding, PostReviewContext } from './review-engine-types';

export class ReviewEngineCore {
    private filePatches: Map<string, string>;
    private context: PostReviewContext;

    constructor(context: PostReviewContext, filesToReview: PRFile[]) {
        this.context = context;
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

    private getPositionInDiff(patch: string, targetLine: number): number | null {
        const lines = patch.split('\n');
        let currentLine = 0;
        let position = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            position++;
            
            // Parse hunk header: @@ -10,5 +12,7 @@
            if (line.startsWith('@@')) {
                const match = line.match(/@@ -\d+,\d+ \+(\d+)/);
                if (match) {
                    currentLine = parseInt(match[1], 10) - 1; // Start from line before
                }
                continue;
            }
            
            // Track line numbers for additions and context
            if (line.startsWith('+') || line.startsWith(' ')) {
                currentLine++;
                if (currentLine === targetLine) {
                    return position;
                }
            }
            // Deletions don't increment the "new" line counter
        }
        
        return null;
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
        const lowFindings = findings.filter(f => f.severity === 'low');
        const otherFindings = findings.filter(f => !f.severity || (f.severity !== 'high' && f.severity !== 'medium' && f.severity !== 'low'));

        console.log(`\n📊 Building review body with:`);
        console.log(`  - High: ${highFindings.length}`);
        console.log(`  - Medium: ${mediumFindings.length}`);
        console.log(`  - Low: ${lowFindings.length}`);
        console.log(`  - Other/Unspecified: ${otherFindings.length}`);

        // --- High Priority Findings ---
        if (highFindings.length > 0) {
            body += `### 🔴 High Priority (${highFindings.length})\n`;
            highFindings.forEach(f => {
                body += `* **[${f.category.toUpperCase()}]** \`${f.filename}${f.line ? `:${f.line}` : ''}\`\n`;
                body += `  ${f.message}\n`;
                if (f.suggestion) {
                    body += `  💡 *${f.suggestion}*\n`;
                }
                body += '\n';
            });
        }
        
        // --- Medium Priority Findings ---
        if (mediumFindings.length > 0) {
            body += `### 🟡 Medium Priority (${mediumFindings.length})\n`;
            mediumFindings.forEach(f => {
                body += `* **[${f.category.toUpperCase()}]** \`${f.filename}${f.line ? `:${f.line}` : ''}\`\n`;
                body += `  ${f.message}\n`;
                if (f.suggestion) {
                    body += `  💡 *${f.suggestion}*\n`;
                }
                body += '\n';
            });
        }

        // --- Low Priority Findings ---
        if (lowFindings.length > 0) {
            body += `### 🔵 Low Priority (${lowFindings.length})\n`;
            lowFindings.forEach(f => {
                body += `* **[${f.category.toUpperCase()}]** \`${f.filename}${f.line ? `:${f.line}` : ''}\`\n`;
                body += `  ${f.message}\n`;
                if (f.suggestion) {
                    body += `  💡 *${f.suggestion}*\n`;
                }
                body += '\n';
            });
        }

        // --- Other Findings (without severity or unrecognized severity) ---
        if (otherFindings.length > 0) {
            body += `### 📝 Other Issues (${otherFindings.length})\n`;
            otherFindings.forEach(f => {
                body += `* **[${f.category.toUpperCase()}]** \`${f.filename}${f.line ? `:${f.line}` : ''}\`\n`;
                body += `  ${f.message}\n`;
                if (f.suggestion) {
                    body += `  💡 *${f.suggestion}*\n`;
                }
                body += '\n';
            });
        }

        console.log(`\n📝 Review body length: ${body.length} chars`);

        // --- Prepare Inline Comments ---
        const comments = findings
            .filter(f => f.line !== undefined)
            .map(f => {
                const line = f.line!;
                const patch = this.filePatches.get(f.filename);
                
                if (!patch) {
                    console.warn(`[VALIDATION_SKIP] Patch not found for ${f.filename}. Skipping inline comment.`);
                    return null;
                }

                if (line <= 0) {
                    console.warn(`[VALIDATION_FAIL] Skipping finding for ${f.filename}:${line}. Line number is invalid.`);
                    return null;
                }

                const position = this.getPositionInDiff(patch, line);
                if (position === null) {
                    console.warn(`[VALIDATION_FAIL] Skipping finding for ${f.filename}:${line}. Cannot calculate position in diff.`);
                    return null;
                }
                
                console.log(`[VALIDATION_SUCCESS] Posting comment on ${f.filename}:${line} (position ${position}).`);
                
                return {
                    path: f.filename,
                    position: position,  // Changed from 'line' to 'position'
                    body: `**[${f.severity?.toUpperCase() || 'ISSUE'} - ${f.category.toUpperCase()}]** ${f.message}\n\n💡 *Suggestion*: ${f.suggestion || 'Review and address this issue.'}`
                };
            })
            .filter((c): c is NonNullable<typeof c> => c !== null);

        console.log(`\n💬 Inline comments to post: ${comments.length}`);

        // --- Post Review or Comment ---
        if (comments.length === 0 && findings.length > 0) {
            console.log('📤 Posting as issue comment (no valid inline comments)');
            await githubContext.octokit.issues.createComment({
                owner,
                repo: repoName,
                issue_number: prNumber,
                body: body
            });
            return;
        } else if (comments.length === 0 && findings.length === 0) {
            console.log('✓ No findings to post');
            return; 
        }

        console.log('📤 Posting as PR review with inline comments');
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