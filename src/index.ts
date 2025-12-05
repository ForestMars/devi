// src/index.ts

import { Probot } from 'probot';
import { ConfigLoader } from './config-loader';
import { ReviewEngine } from './review-engine';

const x = undefined.y;

export default (app: Probot) => {
  // 1. Instantiate ConfigLoader once at the start
  const configLoader = new ConfigLoader();

  try {
    const config = configLoader.load(); // Load config synchronously at startup
    
    // Get the model name the agent will use from the configuration
    const agentConfig = config.agents['pr-review'];
    
    let modelToLog: string;
    let providerToLog: string;

    if (agentConfig && agentConfig.model.includes(':')) {
      // If model is defined as 'provider:model'
      const parts = agentConfig.model.split(':');
      providerToLog = parts[0];
      modelToLog = parts.slice(1).join(':'); // Handle model names with colons
    } else {
      // Use the defaults if not explicitly set with provider prefix
      providerToLog = config.llm.default_provider;
      modelToLog = agentConfig?.model || config.llm.default_model;
    }
    
    // Display the successfully loaded configuration model name
    console.log(`🤖 PR Review Agent initialized. Configured Model: **${providerToLog} (${modelToLog})**`);
    
  } catch (e: any) {
    console.error(`🔴 Fatal Error: Could not load configuration: ${e.message}`);
    // If config fails to load, the app is non-functional, so we return early.
    return;
  }
  
  // --- The app.on handler: Where the work happens ---
  app.on(["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"], async (context) => {
    const pr = context.payload.pull_request;
    const repo = context.payload.repository;

    console.log("\n========================================");
    console.log(`📝 PR Event: ${context.payload.action}`);
    console.log(`Repository: ${repo.owner.login}/${repo.name}`);
    console.log(`PR #${pr.number}: ${pr.title}`);
    console.log(`Author: ${pr.user.login}`);
    console.log("========================================\n");

    try {
      // 2. Create LLM Provider
      const llmProvider = configLoader.createProvider('pr-review');
      llmProvider.maxOutputTokens = 9999;
      
      // 3. FIX: Instantiate ReviewEngine, passing the ConfigLoader instance.
      // NOTE: ReviewEngine constructor must now accept (llmProvider, configLoader)
      const reviewEngine = new ReviewEngine(llmProvider, configLoader); 
      
      await reviewEngine.reviewPR(context, pr, repo);
      
    } catch (error: any) {
      // 4. CRITICAL: Comprehensive error handling to stop silent failure
      console.error("❌ Error reviewing PR (See full trace below):", error.message);
      console.error(error); // Log the full stack trace

      // Post failure comment to the PR
      await context.octokit.issues.createComment({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: pr.number,
        body: `🤖 **AI Code Review Error**\n\n⚠️ Failed to review PR: **${error.message.substring(0, 500)}**\n\nI encountered an internal error. Please check the application logs for details.`
      });
    }
  });
};