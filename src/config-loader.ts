// src/config-loader.ts
import * as fs from 'fs';
import * as yaml from 'yaml';
import { LLMProvider, OllamaProvider, AnthropicProvider, OpenAIProvider, OpenRouterProvider, GeminiProvider } from './providers';

export interface AgentConfig {
  version: string;
  llm: LLMConfig;
  agents: Record<string, Agent>;
  validation_rules?: Record<string, any>;
  labels?: Record<string, string[]>;
  settings?: Record<string, any>;
}

export interface LLMConfig {
  default_provider: string;
  default_model: string;
  providers: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
  host?: string;
  api_key_env?: string;
  base_url?: string;
  models: string[];
}

export interface Agent {
  model: string;
  context?: string;
  triggers: Trigger[];
  actions: (string | Record<string, string>)[];
}

export interface Trigger {
  event: string;
  conditions?: Record<string, any>;
}

export class ConfigLoader {
  private config: AgentConfig | null = null;

  constructor(private configPath: string = './.github/agent-workflow.yml') {}

  /**
   * Load and parse the YAML config file
   */
  load(): AgentConfig {
    if (this.config) {
      return this.config;
    }

    try {
      const fileContents = fs.readFileSync(this.configPath, 'utf8');
      this.config = yaml.parse(fileContents);
      
      if (!this.config) {
        throw new Error('Failed to parse config file');
      }

      console.log(`✅ Loaded config v${this.config.version}`);
      console.log(`📦 Agents: ${Object.keys(this.config.agents).join(', ')}`);
      
      return this.config;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`Config file not found: ${this.configPath}`);
      }
      throw new Error(`Failed to load config: ${error.message}`);
    }
  }

  /**
   * Get a specific agent configuration by name
   */
  getAgent(agentName: string): Agent | null {
    const config = this.load();
    return config.agents[agentName] || null;
  }

  /**
   * Create an LLM provider instance based on agent config
   */
  createProvider(agentName: string): LLMProvider {
    const config = this.load();
    const agent = this.getAgent(agentName);
    
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    // Parse model string: "provider:model" or just "model" (uses default provider)
// Parse model string: "provider:model" or just "model" (uses default provider)
const parts = agent.model.split(':');

// Check if the model string has a provider prefix (e.g., "ollama:...")
const hasProviderPrefix = parts.length > 1;

// If it has a prefix, the provider is the first part, and the rest is the model name.
// We rejoin the remaining parts to handle colons within the model name (e.g., "qwen:14b").
const providerName = hasProviderPrefix ? parts[0] : config.llm.default_provider;
const modelName = hasProviderPrefix ? parts.slice(1).join(':') : agent.model; 

// --- OLD LOGIC, replaced with the above --- @DEPRECATED
// const [providerName, modelName] = agent.model.includes(':') 
//   ? agent.model.split(':')
//   : [config.llm.default_provider, agent.model];
// ------------------------------------------

const providerConfig = config.llm.providers[providerName];

    if (!providerConfig) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    return this.instantiateProvider(providerName, modelName, providerConfig);
  }

  /**
   * Create provider instance based on type
   */
  private instantiateProvider(
    providerName: string, 
    modelName: string, 
    providerConfig: ProviderConfig
  ): LLMProvider {
    switch (providerName) {
      case 'ollama':
        return new OllamaProvider(
          providerConfig.host || 'http://localhost:11434',
          modelName
        );

      case 'anthropic':
        const anthropicKey = process.env[providerConfig.api_key_env || 'ANTHROPIC_API_KEY'];
        if (!anthropicKey) {
          throw new Error(`${providerConfig.api_key_env} not set`);
        }
        return new AnthropicProvider(anthropicKey, modelName);

      case 'openai':
        const openaiKey = process.env[providerConfig.api_key_env || 'OPENAI_API_KEY'];
        if (!openaiKey) {
          throw new Error(`${providerConfig.api_key_env} not set`);
        }
        return new OpenAIProvider(openaiKey, modelName);

      case 'openrouter':
        const openrouterKey = process.env[providerConfig.api_key_env || 'OPENROUTER_API_KEY'];
        if (!openrouterKey) {
          throw new Error(`${providerConfig.api_key_env} not set`);
        }
        return new OpenRouterProvider(
          openrouterKey,
          modelName,
          providerConfig.base_url
        );

      case 'google':
        const googleKey = process.env[providerConfig.api_key_env || 'GOOGLE_API_KEY'];
        if (!googleKey) {
          throw new Error(`${providerConfig.api_key_env} not set`);
        }
        return new GeminiProvider(googleKey, modelName);

      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  /**
   * Get agents that should trigger on a specific event
   */
  getAgentsForEvent(eventName: string, labels?: string[]): string[] {
    const config = this.load();
    const matchingAgents: string[] = [];

    for (const [agentName, agent] of Object.entries(config.agents)) {
      for (const trigger of agent.triggers) {
        if (trigger.event === eventName) {
          // Check label conditions if present
          if (trigger.conditions && labels) {
            if (this.matchesConditions(trigger.conditions, labels)) {
              matchingAgents.push(agentName);
            }
          } else if (!trigger.conditions) {
            matchingAgents.push(agentName);
          }
        }
      }
    }

    return matchingAgents;
  }

  /**
   * Check if labels match trigger conditions
   */
  private matchesConditions(conditions: Record<string, any>, labels: string[]): boolean {
    if (conditions.labels_all) {
      const required = conditions.labels_all as string[];
      if (!required.every(label => labels.includes(label))) {
        return false;
      }
    }

    if (conditions.labels_any) {
      const anyOf = conditions.labels_any as string[];
      if (!anyOf.some(label => labels.includes(label))) {
        return false;
      }
    }

    if (conditions.label_added) {
      if (!labels.includes(conditions.label_added)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get current sprint number
   */
  getCurrentSprint(): number {
    const config = this.load();
    if (config.settings?.current_sprint) {
      return config.settings.current_sprint;
    }
    
    // Default: calculate week of year
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now.getTime() - start.getTime();
    const oneWeek = 1000 * 60 * 60 * 24 * 7;
    return Math.floor(diff / oneWeek) + 1;
  }
}