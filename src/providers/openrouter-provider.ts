// src/providers/openrouter-provider.ts

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
