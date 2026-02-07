/**
 * Embedding Service - TF-IDF vectors for in-browser semantic similarity
 * Falls back to OpenAI embeddings when API key available
 */

interface TFIDFVector {
  terms: Map<string, number>;
  magnitude: number;
}

interface EmbeddingResult {
  vector: number[] | TFIDFVector;
  method: 'tfidf' | 'openai';
}

class EmbeddingService {
  private idfCache: Map<string, number> = new Map();
  private documentCount: number = 0;
  private documentFrequency: Map<string, number> = new Map();
  private stopWords: Set<string> = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
    'or', 'if', 'while', 'this', 'that', 'these', 'those', 'it', 'its',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
    'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
  ]);

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !this.stopWords.has(t));
  }

  /**
   * Build TF-IDF vector for a document
   */
  private buildTFIDF(text: string): TFIDFVector {
    const tokens = this.tokenize(text);
    const termFreq = new Map<string, number>();

    // Count term frequency
    tokens.forEach(token => {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    });

    // Calculate TF-IDF
    const terms = new Map<string, number>();
    let magnitudeSquared = 0;

    termFreq.forEach((count, term) => {
      const tf = count / tokens.length;
      const idf = this.idfCache.get(term) || Math.log(1 + this.documentCount);
      const tfidf = tf * idf;
      terms.set(term, tfidf);
      magnitudeSquared += tfidf * tfidf;
    });

    return {
      terms,
      magnitude: Math.sqrt(magnitudeSquared),
    };
  }

  /**
   * Add a document to the corpus (updates IDF values)
   */
  addDocument(text: string): void {
    this.documentCount++;
    const uniqueTerms = new Set(this.tokenize(text));

    uniqueTerms.forEach(term => {
      this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1);
    });

    // Recalculate IDF cache
    this.documentFrequency.forEach((df, term) => {
      this.idfCache.set(term, Math.log(1 + this.documentCount / df));
    });
  }

  /**
   * Add multiple documents at once
   */
  addDocuments(texts: string[]): void {
    texts.forEach(text => this.addDocument(text));
  }

  /**
   * Calculate cosine similarity between two texts
   */
  cosineSimilarity(text1: string, text2: string): number {
    const vec1 = this.buildTFIDF(text1);
    const vec2 = this.buildTFIDF(text2);

    if (vec1.magnitude === 0 || vec2.magnitude === 0) return 0;

    let dotProduct = 0;
    vec1.terms.forEach((value1, term) => {
      const value2 = vec2.terms.get(term);
      if (value2) {
        dotProduct += value1 * value2;
      }
    });

    return dotProduct / (vec1.magnitude * vec2.magnitude);
  }

  /**
   * Find most similar texts from a collection
   */
  findSimilar(
    query: string,
    candidates: Array<{ id: string; text: string }>,
    topK: number = 5,
    minSimilarity: number = 0.1
  ): Array<{ id: string; text: string; similarity: number }> {
    const results = candidates
      .map(candidate => ({
        ...candidate,
        similarity: this.cosineSimilarity(query, candidate.text),
      }))
      .filter(r => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return results;
  }

  /**
   * Embed using TF-IDF (always available)
   */
  embed(text: string): EmbeddingResult {
    return {
      vector: this.buildTFIDF(text),
      method: 'tfidf',
    };
  }

  /**
   * Get similarity matrix for a set of texts
   */
  similarityMatrix(texts: string[]): number[][] {
    const matrix: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < texts.length; j++) {
        if (i === j) {
          matrix[i]![j] = 1.0;
        } else if (j < i) {
          matrix[i]![j] = matrix[j]![i]!; // Symmetric
        } else {
          matrix[i]![j] = this.cosineSimilarity(texts[i]!, texts[j]!);
        }
      }
    }
    return matrix;
  }

  /**
   * Clear the corpus
   */
  clear(): void {
    this.idfCache.clear();
    this.documentFrequency.clear();
    this.documentCount = 0;
  }
}

export const embeddingService = new EmbeddingService();
export { EmbeddingService };
export type { TFIDFVector, EmbeddingResult };
