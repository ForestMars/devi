// src/providers.ts

export interface LLMProvider {
  name: string;
  getModelName(): string;
  generateReview(prompt: string): Promise<string>;
  maxOutputTokens: number; // Centralized configuration for output limit
}




