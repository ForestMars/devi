// src/index.ts

import { Probot } from 'probot';
import { ConfigLoader } from './config/config-loader';
import { ReviewEngine } from './agents/review-engine';

// --- Global Startup Logic (Executes Once) ---

const CONFIG_PATH = process.env.CONFIG_PATH;

if (!CONFIG_PATH) {
    console.error("🔴 Fatal Error: CONFIG_PATH environment variable is not set. Cannot start.");
    process.exit(1); 
}

let configLoader: ConfigLoader;

try {
  // Config is loaded in the constructor
  configLoader = new ConfigLoader(CONFIG_PATH);
  
  // Access the config via the getter
  const config = configLoader.config;
  
  // Get the configured provider info for logging
  const logProvider = config.llm.default_provider;
  const logModel = config.llm.default_model;
  
  console.log(`🤖 PR Review Agent initialized. Configured Model: **${logProvider} (${logModel})**`);
  
} catch (e: any) {
  console.error(`🔴 Fatal Error: Could not load configuration: ${e.message}`);
  process.exit(1);
}

// --- Probot Application Handler (Executes on Events) ---

export default (app: Probot) => {
    app.on(["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"], async (context) => {
        const pr = context.payload.pull_request;
        const repo = context.payload.repository;

        console.log("\n========================================");
        console.log(`📝 PR Event: ${context.payload.action}`);
        console.log(`Repository: ${repo.owner.login}/${repo.name}`);
        console.log(`PR #${pr.number}: ${pr.title}`);
        console.log("========================================\n");

        try {
            // Get the LLM provider from the config
            const llmProvider = configLoader.getLLMProvider(); 
            
            // Override maxOutputTokens if needed
            llmProvider.maxOutputTokens = 9999;
            
            const reviewEngine = new ReviewEngine(llmProvider, configLoader); 
            
            await reviewEngine.reviewPR(context, pr, repo);
            
        } catch (error: any) {
            console.error("❌ Error reviewing PR (See full trace below):", error.message);
            console.error(error); 

            await context.octokit.issues.createComment({
                owner: repo.owner.login,
                repo: repo.name,
                issue_number: pr.number,
                body: `🤖 **AI Code Review Error**\n\n⚠️ Failed to review PR: **${error.message.substring(0, 500)}**\n\nI encountered an internal error. Please check the application logs for details.`
            });
        }
    });
};