import { LLMProvider } from './llm-provider.interface';

/**
 * Interface for the specific parameters required by the concrete provider
 * (e.g., headers, URL, and body for the HTTP request).
 */
interface ApiCallParams {
    url: string;
    headers: Record<string, string>;
    body: Record<string, any>;
}

/**
 * Abstract base class for all LLM providers that use a standard HTTP/JSON API (e.g., OpenAI, OpenRouter).
 * This class implements the common 'generateReview' algorithm (Template Method).
 */
export abstract class ApiProviderBase implements LLMProvider {
    // LLMProvider interface properties (must be implemented by concrete classes)
    abstract readonly name: string;
    abstract model: string;
    abstract maxOutputTokens: number;
    abstract host: string; // The base URL for the API

    // --- Abstract Hooks (Must be implemented by Subclasses) ---

    /**
     * Hook method: Concrete providers must implement this to return their specific
     * API endpoint URL, required headers (e.g., API key format), and the request body structure.
     * @param prompt The analysis prompt containing the file context.
     */
    protected abstract buildApiCallParams(prompt: string): ApiCallParams;

    // --- Template Method Implementation (Reusable Algorithm) ---

    /**
     * Template Method: Implements the full end-to-end process for generating a review.
     * This method handles the HTTP request, error checking, and final response parsing.
     */
    async generateReview(prompt: string): Promise<string> {
        const { url, headers, body } = this.buildApiCallParams(prompt);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers, // Merge provider-specific headers (API Key, etc.)
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `LLM API Error (${this.name}): ${response.status} - ${response.statusText}. Response: ${errorText}`
            );
        }

        // Standard response parsing for OpenAI-style APIs
        const data = await response.json();

        // The exact field name depends on the API; this is a common structure (OpenAI, OpenRouter)
        // You might need a small helper hook if the field name varies (e.g., 'choices', 'content', 'message')
        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
            return data.choices[0].message.content || '';
        }
        
        // Fallback for other common formats
        if (data.message && data.message.content) {
             return data.message.content;
        }

        // If the structure is unexpected, return the raw JSON for diagnostics
        return JSON.stringify(data);
    }
}