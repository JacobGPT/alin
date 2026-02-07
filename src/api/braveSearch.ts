/**
 * Brave Search API Client - Web Search Integration
 * 
 * Features:
 * - Web search with results
 * - Image search
 * - News search
 * - Safe search filtering
 * - Pagination
 * - Result formatting
 * - Error handling
 * - Rate limiting
 */

// ============================================================================
// TYPES
// ============================================================================

export interface BraveSearchConfig {
  apiKey: string;
  safeSearch?: 'strict' | 'moderate' | 'off';
  country?: string;
  language?: string;
  proxyUrl?: string; // Backend proxy URL to avoid CORS
}

export interface BraveSearchParams {
  query: string;
  count?: number;
  offset?: number;
  freshness?: 'day' | 'week' | 'month' | 'year';
  searchType?: 'web' | 'news' | 'images';
}

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  thumbnailUrl?: string;
  favicon?: string;
  language?: string;
  familyFriendly?: boolean;
}

export interface BraveSearchResponse {
  query: string;
  results: BraveSearchResult[];
  totalResults?: number;
  hasMore: boolean;
  searchType: string;
}

// ============================================================================
// BRAVE SEARCH API CLIENT CLASS
// ============================================================================

export class BraveSearchClient {
  private config: Required<Omit<BraveSearchConfig, 'proxyUrl'>> & { proxyUrl?: string };
  private baseUrl = 'https://api.search.brave.com/res/v1';
  private proxyUrl = 'http://localhost:3002/api/search/brave'; // Default proxy

  constructor(config: BraveSearchConfig) {
    this.config = {
      apiKey: config.apiKey,
      safeSearch: config.safeSearch || 'moderate',
      country: config.country || 'US',
      language: config.language || 'en',
    };
    if (config.proxyUrl) {
      this.proxyUrl = config.proxyUrl;
    }
  }
  
  // ==========================================================================
  // MAIN METHODS
  // ==========================================================================
  
