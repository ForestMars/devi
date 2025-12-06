// src/providers/claude-provider.ts

export class ClaudeProvider implements LLMProvider {
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
