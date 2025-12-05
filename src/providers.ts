// src/providers.ts

export interface LLMProvider {
  name: string;
  getModelName(): string;
  generateReview(prompt: string): Promise<string>;
  maxOutputTokens: number; // Centralized configuration for output limit
}

export class OllamaProvider implements LLMProvider {
  name = "Ollama";
  public maxOutputTokens: number; // Property added

  constructor(
    private host: string,
    private model: string,
    maxOutputTokens: number = 4096 // Accepts configurable output limit
  ) {
    this.maxOutputTokens = maxOutputTokens;
  }

  getModelName(): string {
    return this.model;
  }

  async generateReview(prompt: string): Promise<string> {
    const response = await fetch(`${this.host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 1.5,
          num_predict: this.maxOutputTokens // Uses configured value (4096)
          // stop: ["\n]"] // CRITICAL FIX for Qwen truncation (stops output after closing JSON array)
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response;
  }
}

export class OpenAIProvider implements LLMProvider {
  name = "OpenAI";
  public maxOutputTokens: number;

  constructor(
    private apiKey: string,
    private model: string,
    // Removed maxOutputTokens argument here
  ) {
    this.maxOutputTokens = 4096; // Default or simplified initialization
  }

  getModelName(): string {
    return `OpenAI (${this.model})`;
  }

  async generateReview(prompt: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are an expert code reviewer. Provide constructive, actionable feedback on code changes."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        // Using default max_tokens if not passed in, or rely on internal logic
        max_tokens: this.maxOutputTokens // Kept for interface compliance
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}

export class AnthropicProvider implements LLMProvider {
  name = "Anthropic";
  public maxOutputTokens: number;

  constructor(
    private apiKey: string,
    private model: string,
    // Removed maxOutputTokens argument here
  ) {
    this.maxOutputTokens = 4096;
  }

  getModelName(): string {
    return `Claude (${this.model})`;
  }

  async generateReview(prompt: string): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens, // Kept for interface compliance
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        system: "You are an expert code reviewer. Provide constructive, actionable feedback on code changes. Focus on bugs, security issues, performance problems, and code quality."
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.statusText} - ${error}`);
    }

    const data = await response.json();
    return data.content[0].text;
  }
}

export class OpenRouterProvider implements LLMProvider {
  name = "OpenRouter";
  public maxOutputTokens: number;

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string = "https://openrouter.ai/api/v1",
    // Removed maxOutputTokens argument here
  ) {
    this.maxOutputTokens = 4096;
  }

  getModelName(): string {
    return `OpenRouter (${this.model})`;
  }

  async generateReview(prompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/ForestMars/devi",
        "X-Title": "PR Review Agent"
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are an expert code reviewer. Provide constructive, actionable feedback on code changes."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: this.maxOutputTokens // Kept for interface compliance
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.statusText} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}

export class GeminiProvider implements LLMProvider {
  name = "Gemini";
  public maxOutputTokens: number;

  constructor(
    private apiKey: string,
    private model: string,
    // Removed maxOutputTokens argument here
  ) {
    this.maxOutputTokens = 4096;
  }

  getModelName(): string {
    return `Gemini (${this.model})`;
  }

  async generateReview(prompt: string): Promise<string> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are an expert code reviewer. Provide constructive, actionable feedback on code changes.\n\n${prompt}`
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: this.maxOutputTokens // Kept for interface compliance
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.statusText} - ${error}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }
}