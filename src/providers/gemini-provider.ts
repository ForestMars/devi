// src/providers/gemini-provider.ts

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