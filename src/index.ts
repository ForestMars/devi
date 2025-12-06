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
  console.log(`📂 Loading config from: ${CONFIG_PATH}`);
  configLoader = new ConfigLoader(CONFIG_PATH);
  
  const config = configLoader.config;
  
  const logProvider = config.llm.default_provider;
  const logModel = config.llm.default_model;
  
  console.log(`🤖 PR Review Agent initialized. Configured Model: **${logProvider} (${logModel})**`);
  console.log(`✅ ConfigLoader successfully initialized`);
  
} catch (e: any) {
  console.error(`🔴 Fatal Error: Could not load configuration: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
}

// --- Probot Application Handler (Executes on Events) ---

export default (app: Probot) => {
    console.log(`🎯 Probot app handler registered`);
    console.log(`🔔 Listening for: pull_request.opened, pull_request.reopened, pull_request.synchronize`);
    
    app.on(["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"], async (context) => {
        console.log(`\n🚨 WEBHOOK RECEIVED - Event handler triggered!`);
        
        const pr = context.payload.pull_request;
        const repo = context.payload.repository;

        console.log("\n========================================");
        console.log(`📝 PR Event: ${context.payload.action}`);
        console.log(`Repository: ${repo.owner.login}/${repo.name}`);
        console.log(`PR #${pr.number}: ${pr.title}`);
        console.log("========================================\n");

        try {
            console.log(`🔧 Getting LLM provider...`);
            const llmProvider = configLoader.getLLMProvider(); 
            console.log(`✅ LLM provider created: ${llmProvider.constructor.name}`);
            
            llmProvider.maxOutputTokens = 9999;
            
            console.log(`🔧 Creating ReviewEngine...`);
            const reviewEngine = new ReviewEngine(llmProvider, configLoader); 
            console.log(`✅ ReviewEngine created`);
            
            console.log(`🚀 Starting PR review...`);
            await reviewEngine.reviewPR(context, pr, repo);
            console.log(`✅ PR review completed`);
            
        } catch (error: any) {
            console.error("❌ Error reviewing PR (See full trace below):", error.message);
            console.error(error.stack); 

            await context.octokit.issues.createComment({
                owner: repo.owner.login,
                repo: repo.name,
                issue_number: pr.number,
                body: `🤖 **AI Code Review Error**\n\n⚠️ Failed to review PR: **${error.message.substring(0, 500)}**\n\nI encountered an internal error. Please check the application logs for details.`
            });
        }
    });
    
    // Add a catch-all to see if webhook is even reaching the app
    app.onAny(async (context) => {
        console.log(`📨 Received webhook: ${context.name}.${context.payload.action || 'no-action'}`);
    });
};