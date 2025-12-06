// src/providers/ollama-provider.ts

import { ApiProviderBase, ApiCallParams } from './api-provider-base';

export class OllamaProvider extends ApiProviderBase {
    readonly name: string = 'Ollama';

    constructor(
        host: string,
        model: string,
        maxOutputTokens: number
    ) {
        super(host, model, maxOutputTokens);
    }

    protected buildApiCallParams(prompt: string): ApiCallParams {
        return {
            url: `${this.host}/api/generate`, 
            headers: {},
            body: {
                model: this.model,
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    num_predict: this.maxOutputTokens,
                },
            },
        };
    }
    
    protected parseResponse(data: any): string {
        const rawResponse = data.response;
        
        if (typeof rawResponse !== 'string' || rawResponse.length === 0) {
            throw new Error(`Ollama returned an unexpected or empty response body: ${JSON.stringify(data)}`);
        }
        
        return rawResponse.trim();
    }
}