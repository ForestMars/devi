// src/config/config-loader.ts

import {
    LLMProvider,
    OllamaProvider,
    OpenAIProvider,
    ClaudeProvider,
    OpenRouterProvider,
} from '../providers/providers';
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
        
        if (targetModel.includes(':')) {
            const parts = targetModel.split(':');
            providerName = parts[0];
            actualModel = parts.slice(1).join(':');
        }

        return this.createProviderInstance(providerName, actualModel, maxOutputTokens);
    }
}