  /**
   * Perform a web search
   * Uses backend proxy to avoid CORS issues in browsers
   */
  async search(params: BraveSearchParams): Promise<BraveSearchResponse> {
    const {
      query,
      count = 10,
      offset = 0,
      freshness,
      searchType = 'web',
    } = params;

    // Try using the backend proxy first (avoids CORS)
    try {
      console.log('[BraveSearch] Attempting search via proxy...');
      const proxyResponse = await fetch(this.proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          count,
          apiKey: this.config.apiKey,
        }),
      });

      if (proxyResponse.ok) {
        const data = await proxyResponse.json();
        console.log('[BraveSearch] Proxy search successful');
        return this.parseResponse(data, searchType);
      }

      // If proxy returns an error, throw to try direct API
      const errorData = await proxyResponse.json().catch(() => ({}));
      console.warn('[BraveSearch] Proxy error:', errorData);
      throw new Error(errorData.error || 'Proxy request failed');
    } catch (proxyError: any) {
      console.warn('[BraveSearch] Proxy unavailable, trying direct API:', proxyError.message);

      // Fall back to direct API call (will fail in browser due to CORS, but works in Node.js)
      try {
        const url = new URL(`${this.baseUrl}/${searchType}/search`);

        // Add query parameters
        url.searchParams.set('q', query);
        url.searchParams.set('count', count.toString());
        url.searchParams.set('offset', offset.toString());
        url.searchParams.set('safesearch', this.config.safeSearch);
        url.searchParams.set('country', this.config.country);
        url.searchParams.set('search_lang', this.config.language);

        if (freshness) {
          url.searchParams.set('freshness', freshness);
        }

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': this.config.apiKey,
          },
        });

        if (!response.ok) {
          throw new Error(`Brave Search API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return this.parseResponse(data, searchType);
      } catch (directError) {
        throw this.handleError(directError);
      }
    }
  }
  
  /**
   * Search for web pages
   */
  async searchWeb(query: string, count = 10, offset = 0): Promise<BraveSearchResponse> {
    return this.search({
      query,
      count,
      offset,
      searchType: 'web',
    });
  }
  
  /**
   * Search for news articles
   */
  async searchNews(query: string, count = 10, freshness?: 'day' | 'week' | 'month'): Promise<BraveSearchResponse> {
    return this.search({
      query,
      count,
      freshness,
      searchType: 'news',
    });
  }
  
  /**
   * Search for images
   */
  async searchImages(query: string, count = 10, offset = 0): Promise<BraveSearchResponse> {
    return this.search({
      query,
      count,
      offset,
      searchType: 'images',
    });
  }
  
  /**
   * Get next page of results
   */
  async getNextPage(previousResponse: BraveSearchResponse, query: string): Promise<BraveSearchResponse> {
    if (!previousResponse.hasMore) {
      return previousResponse; // No more results
    }
    
    const offset = previousResponse.results.length;
    
    return this.search({
      query,
      count: 10,
      offset,
      searchType: previousResponse.searchType as any,
    });
  }
  
  // ==========================================================================
  // RESPONSE PARSING
  // ==========================================================================
  
  private parseResponse(data: any, searchType: string): BraveSearchResponse {
    let results: BraveSearchResult[] = [];
    
    if (searchType === 'web' && data.web?.results) {
      results = data.web.results.map((result: any) => ({
        title: result.title,
        url: result.url,
        description: result.description,
        age: result.age,
        favicon: result.profile?.img,
        language: result.language,
        familyFriendly: result.family_friendly !== false,
      }));
    } else if (searchType === 'news' && data.news?.results) {
      results = data.news.results.map((result: any) => ({
        title: result.title,
        url: result.url,
        description: result.description,
        age: result.age,
        thumbnailUrl: result.thumbnail?.src,
        favicon: result.meta_url?.favicon,
      }));
    } else if (searchType === 'images' && data.results) {
      results = data.results.map((result: any) => ({
        title: result.title,
        url: result.url,
        description: result.description || '',
        thumbnailUrl: result.thumbnail?.src,
      }));
    }
    
    return {
      query: data.query?.original || '',
      results,
      totalResults: this.extractTotalResults(data),
      hasMore: results.length > 0 && this.hasMoreResults(data),
      searchType,
    };
  }
  
  private extractTotalResults(data: any): number | undefined {
    if (data.web?.results) {
      return data.web.results.length;
    } else if (data.news?.results) {
      return data.news.results.length;
    } else if (data.results) {
      return data.results.length;
    }
    return undefined;
  }
  
  private hasMoreResults(data: any): boolean {
    // Brave API doesn't always provide total count, so we assume more if we got full results
    const resultsCount = this.extractTotalResults(data);
    return (resultsCount || 0) >= 10;
  }
  
  // ==========================================================================
  // FORMATTING FOR AI
  // ==========================================================================
  
  /**
   * Format search results for AI consumption
   */
  formatForAI(response: BraveSearchResponse): string {
    let formatted = `Search Results for "${response.query}":\n\n`;

    response.results.forEach((result, index) => {
      formatted += `[${index + 1}] ${result.title}\n`;
      formatted += `URL: ${result.url}\n`;
      formatted += `${result.description}\n`;

      if (result.age) {
        formatted += `Published: ${result.age}\n`;
      }

      formatted += '\n';
    });

    if (response.results.length === 0) {
      formatted += 'No results found.\n';
    } else {
      formatted += `\n---\nYou now have ${response.results.length} search results. Use this information to respond to the user's question. Do not search again unless absolutely necessary.\n`;
    }

    return formatted;
  }
  
  /**
   * Format as tool result for Claude/GPT
   */
  formatAsToolResult(response: BraveSearchResponse): any {
    return {
      query: response.query,
      results: response.results.map((result, index) => ({
        position: index + 1,
        title: result.title,
        url: result.url,
        snippet: result.description,
        published: result.age,
      })),
      result_count: response.results.length,
      has_more: response.hasMore,
    };
  }
  
  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================
  
  private handleError(error: any): Error {
    if (error.message?.includes('401')) {
      return new Error('Invalid Brave Search API key');
    } else if (error.message?.includes('429')) {
      return new Error('Brave Search rate limit exceeded');
    } else if (error.message?.includes('500')) {
      return new Error('Brave Search API error');
    }
    
    return new Error(error.message || 'Unknown Brave Search error');
  }
  
  // ==========================================================================
  // UTILITIES
  // ==========================================================================
  
  /**
   * Build web search tool definition for Claude/GPT
   */
  static getToolDefinition(): any {
    return {
      name: 'web_search',
      description: 'Search the web for current information, news, articles, and data. Use this when you need up-to-date information or facts that may have changed since your knowledge cutoff.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query. Be specific and include relevant keywords.',
          },
          search_type: {
            type: 'string',
            enum: ['web', 'news', 'images'],
            description: 'Type of search to perform',
            default: 'web',
          },
          count: {
            type: 'number',
            description: 'Number of results to return (1-20)',
            default: 10,
            minimum: 1,
            maximum: 20,
          },
          freshness: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year'],
            description: 'How recent the results should be (optional)',
          },
        },
        required: ['query'],
      },
    };
  }
  
  /**
   * Extract key facts from search results
   */
  extractKeyFacts(response: BraveSearchResponse): string[] {
    const facts: string[] = [];
    
    response.results.slice(0, 5).forEach((result) => {
      // Extract first sentence as key fact
      const sentences = result.description.split(/[.!?]+/);
      if (sentences[0]) {
        facts.push(sentences[0].trim());
      }
    });
    
    return facts;
  }
  
  /**
   * Get sources list
   */
  getSources(response: BraveSearchResponse): string[] {
    return response.results.slice(0, 5).map((result) => result.url);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createBraveSearchClient(apiKey: string): BraveSearchClient {
  return new BraveSearchClient({ apiKey });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if search is needed based on query
 */
export function shouldSearchWeb(query: string): boolean {
  const searchTriggers = [
    'current',
    'latest',
    'recent',
    'today',
    'this week',
    'this month',
    'this year',
    'now',
    'update',
    'news',
    'breaking',
    'what happened',
    'what is happening',
    'search for',
    'look up',
    'find',
  ];
  
  const lowerQuery = query.toLowerCase();
  return searchTriggers.some((trigger) => lowerQuery.includes(trigger));
}

/**
 * Extract search query from natural language
 */
export function extractSearchQuery(query: string): string {
  // Remove common prefixes
  let cleaned = query.toLowerCase()
    .replace(/^(search for|look up|find|what is|what are|who is|when did|where is)\s+/i, '')
    .replace(/\?$/, '')
    .trim();
  
  return cleaned || query;
}
