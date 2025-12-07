// src/config/config-loader.ts

import * as path from 'node:path';
import {
    LLMProvider,
    OllamaProvider,
    OpenAIProvider,
    ClaudeProvider,
    OpenRouterProvider,
} from '../providers/index';
import yaml from 'js-yaml';
import * as fs from 'node:fs';

interface ProviderDetails {
    host?: string;
    api_key_env?: string;
    base_url?: string;
    models: string[];
}

interface LLMConfig {
    default_provider: string;
    default_model: string;
    providers: Record<string, ProviderDetails>;
}

interface AppConfig {
    llm: LLMConfig;
    [key: string]: any; 
}

type ProviderConstructor = new (
    host: string,
    model: string,
    maxOutputTokens: number,
    apiKey?: string
) => LLMProvider;

const ProviderMap: Record<string, ProviderConstructor> = {
    'ollama': OllamaProvider,
    'openai': OpenAIProvider,
    'claude': ClaudeProvider,
    'anthropic': ClaudeProvider,
    'openrouter': OpenRouterProvider,
};

export class ConfigLoader {
    private _config: AppConfig;

    public get config(): AppConfig {
        return this._config;
    }

    constructor(configPath: string) {
        this._config = this.loadConfig(configPath);
    }

    private loadConfig(configPath: string): AppConfig {
        const fileContents = fs.readFileSync(configPath, 'utf8');
        const loadedConfig = yaml.load(fileContents) as AppConfig;

        if (
            !loadedConfig || 
            typeof loadedConfig.llm !== 'object' || 
            typeof loadedConfig.llm.providers !== 'object' ||
            Array.isArray(loadedConfig.llm.providers)
        ) {
            throw new Error(`Invalid configuration structure loaded from ${configPath}. Expected 'llm.providers' to be an object, not an array.`);
        }

        return loadedConfig;
    }

    private createProviderInstance(
        providerName: string, 
        model: string, 
        maxOutputTokens: number = 4096
    ): LLMProvider {
        const providerDetails = this._config.llm.providers[providerName];
        
        if (!providerDetails) {
            throw new Error(`Provider '${providerName}' not found in configuration.`);
        }

        const ProviderClass = ProviderMap[providerName.toLowerCase()];

        if (!ProviderClass) {
            throw new Error(`Unknown LLM provider: ${providerName}`);
        }

        const apiKey = providerDetails.api_key_env 
            ? process.env[providerDetails.api_key_env]
            : undefined;

        const host = providerDetails.host || providerDetails.base_url || '';

        return new ProviderClass(
            host,
            model,
            maxOutputTokens,
            apiKey
        );
    }

    public getLLMProvider(model?: string, maxOutputTokens: number = 4096): LLMProvider {
        const llmConfig = this._config.llm;
        const targetModel = model || llmConfig.default_model;
        
        let providerName = llmConfig.default_provider;
        let actualModel = targetModel;
        
        // Only parse provider from model string if it explicitly starts with "provider:"
        // Check if the model string starts with a known provider name
        const knownProviders = Object.keys(llmConfig.providers);
        for (const provider of knownProviders) {
            if (targetModel.startsWith(`${provider}:`)) {
                providerName = provider;
                actualModel = targetModel.substring(provider.length + 1);
                break;
            }
        }

        return this.createProviderInstance(providerName, actualModel, maxOutputTokens);
    }

    // Add to ConfigLoader class in config-loader.ts

    public getAgent(agentName: string) {
        return this._config.agents?.[agentName];
    }

    public getAgentContext(agentName: string): string {
        const agent = this.getAgent(agentName);
        return agent?.context || '';
    }

    public getPromptFilePath(agentName: string): string {
        const envVarName = `${agentName.toUpperCase().replace('-', '_')}_PROMPT`;
        const envPath = process.env[envVarName];
        console.log(`📣`, envPath);
        
    
        if (envPath) {
            return path.join(process.cwd(), envPath);
        }
    
        // Fall back to default location
        console.log(`Prompt not loaded from ENV, falling back to default prompt`) // Should be WARN? 
        return path.join(process.cwd(), 'config', 'prompts', `${agentName}.md`);
}

    public getIgnorePatterns(): RegExp[] {
    const filePath = path.join(process.cwd(), 'config', 'ignore-files.txt');
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        const patterns = content
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#'))
            .map(pattern => new RegExp(pattern));
            
        console.log(`✅ Loaded ${patterns.length} file ignore patterns from ${filePath}`);
    
        return patterns;
    } catch (e: any) {
        console.warn(`Could not load ignore patterns from ${filePath}: ${e.message}. Using defaults.`);
        
        return [
            /package-lock\.json$/,
            /yarn\.lock$/,
            /pnpm-lock\.yaml$/,
            /.*\.min\.js$/,
            /.*\.map$/,
        ];
        }
    }
}