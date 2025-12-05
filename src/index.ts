// src/index.ts or src/app.ts

import { Probot } from 'probot';
import { ConfigLoader } from './config-loader';
import { ReviewEngine } from './review-engine';

export default (app: Probot) => {
  const configLoader = new ConfigLoader();

  try {
    const config = configLoader.load(); // Load config synchronously at startup
    
    // 1. Get the model name the agent will use from the configuration
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
    
    // 2. Display the successfully loaded configuration model name
    // This logs during the "bun start" phase (Server.load)
    console.log(`🤖 PR Review Agent initialized. Configured Model: **${providerToLog} (${modelToLog})**`);
    
  } catch (e: any) {
    console.error(`🔴 Fatal Error: Could not load configuration: ${e.message}`);
    return;
  }
  
  // --- The app.on handler remains as it was in the last correct version: ---
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
      // Note: llmProvider is created and defined *here* (inside this scope)
      const llmProvider = configLoader.createProvider('pr-review');
      const reviewEngine = new ReviewEngine(llmProvider);
      
      // Optional: You can keep this log for confirmation on every PR event, 
      // but the main startup log is now handled above.
      // console.log(`[EVENT_CONFIRM] Model used for this PR: ${llmProvider.getModelName()}`); 
      
      await reviewEngine.reviewPR(context, pr, repo);
      
    } catch (error: any) {
      console.error("❌ Error reviewing PR:", error);
      
      await context.octokit.issues.createComment({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: pr.number,
        body: `🤖 **AI Code Review Error**\n\n⚠️ Failed to review PR: ${error.message}\n\nPlease check the logs.`
      });
    }
  });
};