// src/providers/openai-provider.ts

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

