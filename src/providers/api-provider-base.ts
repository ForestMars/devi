import { LLMProvider } from './llm-provider.interface';

export interface ApiCallParams {
    url: string;
    headers: Record<string, string>;
    body: Record<string, any>;
}

export abstract class ApiProviderBase implements LLMProvider {
    abstract readonly name: string;
    
    constructor(
        protected host: string,
        protected model: string,
        public maxOutputTokens: number,
        protected apiKey?: string
    ) {}
    
    getModelName(): string {
        return this.model;
    }

    protected abstract buildApiCallParams(prompt: string): ApiCallParams;
    protected abstract parseResponse(data: any): string;

    async generateReview(prompt: string): Promise<string> {
        const { url, headers, body } = this.buildApiCallParams(prompt);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `LLM API Error (${this.name}): ${response.status} - ${response.statusText}. Response: ${errorText}`
            );
        }

        const data = await response.json();
        
        // Ollama returns {response: "..."}, OpenAI returns {choices: [{message: {content: "..."}}]}
        return this.parseResponse(data);
    }
}