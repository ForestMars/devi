// scripts/test-review.ts
// Run this to test the improved prompt on a specific PR

import { Octokit } from "@octokit/rest";
import { ReviewEngine } from "./agents/review-engine.js";
import { OllamaProvider } from "../src/providers";

async function testReview() {
  // Configuration
  const OWNER = "ForestMars";
  const REPO = "devi";
  const PR_NUMBER = 16;
  
  const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  if (!GITHUB_TOKEN) {
    console.error("❌ GITHUB_TOKEN environment variable required");
    console.error("   Get one at: https://github.com/settings/tokens");
    process.exit(1);
  }

  console.log("🧪 Test Review Script");
  console.log("=".repeat(50));
  console.log(`Repository: ${OWNER}/${REPO}`);
  console.log(`PR Number: ${PR_NUMBER}`);
  console.log(`LLM: ${OLLAMA_HOST} / ${OLLAMA_MODEL}`);
  console.log("=".repeat(50));
  console.log("");

  // Initialize
  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const llmProvider = new OllamaProvider(OLLAMA_HOST, OLLAMA_MODEL);
  const reviewEngine = new ReviewEngine(llmProvider);

  try {
    // Fetch PR data
    console.log("📡 Fetching PR data...");
    const { data: pr } = await octokit.pulls.get({
      owner: OWNER,
      repo: REPO,
      pull_number: PR_NUMBER
    });
    console.log(`✓ PR: "${pr.title}"`);
    console.log(`  Author: ${pr.user?.login}`);
    console.log(`  Branch: ${pr.head.ref} → ${pr.base.ref}`);
    console.log("");

    // Fetch files
    console.log("📂 Fetching changed files...");
    const { data: files } = await octokit.pulls.listFiles({
      owner: OWNER,
      repo: REPO,
      pull_number: PR_NUMBER,
      per_page: 100
    });
    
    console.log(`✓ Found ${files.length} changed files:`);
    files.forEach((f: PRFile) => {
      console.log(`  - ${f.filename} (+${f.additions}/-${f.deletions}, ${f.changes} total)`);
    });
    console.log("");

    // Filter files (this will show what gets filtered)
    console.log("🔍 Filtering files...");
    const filtered = (reviewEngine as any).filterFiles(files);
    console.log("");

    if (filtered.length === 0) {
      console.log("⚠️  No files to review after filtering!");
      return;
    }

    // Build prompt
    console.log("📝 Building prompt...");
    const prompt = (reviewEngine as any).buildReviewPrompt(pr, filtered);
    
    console.log(`✓ Prompt built (${prompt.length} characters)`);
    console.log("");
    
    // Optional: Save prompt to file for inspection
    if (process.env.SAVE_PROMPT === "true") {
      const fs = require('fs');
      fs.writeFileSync('test-prompt.txt', prompt);
      console.log("💾 Saved prompt to test-prompt.txt");
      console.log("");
    }

    // Generate review
    console.log("🧠 Sending to LLM...");
    console.log("   (This may take 30-60 seconds)");
    console.log("");
    
    const response = await llmProvider.generateReview(prompt);
    
    console.log("✓ Got response from LLM");
    console.log(`  Length: ${response.length} characters`);
    console.log("");
    
    // Save raw response
    if (process.env.SAVE_RESPONSE === "true") {
      const fs = require('fs');
      fs.writeFileSync('test-response.txt', response);
      console.log("💾 Saved response to test-response.txt");
      console.log("");
    }

    // Parse response
    console.log("🔍 Parsing response...");
    const findings = (reviewEngine as any).parseReviewResponse(response);
    
    console.log("=".repeat(50));
    console.log(`📊 RESULTS: Found ${findings.length} issues`);
    console.log("=".repeat(50));
    console.log("");

    if (findings.length === 0) {
      console.log("✅ No issues found!");
      console.log("");
      console.log("⚠️  This might mean:");
      console.log("   1. Code is actually perfect (unlikely)");
      console.log("   2. Model didn't understand the prompt");
      console.log("   3. Model output wasn't parseable");
      console.log("");
      console.log("💡 Try:");
      console.log("   - Set SAVE_RESPONSE=true to inspect raw output");
      console.log("   - Use a larger model (qwen2.5-coder:14b or 32b)");
      console.log("   - Switch to Claude API for better results");
    } else {
      findings.forEach((finding: ReviewFinding, i: number) => {
        console.log(`${i + 1}. [${finding.severity.toUpperCase()}] ${finding.filename}`);
        if (finding.line) console.log(`   Line ${finding.line}`);
        console.log(`   Category: ${finding.category}`);
        console.log(`   Issue: ${finding.message}`);
        console.log(`   Fix: ${finding.suggestion}`);
        console.log("");
      });

      // Summary by severity
      const high = findings.filter((f: ReviewFinding) => f.severity === 'high').length;
      const medium = findings.filter((f: ReviewFinding) => f.severity === 'medium').length;
      
      console.log("📈 Summary:");
      console.log(`   🔴 High: ${high}`);
      console.log(`   🟡 Medium: ${medium}`);
    }

    console.log("");
    console.log("✅ Test complete!");

  } catch (error: any) {
    console.error("");
    console.error("❌ Error during test:", error.message);
    console.error("");
    console.error("Full error:", error);
    process.exit(1);
  }
}

// Run the test
testReview().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
