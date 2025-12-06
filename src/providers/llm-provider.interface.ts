// src/providers/llm-provider.interface.ts

export interface LLMProvider {
  name: string;
  model: string;
  maxOutputTokens: number;
  generateReview(prompt: string): Promise<string>;
}