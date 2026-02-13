/**
 * Memory Service - Advanced Intelligent Memory Operations
 *
 * A sophisticated 8-layer memory system inspired by human cognition with:
 * - Multiple embedding strategies (TF-IDF, BM25, semantic similarity)
 * - Memory graph with relationship traversal and knowledge inference
 * - Consolidation cycles mimicking sleep-based memory processing
 * - Conflict resolution with version tracking and confidence scoring
 * - Temporal reasoning with decay functions and causal chains
 * - Meta-memory for self-awareness and adaptive optimization
 * - Attention-based retrieval with salience weighting
 * - Distributed activation spreading across memory networks
 */

import { nanoid } from 'nanoid';
import { useMemoryStore } from '@store/memoryStore';
import {
  MemoryLayer,
  MemoryEntry,
  ShortTermMemory,
  LongTermMemory,
  SemanticMemory,
  RelationalMemory,
  ProceduralMemory,
  WorkingMemory,
  EpisodicMemory,
  MetaMemory,
  EventType,
  Significance,
  EntityType,
  SkillType,
} from '../types/memory';
import type { Message, ContentBlock } from '../types/chat';

// ============================================================================
// TYPES
// ============================================================================

interface MemoryFormationResult {
  memoriesCreated: string[];
  factsExtracted: string[];
  entitiesMentioned: string[];
  skillsLearned: string[];
  connectionsFormed: number;
  consolidationTriggered: boolean;
}

interface ConversationContext {
  relevantMemories: MemoryEntry[];
  userPreferences: Record<string, unknown>;
  previousTopics: string[];
  inferredFacts: string[];
  attentionWeights: Map<string, number>;
  tokenBudget: number;
  tokensUsed: number;
}

interface MemoryImportance {
  score: number;
  factors: {
    emotionalIntensity: number;
    novelty: number;
    relevanceToGoals: number;
    frequency: number;
    userEmphasis: number;
    temporalProximity: number;
    semanticCentrality: number;
  };
}

interface MemoryConflict {
  memoryIds: string[];
  type: 'contradiction' | 'update' | 'ambiguity';
  resolution: 'newer_wins' | 'higher_confidence' | 'merge' | 'user_decision';
  resolvedValue?: unknown;
  confidence: number;
}

interface MemoryGraphNode {
  memoryId: string;
  connections: Map<string, MemoryEdge>;
  activation: number;
  lastActivated: number;
  clusterIndex: number;
}

interface MemoryEdge {
  targetId: string;
  weight: number;
  type: 'semantic' | 'temporal' | 'causal' | 'reference' | 'entity' | 'procedural';
  bidirectional: boolean;
  createdAt: number;
  accessCount: number;
}

interface ConsolidationResult {
  memoriesProcessed: number;
  memoriesConsolidated: number;
  memoriesPruned: number;
  connectionsStrengthened: number;
  newAbstractions: string[];
  duration: number;
}

interface RetrievalMetrics {
  queryTime: number;
  memoriesScanned: number;
  memoriesReturned: number;
  activationSpread: number;
  cacheHit: boolean;
}

interface MetaMemoryStats {
  totalMemories: number;
  byLayer: Record<MemoryLayer, number>;
  avgSalience: number;
  avgAccessCount: number;
  consolidationCycles: number;
  retrievalAccuracy: number;
  graphDensity: number;
  clusterCount: number;
}

// ============================================================================
// ADVANCED EMBEDDING SYSTEM
// ============================================================================

class AdvancedEmbedding {
  private vocabulary: Map<string, number> = new Map();
  private reverseVocab: Map<number, string> = new Map();
  private idf: Map<string, number> = new Map();
  private bm25Params = { k1: 1.5, b: 0.75 };
  private documents: string[] = [];
  private documentLengths: number[] = [];
  private avgDocLength: number = 0;
  private wordVectors: Map<string, number[]> = new Map();
  private embeddingDim: number = 128;
  private termFrequencies: Map<string, Map<string, number>> = new Map();
  private documentVectors: Map<number, number[]> = new Map();

  /**
   * Tokenize text with advanced processing
   */
  private tokenize(text: string): string[] {
    if (!text || typeof text !== 'string') return [];
    // Lowercase and split
    let tokens = text
      .toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1);

    // Remove common stopwords
    const stopwords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'to', 'of', 'in',
      'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
      'during', 'before', 'after', 'above', 'below', 'between', 'under',
      'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
      'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some',
      'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
      'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until',
      'while', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'myself',
      'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself',
      'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it',
      'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
    ]);

    tokens = tokens.filter((t) => !stopwords.has(t));

    // Apply Porter-like stemming (simplified)
    tokens = tokens.map((token) => this.simpleStem(token));

    return tokens;
  }

  /**
   * Simple Porter-style stemmer
   */
  private simpleStem(word: string): string {
    // Common suffix removal
    const suffixes = [
      'ingly', 'ingly', 'ation', 'ness', 'ment', 'able', 'ible',
      'ally', 'ful', 'less', 'ous', 'ive', 'ing', 'ed', 'er', 'es', 'ly', 's',
    ];

    for (const suffix of suffixes) {
      if (word.endsWith(suffix) && word.length > suffix.length + 2) {
        return word.slice(0, -suffix.length);
      }
    }
    return word;
  }

  /**
   * Generate n-grams from tokens
   */
  private generateNgrams(tokens: string[], n: number = 2): string[] {
    const ngrams: string[] = [];
    for (let i = 0; i <= tokens.length - n; i++) {
      ngrams.push(tokens.slice(i, i + n).join('_'));
    }
    return ngrams;
  }

  /**
   * Add document to corpus with full indexing
   */
  addDocument(text: string, docId?: number): number {
    if (!text || typeof text !== 'string') return docId ?? this.documents.length;
    const id = docId ?? this.documents.length;
    this.documents[id] = text;

    const tokens = this.tokenize(text);
    const ngrams = this.generateNgrams(tokens);
    const allTokens = [...tokens, ...ngrams];

    this.documentLengths[id] = tokens.length;
    this.avgDocLength = this.documentLengths.reduce((a, b) => a + b, 0) / this.documents.length;

    // Build term frequencies for this document
    const termFreq = new Map<string, number>();
    allTokens.forEach((token) => {
      if (!this.vocabulary.has(token)) {
        const idx = this.vocabulary.size;
        this.vocabulary.set(token, idx);
        this.reverseVocab.set(idx, token);
      }
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    });
    this.termFrequencies.set(String(id), termFreq);

    // Update IDF values
    this.updateIDF();

    // Generate document vector
    this.documentVectors.set(id, this.generateVector(text));

    // Generate pseudo word vectors (in production, use pre-trained embeddings)
    this.updateWordVectors(tokens);

    return id;
  }

  /**
   * Update IDF values across corpus
   */
  private updateIDF(): void {
    const N = this.documents.length;

    this.vocabulary.forEach((_, term) => {
      let docCount = 0;
      this.termFrequencies.forEach((termFreq) => {
        if (termFreq.has(term)) docCount++;
      });
      // IDF with smoothing
      this.idf.set(term, Math.log((N - docCount + 0.5) / (docCount + 0.5) + 1));
    });
  }

  /**
   * Update pseudo word vectors using co-occurrence
   */
  private updateWordVectors(tokens: string[]): void {
    const windowSize = 5;

    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i];
      if (!this.wordVectors.has(word)) {
        // Initialize with random small values
        this.wordVectors.set(
          word,
          Array.from({ length: this.embeddingDim }, () => (Math.random() - 0.5) * 0.1)
        );
      }

      // Update based on co-occurrence within window
      for (let j = Math.max(0, i - windowSize); j < Math.min(tokens.length, i + windowSize); j++) {
        if (i !== j) {
          const contextWord = tokens[j];
          if (!this.wordVectors.has(contextWord)) {
            this.wordVectors.set(
              contextWord,
              Array.from({ length: this.embeddingDim }, () => (Math.random() - 0.5) * 0.1)
            );
          }

          // Simple additive update (in production, use proper training)
          const wordVec = this.wordVectors.get(word)!;
          const contextVec = this.wordVectors.get(contextWord)!;
          const distance = Math.abs(i - j);
          const weight = 1 / distance;

          for (let k = 0; k < this.embeddingDim; k++) {
            wordVec[k] += weight * 0.01 * contextVec[k];
          }
        }
      }
    }
  }

  /**
   * Generate TF-IDF vector
   */
  private generateVector(text: string): number[] {
    const tokens = this.tokenize(text);
    const ngrams = this.generateNgrams(tokens);
    const allTokens = [...tokens, ...ngrams];

    const termFreq = new Map<string, number>();
    allTokens.forEach((token) => {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    });

    const vector: number[] = new Array(this.vocabulary.size).fill(0);

    termFreq.forEach((freq, term) => {
      const idx = this.vocabulary.get(term);
      if (idx !== undefined) {
        const tf = freq / tokens.length;
        const idf = this.idf.get(term) || 0;
        vector[idx] = tf * idf;
      }
    });

    // L2 normalize
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      return vector.map((v) => v / magnitude);
    }
    return vector;
  }

  /**
   * Generate semantic embedding using word vectors
   */
  generateSemanticEmbedding(text: string): number[] {
    const tokens = this.tokenize(text);
    const embedding = new Array(this.embeddingDim).fill(0);
    let validTokens = 0;

    for (const token of tokens) {
      const vec = this.wordVectors.get(token);
      if (vec) {
        const idf = this.idf.get(token) || 1;
        for (let i = 0; i < this.embeddingDim; i++) {
          embedding[i] += vec[i] * idf;
        }
        validTokens++;
      }
    }

    if (validTokens > 0) {
      // Average and normalize
      const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
      if (magnitude > 0) {
        return embedding.map((v) => v / magnitude);
      }
    }

    return embedding;
  }

  /**
   * BM25 scoring for a query against all documents
   */
  bm25Score(query: string, docId: number): number {
    const queryTokens = this.tokenize(query);
    const docTermFreq = this.termFrequencies.get(String(docId));
    if (!docTermFreq) return 0;

    const docLength = this.documentLengths[docId] || 0;
    let score = 0;

    for (const term of queryTokens) {
      const idf = this.idf.get(term) || 0;
      const tf = docTermFreq.get(term) || 0;

      const numerator = tf * (this.bm25Params.k1 + 1);
      const denominator =
        tf +
        this.bm25Params.k1 *
          (1 - this.bm25Params.b + this.bm25Params.b * (docLength / this.avgDocLength));

      score += idf * (numerator / denominator);
    }

    return score;
  }

  /**
   * Combined similarity using multiple methods
   */
  combinedSimilarity(
    query: string,
    docId: number,
    weights: { tfidf: number; bm25: number; semantic: number } = { tfidf: 0.3, bm25: 0.4, semantic: 0.3 }
  ): number {
    // TF-IDF cosine similarity
    const queryVec = this.generateVector(query);
    const docVec = this.documentVectors.get(docId);
    const tfidfSim = docVec ? this.cosineSimilarity(queryVec, docVec) : 0;

    // BM25 score (normalized)
    const bm25 = this.bm25Score(query, docId);
    const bm25Normalized = Math.tanh(bm25 / 10); // Normalize to [0, 1]

    // Semantic similarity
    const queryEmbed = this.generateSemanticEmbedding(query);
    const docText = this.documents[docId];
    const docEmbed = docText ? this.generateSemanticEmbedding(docText) : new Array(this.embeddingDim).fill(0);
    const semanticSim = this.cosineSimilarity(queryEmbed, docEmbed);

    return (
      weights.tfidf * tfidfSim +
      weights.bm25 * bm25Normalized +
      weights.semantic * semanticSim
    );
  }

  /**
   * Cosine similarity between two vectors
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      // Pad shorter vector
      const maxLen = Math.max(a.length, b.length);
      while (a.length < maxLen) a.push(0);
      while (b.length < maxLen) b.push(0);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dotProduct / denom : 0;
  }

  /**
   * Find most similar documents
   */
  findSimilar(query: string, topK: number = 10): Array<{ docId: number; score: number }> {
    const scores: Array<{ docId: number; score: number }> = [];

    for (let i = 0; i < this.documents.length; i++) {
      if (this.documents[i]) {
        scores.push({
          docId: i,
          score: this.combinedSimilarity(query, i),
        });
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Get vocabulary size
   */
  getVocabularySize(): number {
    return this.vocabulary.size;
  }

  /**
   * Get corpus size
   */
  getCorpusSize(): number {
    return this.documents.filter(Boolean).length;
  }
}

// ============================================================================
// MEMORY GRAPH
// ============================================================================

class MemoryGraph {
  private nodes: Map<string, MemoryGraphNode> = new Map();
  private clusters: Map<number, Set<string>> = new Map();
  private clusterCounter: number = 0;
  private activationDecayRate: number = 0.95;

  /**
   * Add a memory to the graph
   */
  addNode(memoryId: string): MemoryGraphNode {
    if (this.nodes.has(memoryId)) {
      return this.nodes.get(memoryId)!;
    }

    const node: MemoryGraphNode = {
      memoryId,
      connections: new Map(),
      activation: 0,
      lastActivated: 0,
      clusterIndex: -1,
    };

    this.nodes.set(memoryId, node);
    return node;
  }

  /**
   * Add an edge between memories
   */
  addEdge(
    sourceId: string,
    targetId: string,
    type: MemoryEdge['type'],
    weight: number = 1.0,
    bidirectional: boolean = true
  ): void {
    // Ensure nodes exist
    this.addNode(sourceId);
    this.addNode(targetId);

    const sourceNode = this.nodes.get(sourceId)!;
    const targetNode = this.nodes.get(targetId)!;

    // Add forward edge
    const existingEdge = sourceNode.connections.get(targetId);
    if (existingEdge) {
      // Strengthen existing connection
      existingEdge.weight = Math.min(existingEdge.weight + weight * 0.1, 2.0);
      existingEdge.accessCount++;
    } else {
      sourceNode.connections.set(targetId, {
        targetId,
        weight,
        type,
        bidirectional,
        createdAt: Date.now(),
        accessCount: 1,
      });
    }

    // Add reverse edge if bidirectional
    if (bidirectional) {
      const reverseEdge = targetNode.connections.get(sourceId);
      if (reverseEdge) {
        reverseEdge.weight = Math.min(reverseEdge.weight + weight * 0.1, 2.0);
        reverseEdge.accessCount++;
      } else {
        targetNode.connections.set(sourceId, {
          targetId: sourceId,
          weight,
          type,
          bidirectional,
          createdAt: Date.now(),
          accessCount: 1,
        });
      }
    }
  }

  /**
   * Activate a node and spread activation to neighbors
   */
  activate(memoryId: string, initialActivation: number = 1.0, spreadDepth: number = 3): Map<string, number> {
    const activations = new Map<string, number>();
    const visited = new Set<string>();
    const queue: Array<{ id: string; activation: number; depth: number }> = [
      { id: memoryId, activation: initialActivation, depth: 0 },
    ];

    while (queue.length > 0) {
      const { id, activation, depth } = queue.shift()!;

      if (visited.has(id) || depth > spreadDepth) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (!node) continue;

      // Update node activation
      const currentActivation = activations.get(id) || 0;
      const newActivation = currentActivation + activation;
      activations.set(id, newActivation);

      node.activation = newActivation;
      node.lastActivated = Date.now();

      // Spread to neighbors with decay
      node.connections.forEach((edge, neighborId) => {
        const spreadActivation = activation * edge.weight * this.activationDecayRate;
        if (spreadActivation > 0.01) {
          // Threshold to avoid infinite spreading
          queue.push({ id: neighborId, activation: spreadActivation, depth: depth + 1 });
        }
      });
    }

    return activations;
  }

  /**
   * Find shortest path between two memories
   */
  findPath(sourceId: string, targetId: string): string[] | null {
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) {
      return null;
    }

    const visited = new Set<string>();
    const queue: Array<{ id: string; path: string[] }> = [{ id: sourceId, path: [sourceId] }];

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;

      if (id === targetId) {
        return path;
      }

      if (visited.has(id)) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (!node) continue;

      node.connections.forEach((_, neighborId) => {
        if (!visited.has(neighborId)) {
          queue.push({ id: neighborId, path: [...path, neighborId] });
        }
      });
    }

    return null;
  }

  /**
   * Find all paths up to a certain length
   */
  findAllPaths(sourceId: string, targetId: string, maxLength: number = 5): string[][] {
    const paths: string[][] = [];

    const dfs = (currentId: string, path: string[], visited: Set<string>): void => {
      if (path.length > maxLength) return;

      if (currentId === targetId) {
        paths.push([...path]);
        return;
      }

      const node = this.nodes.get(currentId);
      if (!node) return;

      node.connections.forEach((_, neighborId) => {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          path.push(neighborId);
          dfs(neighborId, path, visited);
          path.pop();
          visited.delete(neighborId);
        }
      });
    };

    const visited = new Set<string>([sourceId]);
    dfs(sourceId, [sourceId], visited);

    return paths;
  }

  /**
   * Cluster memories using community detection (Label Propagation)
   */
  detectCommunities(): Map<number, Set<string>> {
    // Initialize each node with its own cluster
    let nodeLabels = new Map<string, number>();
    let labelCounter = 0;

    this.nodes.forEach((_, id) => {
      nodeLabels.set(id, labelCounter++);
    });

    // Iterate until convergence
    let changed = true;
    let iterations = 0;
    const maxIterations = 100;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      // Process nodes in random order
      const nodeIds = Array.from(this.nodes.keys());
      this.shuffleArray(nodeIds);

      for (const nodeId of nodeIds) {
        const node = this.nodes.get(nodeId)!;

        // Count neighbor labels weighted by edge strength
        const labelWeights = new Map<number, number>();

        node.connections.forEach((edge, neighborId) => {
          const neighborLabel = nodeLabels.get(neighborId)!;
          const currentWeight = labelWeights.get(neighborLabel) || 0;
          labelWeights.set(neighborLabel, currentWeight + edge.weight);
        });

        // Find label with maximum weight
        let maxWeight = -1;
        let bestLabel = nodeLabels.get(nodeId)!;

        labelWeights.forEach((weight, label) => {
          if (weight > maxWeight) {
            maxWeight = weight;
            bestLabel = label;
          }
        });

        // Update label if different
        if (bestLabel !== nodeLabels.get(nodeId)) {
          nodeLabels.set(nodeId, bestLabel);
          changed = true;
        }
      }
    }

    // Build cluster map
    this.clusters.clear();
    nodeLabels.forEach((label, nodeId) => {
      if (!this.clusters.has(label)) {
        this.clusters.set(label, new Set());
      }
      this.clusters.get(label)!.add(nodeId);

      // Update node's cluster index
      const node = this.nodes.get(nodeId);
      if (node) {
        node.clusterIndex = label;
      }
    });

    return this.clusters;
  }

  /**
   * Get neighbors of a node
   */
  getNeighbors(memoryId: string, depth: number = 1): Set<string> {
    const neighbors = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{ id: string; currentDepth: number }> = [{ id: memoryId, currentDepth: 0 }];

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;

      if (visited.has(id) || currentDepth > depth) continue;
      visited.add(id);

      if (id !== memoryId) {
        neighbors.add(id);
      }

      const node = this.nodes.get(id);
      if (!node) continue;

      node.connections.forEach((_, neighborId) => {
        if (!visited.has(neighborId)) {
          queue.push({ id: neighborId, currentDepth: currentDepth + 1 });
        }
      });
    }

    return neighbors;
  }

  /**
   * Calculate centrality (PageRank-like)
   */
  calculateCentrality(iterations: number = 20): Map<string, number> {
    const damping = 0.85;
    const n = this.nodes.size;
    const centrality = new Map<string, number>();

    // Initialize with uniform distribution
    this.nodes.forEach((_, id) => {
      centrality.set(id, 1 / n);
    });

    for (let i = 0; i < iterations; i++) {
      const newCentrality = new Map<string, number>();

      this.nodes.forEach((_, id) => {
        let sum = 0;

        // Sum contributions from incoming edges
        this.nodes.forEach((node, neighborId) => {
          if (node.connections.has(id)) {
            const neighborCentrality = centrality.get(neighborId) || 0;
            const outDegree = node.connections.size || 1;
            sum += neighborCentrality / outDegree;
          }
        });

        newCentrality.set(id, (1 - damping) / n + damping * sum);
      });

      centrality.clear();
      newCentrality.forEach((value, key) => centrality.set(key, value));
    }

    return centrality;
  }

  /**
   * Get graph statistics
   */
  getStats(): { nodes: number; edges: number; avgDegree: number; density: number } {
    let totalEdges = 0;
    this.nodes.forEach((node) => {
      totalEdges += node.connections.size;
    });

    const nodeCount = this.nodes.size;
    const avgDegree = nodeCount > 0 ? totalEdges / nodeCount : 0;
    const maxPossibleEdges = nodeCount * (nodeCount - 1);
    const density = maxPossibleEdges > 0 ? totalEdges / maxPossibleEdges : 0;

    return {
      nodes: nodeCount,
      edges: totalEdges,
      avgDegree,
      density,
    };
  }

  /**
   * Decay all activations
   */
  decayActivations(): void {
    const now = Date.now();
    const decayHalfLife = 3600000; // 1 hour

    this.nodes.forEach((node) => {
      const timeSinceActivation = now - node.lastActivated;
      const decayFactor = Math.pow(0.5, timeSinceActivation / decayHalfLife);
      node.activation *= decayFactor;
    });
  }

  /**
   * Remove weakly connected nodes
   */
  pruneWeakConnections(minWeight: number = 0.1): number {
    let pruned = 0;

    this.nodes.forEach((node) => {
      const toRemove: string[] = [];

      node.connections.forEach((edge, targetId) => {
        if (edge.weight < minWeight && edge.accessCount < 2) {
          toRemove.push(targetId);
        }
      });

      toRemove.forEach((targetId) => {
        node.connections.delete(targetId);
        pruned++;
      });
    });

    return pruned;
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}

// ============================================================================
// CONFLICT RESOLUTION
// ============================================================================

class ConflictResolver {
  private conflicts: Map<string, MemoryConflict> = new Map();

  /**
   * Detect conflicts between memories
   */
  detectConflicts(
    memories: MemoryEntry[],
    newMemory: MemoryEntry
  ): MemoryConflict[] {
    const conflicts: MemoryConflict[] = [];

    // Check for semantic conflicts
    for (const existing of memories) {
      if (existing.layer === newMemory.layer) {
        // Check for contradictions in semantic memories
        if (existing.layer === MemoryLayer.SEMANTIC) {
          const existingSemantic = existing as SemanticMemory;
          const newSemantic = newMemory as SemanticMemory;

          if (
            existingSemantic.subject === newSemantic.subject &&
            existingSemantic.predicate === newSemantic.predicate
          ) {
            if (existingSemantic.object !== newSemantic.object) {
              conflicts.push({
                memoryIds: [existing.id, newMemory.id],
                type: 'contradiction',
                resolution: this.determineResolution(existing, newMemory),
                confidence: this.calculateConflictConfidence(existing, newMemory),
              });
            } else {
              // Same fact - potential update
              conflicts.push({
                memoryIds: [existing.id, newMemory.id],
                type: 'update',
                resolution: 'merge',
                confidence: 1.0,
              });
            }
          }
        }

        // Check for entity conflicts
        if (existing.layer === MemoryLayer.RELATIONAL) {
          const existingRel = existing as RelationalMemory;
          const newRel = newMemory as RelationalMemory;

          if (existingRel.entityName?.toLowerCase() === newRel.entityName?.toLowerCase()) {
            // Same entity - merge attributes
            conflicts.push({
              memoryIds: [existing.id, newMemory.id],
              type: 'update',
              resolution: 'merge',
              confidence: 0.9,
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Determine resolution strategy
   */
  private determineResolution(
    existing: MemoryEntry,
    newMemory: MemoryEntry
  ): MemoryConflict['resolution'] {
    // Prefer more recent information
    if (newMemory.createdAt > existing.createdAt + 86400000) {
      // > 1 day newer
      return 'newer_wins';
    }

    // Check confidence levels
    if (existing.layer === MemoryLayer.SEMANTIC && newMemory.layer === MemoryLayer.SEMANTIC) {
      const existingConf = (existing as SemanticMemory).confidence || 0.5;
      const newConf = (newMemory as SemanticMemory).confidence || 0.5;

      if (newConf > existingConf + 0.2) {
        return 'higher_confidence';
      }
    }

    // Default to merging
    return 'merge';
  }

  /**
   * Calculate confidence in conflict detection
   */
  private calculateConflictConfidence(
    existing: MemoryEntry,
    newMemory: MemoryEntry
  ): number {
    let confidence = 0.5;

    // Higher confidence if same subject/predicate
    if (existing.layer === MemoryLayer.SEMANTIC && newMemory.layer === MemoryLayer.SEMANTIC) {
      const existingSem = existing as SemanticMemory;
      const newSem = newMemory as SemanticMemory;

      if (existingSem.subject === newSem.subject) confidence += 0.2;
      if (existingSem.predicate === newSem.predicate) confidence += 0.2;
    }

    // Higher confidence for verified facts
    if ((existing as SemanticMemory).verified) confidence += 0.1;
    if ((newMemory as SemanticMemory).verified) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Resolve a conflict
   */
  resolve(conflict: MemoryConflict, store: ReturnType<typeof useMemoryStore.getState>): void {
    const [existingId, newId] = conflict.memoryIds;
    const existing = store.memories.get(existingId);
    const newMemory = store.memories.get(newId);

    if (!existing || !newMemory) return;

    switch (conflict.resolution) {
      case 'newer_wins':
        // Archive the old memory
        store.updateMemory(existingId, { isArchived: true });
        break;

      case 'higher_confidence':
        // Keep higher confidence, archive lower
        const existingConf = (existing as SemanticMemory).confidence || 0;
        const newConf = (newMemory as SemanticMemory).confidence || 0;
        if (newConf > existingConf) {
          store.updateMemory(existingId, { isArchived: true });
        } else {
          store.updateMemory(newId, { isArchived: true });
        }
        break;

      case 'merge':
        // Combine information from both
        if (existing.layer === MemoryLayer.RELATIONAL) {
          const existingRel = existing as RelationalMemory;
          const newRel = newMemory as RelationalMemory;

          // Merge attributes
          const mergedAttributes = new Map(existingRel.attributes);
          newRel.attributes?.forEach((value, key) => {
            mergedAttributes.set(key, value);
          });

          store.updateMemory(existingId, {
            attributes: mergedAttributes,
            interactionFrequency: existingRel.interactionFrequency + 1,
          });

          // Archive the duplicate
          store.updateMemory(newId, { isArchived: true });
        }
        break;
    }

    // Record the conflict
    this.conflicts.set(`${existingId}-${newId}`, conflict);
  }
}

// ============================================================================
// CONSOLIDATION ENGINE
// ============================================================================

class ConsolidationEngine {
  private lastConsolidation: number = 0;
  private consolidationInterval: number = 3600000; // 1 hour
  private isConsolidating: boolean = false;

  /**
   * Check if consolidation is needed
   */
  shouldConsolidate(): boolean {
    const now = Date.now();
    return now - this.lastConsolidation > this.consolidationInterval;
  }

  /**
   * Perform memory consolidation
   */
  async consolidate(
    store: ReturnType<typeof useMemoryStore.getState>,
    graph: MemoryGraph,
    embedding: AdvancedEmbedding
  ): Promise<ConsolidationResult> {
    if (this.isConsolidating) {
      return {
        memoriesProcessed: 0,
        memoriesConsolidated: 0,
        memoriesPruned: 0,
        connectionsStrengthened: 0,
        newAbstractions: [],
        duration: 0,
      };
    }

    this.isConsolidating = true;
    const startTime = Date.now();

    const result: ConsolidationResult = {
      memoriesProcessed: 0,
      memoriesConsolidated: 0,
      memoriesPruned: 0,
      connectionsStrengthened: 0,
      newAbstractions: [],
      duration: 0,
    };

    try {
      // 1. Process short-term memories for consolidation
      const shortTermMemories = Array.from(store.memories.values()).filter(
        (m) => m.layer === MemoryLayer.SHORT_TERM && !m.isConsolidated
      );

      for (const stm of shortTermMemories) {
        result.memoriesProcessed++;

        // Check if memory should be promoted to long-term
        const importance = this.assessForConsolidation(stm);

        if (importance > 0.6) {
          // Promote to long-term
          this.promoteToLongTerm(stm, store);
          result.memoriesConsolidated++;
        } else if (importance < 0.3 && stm.accessCount < 2) {
          // Prune low-importance, rarely accessed memories
          store.updateMemory(stm.id, { isArchived: true });
          result.memoriesPruned++;
        }

        // Mark as processed
        store.updateMemory(stm.id, { isConsolidated: true });
      }

      // 2. Strengthen frequently co-activated connections
      const strengthened = this.strengthenConnections(graph, store);
      result.connectionsStrengthened = strengthened;

      // 3. Create abstractions from related memories
      const abstractions = this.createAbstractions(store, graph, embedding);
      result.newAbstractions = abstractions;

      // 4. Decay old activations
      graph.decayActivations();

      // 5. Prune weak graph connections
      graph.pruneWeakConnections(0.05);

      // 6. Re-cluster the graph
      graph.detectCommunities();

      this.lastConsolidation = Date.now();
      result.duration = Date.now() - startTime;
    } finally {
      this.isConsolidating = false;
    }

    return result;
  }

  /**
   * Assess memory for consolidation
   */
  private assessForConsolidation(memory: MemoryEntry): number {
    let score = 0;

    // Access frequency
    score += Math.min(memory.accessCount / 10, 0.3);

    // Salience
    score += memory.salience * 0.3;

    // Recency of access
    const hoursSinceAccess = (Date.now() - memory.lastAccessedAt) / 3600000;
    if (hoursSinceAccess < 1) score += 0.2;
    else if (hoursSinceAccess < 24) score += 0.1;

    // User modifications
    if (memory.userModified) score += 0.2;

    // Pinned memories always consolidate
    if (memory.isPinned) score = 1.0;

    return Math.min(score, 1.0);
  }

  /**
   * Promote short-term memory to long-term
   */
  private promoteToLongTerm(memory: MemoryEntry, store: ReturnType<typeof useMemoryStore.getState>): void {
    const stm = memory as ShortTermMemory;

    // Create long-term memory
    store.addMemory({
      layer: MemoryLayer.LONG_TERM,
      content: memory.content,
      salience: memory.salience,
      decayRate: memory.decayRate / 10, // Slower decay for LTM
      tags: [...memory.tags, 'consolidated'],
      relatedMemories: [...memory.relatedMemories, memory.id],
      importance: this.assessForConsolidation(memory),
      reinforcementCount: 1,
      sourceMemories: [memory.id],
      abstracted: false,
    } as any);
  }

  /**
   * Strengthen frequently co-activated connections
   */
  private strengthenConnections(
    graph: MemoryGraph,
    store: ReturnType<typeof useMemoryStore.getState>
  ): number {
    let strengthened = 0;

    // Find memories accessed together
    const recentAccess = Array.from(store.memories.values())
      .filter((m) => Date.now() - m.lastAccessedAt < 3600000) // Last hour
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    // Create/strengthen edges for temporally co-accessed memories
    for (let i = 0; i < recentAccess.length - 1; i++) {
      for (let j = i + 1; j < Math.min(i + 5, recentAccess.length); j++) {
        const timeDiff = recentAccess[j].lastAccessedAt - recentAccess[i].lastAccessedAt;
        if (timeDiff < 60000) {
          // Within 1 minute
          graph.addEdge(recentAccess[i].id, recentAccess[j].id, 'temporal', 0.5);
          strengthened++;
        }
      }
    }

    return strengthened;
  }

  /**
   * Create abstractions from clusters of related memories
   */
  private createAbstractions(
    store: ReturnType<typeof useMemoryStore.getState>,
    graph: MemoryGraph,
    embedding: AdvancedEmbedding
  ): string[] {
    const abstractions: string[] = [];

    // Get clusters
    const clusters = graph.detectCommunities();

    clusters.forEach((memberIds, clusterId) => {
      if (memberIds.size < 3) return; // Need at least 3 members

      // Get memories in cluster
      const members = Array.from(memberIds)
        .map((id) => store.memories.get(id))
        .filter(Boolean) as MemoryEntry[];

      // Check if cluster already has an abstraction
      const hasAbstraction = members.some(
        (m) => m.layer === MemoryLayer.LONG_TERM && (m as any).abstracted
      );
      if (hasAbstraction) return;

      // Find common themes
      const allTags = members.flatMap((m) => m.tags);
      const tagCounts = new Map<string, number>();
      allTags.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });

      // Get most common tags
      const commonTags = Array.from(tagCounts.entries())
        .filter(([_, count]) => count >= memberIds.size * 0.5)
        .map(([tag]) => tag);

      if (commonTags.length > 0) {
        // Create abstraction
        const abstractionContent = `Abstract concept: ${commonTags.join(', ')}. Related to ${memberIds.size} memories.`;

        const abstractionId = store.addMemory({
          layer: MemoryLayer.LONG_TERM,
          content: abstractionContent,
          salience: 0.8,
          decayRate: 0.001,
          tags: [...commonTags, 'abstraction'],
          relatedMemories: Array.from(memberIds),
          importance: 0.7,
          reinforcementCount: memberIds.size,
          sourceMemories: Array.from(memberIds),
          abstracted: true,
        } as any);

        // Add to embedding system
        embedding.addDocument(abstractionContent);

        // Connect abstraction to cluster members
        memberIds.forEach((memberId) => {
          graph.addEdge(abstractionId, memberId, 'semantic', 0.8);
        });

        abstractions.push(abstractionContent);
      }
    });

    return abstractions;
  }
}

// ============================================================================
// TEMPORAL REASONING
// ============================================================================

class TemporalReasoning {
  /**
   * Calculate temporal decay for a memory
   */
  calculateDecay(memory: MemoryEntry): number {
    const now = Date.now();
    const age = now - memory.createdAt;
    const timeSinceAccess = now - memory.lastAccessedAt;

    // Ebbinghaus forgetting curve approximation
    const retentionStrength = memory.accessCount + 1;
    const halfLife = memory.decayRate * 86400000 * retentionStrength; // Base decay rate in days

    const decayFactor = Math.pow(0.5, timeSinceAccess / halfLife);

    // Adjust for salience
    const salienceBoost = 1 + memory.salience * 0.5;

    return Math.min(decayFactor * salienceBoost, 1.0);
  }

  /**
   * Find memories from a time period
   */
  findMemoriesInPeriod(
    store: ReturnType<typeof useMemoryStore.getState>,
    start: number,
    end: number
  ): MemoryEntry[] {
    return Array.from(store.memories.values()).filter(
      (m) => m.createdAt >= start && m.createdAt <= end && !m.isArchived
    );
  }

  /**
   * Reconstruct event sequence
   */
  reconstructEventSequence(
    store: ReturnType<typeof useMemoryStore.getState>,
    topic: string,
    embedding: AdvancedEmbedding
  ): Array<{ memory: MemoryEntry; timestamp: number; relevance: number }> {
    const memories = Array.from(store.memories.values());
    const sequence: Array<{ memory: MemoryEntry; timestamp: number; relevance: number }> = [];

    for (const memory of memories) {
      if (memory.isArchived) continue;

      // Calculate relevance to topic
      const docId = memories.indexOf(memory);
      const relevance = embedding.combinedSimilarity(topic, docId);

      if (relevance > 0.3) {
        sequence.push({
          memory,
          timestamp: memory.createdAt,
          relevance,
        });
      }
    }

    // Sort by timestamp
    sequence.sort((a, b) => a.timestamp - b.timestamp);

    return sequence;
  }

  /**
   * Infer causal relationships
   */
  inferCausalRelationships(
    graph: MemoryGraph,
    store: ReturnType<typeof useMemoryStore.getState>
  ): Array<{ cause: string; effect: string; confidence: number }> {
    const relationships: Array<{ cause: string; effect: string; confidence: number }> = [];
    const memories = Array.from(store.memories.values());

    // Look for temporal patterns
    for (let i = 0; i < memories.length - 1; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const earlier = memories[i];
        const later = memories[j];

        // Check temporal order
        if (earlier.createdAt >= later.createdAt) continue;

        // Check if they're related in the graph
        const path = graph.findPath(earlier.id, later.id);
        if (!path || path.length > 3) continue;

        // Calculate causal confidence based on factors
        let confidence = 0.3; // Base confidence

        // Time proximity increases confidence
        const timeDiff = later.createdAt - earlier.createdAt;
        if (timeDiff < 3600000) confidence += 0.2; // Within 1 hour
        if (timeDiff < 86400000) confidence += 0.1; // Within 1 day

        // Shared tags increase confidence
        const sharedTags = earlier.tags.filter((t) => later.tags.includes(t));
        confidence += sharedTags.length * 0.1;

        // Graph proximity increases confidence
        confidence += (3 - path.length) * 0.1;

        if (confidence > 0.5) {
          relationships.push({
            cause: earlier.id,
            effect: later.id,
            confidence: Math.min(confidence, 1.0),
          });

          // Add causal edge to graph
          graph.addEdge(earlier.id, later.id, 'causal', confidence, false);
        }
      }
    }

    return relationships;
  }
}

// ============================================================================
// META-MEMORY SYSTEM
// ============================================================================

class MetaMemorySystem {
  private stats: MetaMemoryStats = {
    totalMemories: 0,
    byLayer: {} as Record<MemoryLayer, number>,
    avgSalience: 0,
    avgAccessCount: 0,
    consolidationCycles: 0,
    retrievalAccuracy: 0,
    graphDensity: 0,
    clusterCount: 0,
  };

  private retrievalHistory: Array<{
    query: string;
    results: number;
    timestamp: number;
    userSatisfied?: boolean;
  }> = [];

  private adaptiveParams = {
    similarityThreshold: 0.3,
    maxRetrievalResults: 10,
    consolidationInterval: 3600000,
    activationSpreadDepth: 3,
  };

  /**
   * Update statistics
   */
  updateStats(
    store: ReturnType<typeof useMemoryStore.getState>,
    graph: MemoryGraph
  ): MetaMemoryStats {
    const memories = Array.from(store.memories.values()).filter((m) => !m.isArchived);

    this.stats.totalMemories = memories.length;

    // Count by layer
    this.stats.byLayer = {} as Record<MemoryLayer, number>;
    for (const layer of Object.values(MemoryLayer)) {
      this.stats.byLayer[layer] = memories.filter((m) => m.layer === layer).length;
    }

    // Calculate averages
    if (memories.length > 0) {
      this.stats.avgSalience =
        memories.reduce((sum, m) => sum + m.salience, 0) / memories.length;
      this.stats.avgAccessCount =
        memories.reduce((sum, m) => sum + m.accessCount, 0) / memories.length;
    }

    // Graph stats
    const graphStats = graph.getStats();
    this.stats.graphDensity = graphStats.density;

    // Cluster count
    const clusters = graph.detectCommunities();
    this.stats.clusterCount = clusters.size;

    return this.stats;
  }

  /**
   * Record retrieval for learning
   */
  recordRetrieval(query: string, resultCount: number, satisfied?: boolean): void {
    this.retrievalHistory.push({
      query,
      results: resultCount,
      timestamp: Date.now(),
      userSatisfied: satisfied,
    });

    // Keep last 100 retrievals
    if (this.retrievalHistory.length > 100) {
      this.retrievalHistory.shift();
    }

    // Update retrieval accuracy if we have feedback
    if (satisfied !== undefined) {
      const recentWithFeedback = this.retrievalHistory.filter(
        (r) => r.userSatisfied !== undefined
      );
      if (recentWithFeedback.length > 0) {
        this.stats.retrievalAccuracy =
          recentWithFeedback.filter((r) => r.userSatisfied).length /
          recentWithFeedback.length;
      }
    }
  }

  /**
   * Adapt parameters based on performance
   */
  adaptParameters(): void {
    // Adapt similarity threshold based on retrieval results
    const avgResults =
      this.retrievalHistory.reduce((sum, r) => sum + r.results, 0) /
      (this.retrievalHistory.length || 1);

    if (avgResults < 3) {
      // Too few results - lower threshold
      this.adaptiveParams.similarityThreshold = Math.max(
        0.1,
        this.adaptiveParams.similarityThreshold - 0.05
      );
    } else if (avgResults > 15) {
      // Too many results - raise threshold
      this.adaptiveParams.similarityThreshold = Math.min(
        0.5,
        this.adaptiveParams.similarityThreshold + 0.05
      );
    }

    // Adapt based on retrieval accuracy
    if (this.stats.retrievalAccuracy < 0.5) {
      // Poor accuracy - increase activation spread
      this.adaptiveParams.activationSpreadDepth = Math.min(
        5,
        this.adaptiveParams.activationSpreadDepth + 1
      );
    }
  }

  /**
   * Get adaptive parameters
   */
  getAdaptiveParams(): typeof this.adaptiveParams {
    return { ...this.adaptiveParams };
  }

  /**
   * Get memory health assessment
   */
  assessHealth(): {
    overall: 'healthy' | 'warning' | 'critical';
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check memory count
    if (this.stats.totalMemories === 0) {
      issues.push('No memories stored');
      recommendations.push('Start conversations to build memory');
    }

    // Check layer distribution
    const shortTermCount = this.stats.byLayer[MemoryLayer.SHORT_TERM] || 0;
    const longTermCount = this.stats.byLayer[MemoryLayer.LONG_TERM] || 0;

    if (shortTermCount > longTermCount * 10) {
      issues.push('Too many unconsolidated short-term memories');
      recommendations.push('Run consolidation cycle');
    }

    // Check graph connectivity
    if (this.stats.graphDensity < 0.01 && this.stats.totalMemories > 10) {
      issues.push('Memory graph is too sparse');
      recommendations.push('Build more connections between memories');
    }

    // Check retrieval accuracy
    if (this.stats.retrievalAccuracy < 0.5 && this.retrievalHistory.length > 10) {
      issues.push('Low retrieval accuracy');
      recommendations.push('Review and update memory embeddings');
    }

    // Determine overall health
    let overall: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (issues.length >= 3) overall = 'critical';
    else if (issues.length >= 1) overall = 'warning';

    return { overall, issues, recommendations };
  }

  /**
   * Create meta-memory entry
   */
  createMetaMemory(
    store: ReturnType<typeof useMemoryStore.getState>
  ): string {
    const health = this.assessHealth();

    return store.addMemory({
      layer: MemoryLayer.META,
      content: `Memory system status: ${health.overall}. ${this.stats.totalMemories} memories across ${this.stats.clusterCount} clusters.`,
      memoryAboutId: 'system',
      confidenceLevel: this.stats.retrievalAccuracy,
      learningProgress: this.stats.consolidationCycles,
      adaptations: Object.entries(this.adaptiveParams).map(([param, value]) => ({
        parameter: param,
        reason: 'Auto-adapted based on performance',
        previousValue: 0,
        newValue: value as number,
        timestamp: Date.now(),
      })),
      systemInsights: health.recommendations,
      salience: 0.5,
      decayRate: 0.1,
      tags: ['meta', 'system-status'],
      relatedMemories: [],
    } as any);
  }
}

// ============================================================================
// MEMORY SERVICE CLASS
// ============================================================================

class MemoryService {
  private embedding: AdvancedEmbedding;
  private graph: MemoryGraph;
  private conflictResolver: ConflictResolver;
  private consolidationEngine: ConsolidationEngine;
  private temporalReasoning: TemporalReasoning;
  private metaMemory: MetaMemorySystem;
  private entityCache: Map<string, string> = new Map();
  private memoryIdToDocId: Map<string, number> = new Map();
  private docIdCounter: number = 0;
  private retrievalCache: Map<string, { results: Array<{ memory: MemoryEntry; similarity: number }>; timestamp: number }> = new Map();
  private cacheExpiry: number = 60000; // 1 minute

  constructor() {
    this.embedding = new AdvancedEmbedding();
    this.graph = new MemoryGraph();
    this.conflictResolver = new ConflictResolver();
    this.consolidationEngine = new ConsolidationEngine();
    this.temporalReasoning = new TemporalReasoning();
    this.metaMemory = new MetaMemorySystem();
    this.initializeFromStore();
  }

  /**
   * Initialize from existing memories
   */
  private initializeFromStore(): void {
    try {
      const store = useMemoryStore.getState();
      if (!store.memories || store.memories.size === 0) return;
      store.memories.forEach((memory) => {
        try {
          if (!memory?.content || typeof memory.content !== 'string') return;
          const docId = this.docIdCounter++;
          this.embedding.addDocument(memory.content, docId);
          this.memoryIdToDocId.set(memory.id, docId);
          this.graph.addNode(memory.id);

          // Add edges for related memories
          if (Array.isArray(memory.relatedMemories)) {
            memory.relatedMemories.forEach((relatedId) => {
              this.graph.addEdge(memory.id, relatedId, 'reference');
            });
          }
        } catch (e) {
          console.warn('[MemoryService] Skipping corrupt memory entry:', memory?.id, e);
        }
      });

      // Initial clustering
      this.graph.detectCommunities();
    } catch (e) {
      console.warn('[MemoryService] initializeFromStore failed, starting fresh:', e);
    }
  }

  /**
   * Index a newly added memory so semantic search can find it
   */
  indexMemory(memoryId: string, content: string): void {
    const docId = this.docIdCounter++;
    this.embedding.addDocument(content, docId);
    this.memoryIdToDocId.set(memoryId, docId);
    this.graph.addNode(memoryId);
  }

  // ==========================================================================
  // MEMORY FORMATION
  // ==========================================================================

  /**
   * Form memories from a conversation exchange
   */
  async formMemoriesFromConversation(
    userMessage: Message,
    assistantMessage: Message,
    conversationId: string
  ): Promise<MemoryFormationResult> {
    const result: MemoryFormationResult = {
      memoriesCreated: [],
      factsExtracted: [],
      entitiesMentioned: [],
      skillsLearned: [],
      connectionsFormed: 0,
      consolidationTriggered: false,
    };

    const store = useMemoryStore.getState();
    const userText = this.extractText(userMessage.content);
    const assistantText = this.extractText(assistantMessage.content);
    const combinedText = `${userText}\n${assistantText}`;

    // Add to embedding corpus
    const docId = this.docIdCounter++;
    this.embedding.addDocument(combinedText, docId);

    // 1. Create short-term memory
    const shortTermId = this.createShortTermMemory(
      combinedText,
      conversationId,
      [userMessage.id, assistantMessage.id]
    );
    result.memoriesCreated.push(shortTermId);
    this.memoryIdToDocId.set(shortTermId, docId);

    // Add to graph
    this.graph.addNode(shortTermId);

    // 2. Extract and store facts (semantic memory)
    const facts = this.extractFacts(combinedText);
    for (const fact of facts) {
      const factId = this.createSemanticMemory(fact);
      result.memoriesCreated.push(factId);
      result.factsExtracted.push(fact.content);

      // Check for conflicts
      const existingMemories = Array.from(store.memories.values());
      const conflicts = this.conflictResolver.detectConflicts(existingMemories, store.memories.get(factId)!);
      for (const conflict of conflicts) {
        this.conflictResolver.resolve(conflict, store);
      }

      // Add to graph and connect to short-term
      this.graph.addNode(factId);
      this.graph.addEdge(shortTermId, factId, 'semantic');
      result.connectionsFormed++;

      // Add to embeddings
      const factDocId = this.docIdCounter++;
      this.embedding.addDocument(fact.content, factDocId);
      this.memoryIdToDocId.set(factId, factDocId);
    }

    // 3. Identify and update entities (relational memory)
    const entities = this.extractEntities(combinedText);
    for (const entity of entities) {
      const entityId = this.updateOrCreateEntity(entity);
      result.memoriesCreated.push(entityId);
      result.entitiesMentioned.push(entity.name);

      // Connect entity to short-term and related facts
      this.graph.addNode(entityId);
      this.graph.addEdge(shortTermId, entityId, 'entity');
      result.connectionsFormed++;

      // Connect entity to facts that mention it
      for (const factId of result.memoriesCreated) {
        const factMemory = store.memories.get(factId);
        if (typeof factMemory?.content === 'string' && factMemory.content.toLowerCase().includes(entity.name.toLowerCase())) {
          this.graph.addEdge(entityId, factId, 'entity');
          result.connectionsFormed++;
        }
      }
    }

    // 4. Check for skill learning (procedural memory)
    const skills = this.extractSkills(userText, assistantText);
    for (const skill of skills) {
      const skillId = this.createProceduralMemory(skill);
      result.memoriesCreated.push(skillId);
      result.skillsLearned.push(skill.name);

      // Connect to short-term
      this.graph.addNode(skillId);
      this.graph.addEdge(shortTermId, skillId, 'procedural');
      result.connectionsFormed++;
    }

    // 5. Create episodic memory for significant exchanges
    const importance = this.assessImportance(combinedText);
    if (importance.score > 0.6) {
      const episodicId = this.createEpisodicMemory(
        userText,
        assistantText,
        importance
      );
      result.memoriesCreated.push(episodicId);

      // Connect episodic to all created memories
      this.graph.addNode(episodicId);
      for (const memId of result.memoriesCreated) {
        if (memId !== episodicId) {
          this.graph.addEdge(episodicId, memId, 'temporal');
          result.connectionsFormed++;
        }
      }
    }

    // 6. Use activation spreading to find related existing memories
    const activations = this.graph.activate(shortTermId, 1.0, 3);
    activations.forEach((activation, memoryId) => {
      if (activation > 0.3 && !result.memoriesCreated.includes(memoryId)) {
        // Strengthen connection to highly activated existing memories
        this.graph.addEdge(shortTermId, memoryId, 'semantic', activation);
        result.connectionsFormed++;
      }
    });

    // 7. Check if consolidation needed
    if (this.consolidationEngine.shouldConsolidate()) {
      await this.consolidationEngine.consolidate(store, this.graph, this.embedding);
      result.consolidationTriggered = true;
    }

    // 8. Update meta-memory stats
    this.metaMemory.updateStats(store, this.graph);

    // Clear retrieval cache
    this.retrievalCache.clear();

    return result;
  }

  /**
   * Create a short-term memory
   */
  private createShortTermMemory(
    content: string,
    conversationId: string,
    messageIds: string[]
  ): string {
    const store = useMemoryStore.getState();

    return store.addMemory({
      layer: MemoryLayer.SHORT_TERM,
      content,
      salience: 0.7,
      decayRate: 0.1,
      tags: ['conversation'],
      relatedMemories: [],
      conversationId,
      messageIds,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    } as any);
  }

  /**
   * Create a semantic (fact) memory
   */
  private createSemanticMemory(fact: {
    subject: string;
    predicate: string;
    object: string;
    content: string;
    confidence?: number;
  }): string {
    const store = useMemoryStore.getState();

    return store.addMemory({
      layer: MemoryLayer.SEMANTIC,
      content: fact.content,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      confidence: fact.confidence || 0.8,
      sources: ['conversation'],
      verified: false,
      salience: 0.6,
      decayRate: 0.01,
      tags: ['fact', 'auto-extracted'],
      relatedMemories: [],
    } as any);
  }

  /**
   * Create or update an entity (relational memory)
   */
  private updateOrCreateEntity(entity: {
    name: string;
    type: EntityType;
    attributes: Record<string, unknown>;
  }): string {
    const store = useMemoryStore.getState();

    const existingId = this.entityCache.get(entity.name.toLowerCase());
    if (existingId) {
      const existing = store.memories.get(existingId) as RelationalMemory;
      if (existing) {
        const newAttributes = new Map(existing.attributes);
        Object.entries(entity.attributes).forEach(([k, v]) => {
          newAttributes.set(k, v);
        });

        store.updateMemory(existingId, {
          attributes: newAttributes,
          interactionFrequency: existing.interactionFrequency + 1,
          lastInteraction: Date.now(),
        });

        return existingId;
      }
    }

    const id = store.addMemory({
      layer: MemoryLayer.RELATIONAL,
      content: `Entity: ${entity.name} (${entity.type})`,
      entityId: nanoid(),
      entityType: entity.type,
      entityName: entity.name,
      attributes: new Map(Object.entries(entity.attributes)),
      interactionFrequency: 1,
      lastInteraction: Date.now(),
      preferences: new Map(),
      boundaries: [],
      trustLevel: 0.5,
      salience: 0.7,
      decayRate: 0.005,
      tags: ['entity', entity.type],
      relatedMemories: [],
    } as any);

    this.entityCache.set(entity.name.toLowerCase(), id);
    return id;
  }

  /**
   * Create a procedural (skill) memory
   */
  private createProceduralMemory(skill: {
    name: string;
    type: SkillType;
    steps: Array<{ order: number; action: string }>;
  }): string {
    const store = useMemoryStore.getState();

    return store.addMemory({
      layer: MemoryLayer.PROCEDURAL,
      content: `Skill: ${skill.name}`,
      skillName: skill.name,
      skillType: skill.type,
      steps: skill.steps,
      successRate: 1,
      averageExecutionTime: 0,
      timesExecuted: 0,
      learnedFrom: ['conversation'],
      refinements: [],
      salience: 0.8,
      decayRate: 0.005,
      tags: ['skill', skill.type],
      relatedMemories: [],
    } as any);
  }

  /**
   * Create an episodic memory for significant events
   */
  private createEpisodicMemory(
    userText: string,
    assistantText: string,
    importance: MemoryImportance
  ): string {
    const store = useMemoryStore.getState();

    return store.addMemory({
      layer: MemoryLayer.EPISODIC,
      content: `User: ${userText.slice(0, 300)}...\nAssistant: ${assistantText.slice(0, 300)}...`,
      eventDescription: 'Significant conversation exchange',
      eventTimestamp: Date.now(),
      participants: ['user', 'assistant'],
      outcome: importance.score > 0.8 ? 'Highly relevant exchange' : 'Notable exchange',
      narrativePosition: Date.now(),
      salience: importance.score,
      decayRate: 0.02,
      tags: ['episode', 'conversation'],
      relatedMemories: [],
    } as any);
  }

  // ==========================================================================
  // EXTRACTION METHODS
  // ==========================================================================

  /**
   * Extract facts from text with confidence scoring
   */
  private extractFacts(text: string): Array<{
    subject: string;
    predicate: string;
    object: string;
    content: string;
    confidence: number;
  }> {
    const facts: Array<{
      subject: string;
      predicate: string;
      object: string;
      content: string;
      confidence: number;
    }> = [];

    // Pattern: "X is Y" facts
    const isPattern = /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*)\s+is\s+(?:a|an|the)?\s*([^.!?,]+)/gi;
    let match;
    while ((match = isPattern.exec(text)) !== null) {
      const subject = match[1].trim();
      const object = match[2].trim();
      if (subject.length > 2 && object.length > 2) {
        facts.push({
          subject,
          predicate: 'is',
          object,
          content: `${subject} is ${object}`,
          confidence: 0.7,
        });
      }
    }

    // Pattern: "X has Y" facts
    const hasPattern = /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*)\s+has\s+(?:a|an|the)?\s*([^.!?,]+)/gi;
    while ((match = hasPattern.exec(text)) !== null) {
      const subject = match[1].trim();
      const object = match[2].trim();
      if (subject.length > 2 && object.length > 2) {
        facts.push({
          subject,
          predicate: 'has',
          object,
          content: `${subject} has ${object}`,
          confidence: 0.7,
        });
      }
    }

    // Pattern: "X works at/for Y"
    const worksPattern = /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*)\s+works?\s+(?:at|for)\s+([^.!?,]+)/gi;
    while ((match = worksPattern.exec(text)) !== null) {
      facts.push({
        subject: match[1].trim(),
        predicate: 'works_at',
        object: match[2].trim(),
        content: `${match[1].trim()} works at ${match[2].trim()}`,
        confidence: 0.85,
      });
    }

    // Pattern: "X lives in Y"
    const livesPattern = /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*)\s+lives?\s+in\s+([^.!?,]+)/gi;
    while ((match = livesPattern.exec(text)) !== null) {
      facts.push({
        subject: match[1].trim(),
        predicate: 'lives_in',
        object: match[2].trim(),
        content: `${match[1].trim()} lives in ${match[2].trim()}`,
        confidence: 0.85,
      });
    }

    // Pattern: "X likes/loves/prefers Y"
    const preferencePattern = /\b([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*)\s+(likes?|loves?|prefers?)\s+([^.!?,]+)/gi;
    while ((match = preferencePattern.exec(text)) !== null) {
      facts.push({
        subject: match[1].trim(),
        predicate: 'prefers',
        object: match[3].trim(),
        content: `${match[1].trim()} ${match[2]} ${match[3].trim()}`,
        confidence: 0.75,
      });
    }

    // Deduplicate and limit
    const seen = new Set<string>();
    return facts
      .filter((fact) => {
        const key = `${fact.subject}:${fact.predicate}:${fact.object}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  }

  /**
   * Extract entities from text
   */
  private extractEntities(text: string): Array<{
    name: string;
    type: EntityType;
    attributes: Record<string, unknown>;
  }> {
    if (!text || typeof text !== 'string') return [];
    const entities: Array<{
      name: string;
      type: EntityType;
      attributes: Record<string, unknown>;
    }> = [];

    const seen = new Set<string>();

    // Named entity patterns
    const patterns = [
      // Person names (two capitalized words)
      { regex: /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g, type: EntityType.USER },
      // Organizations (capitalized words followed by Inc, Corp, etc.)
      { regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Inc|Corp|LLC|Ltd|Company)/gi, type: EntityType.ORGANIZATION },
      // Projects (Project X, X Project)
      { regex: /\b(?:Project\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:project|app|application)/gi, type: EntityType.PROJECT },
      // Single capitalized words as potential entities
      { regex: /\b([A-Z][a-z]{2,})\b/g, type: EntityType.CONCEPT },
    ];

    for (const { regex, type } of patterns) {
      let match;
      while ((match = regex.exec(text)) !== null) {
        const name = match[1].trim();
        const lower = name.toLowerCase();

        // Skip common words
        const commonWords = new Set([
          'the', 'this', 'that', 'here', 'there', 'when', 'what', 'where',
          'which', 'who', 'why', 'how', 'monday', 'tuesday', 'wednesday',
          'thursday', 'friday', 'saturday', 'sunday', 'january', 'february',
          'march', 'april', 'may', 'june', 'july', 'august', 'september',
          'october', 'november', 'december', 'today', 'tomorrow', 'yesterday',
        ]);

        if (commonWords.has(lower) || seen.has(lower)) continue;
        seen.add(lower);

        // Refine type based on context
        let finalType = type;
        if (text.toLowerCase().includes(`${lower} said`) ||
            text.toLowerCase().includes(`${lower}'s `) ||
            text.toLowerCase().includes(`${lower} is my`)) {
          finalType = EntityType.USER;
        }

        entities.push({
          name,
          type: finalType,
          attributes: {
            mentionedIn: 'conversation',
            firstMentioned: Date.now(),
          },
        });
      }
    }

    return entities.slice(0, 10);
  }

  /**
   * Extract skills/patterns from conversation
   */
  private extractSkills(
    userText: string,
    assistantText: string
  ): Array<{
    name: string;
    type: SkillType;
    steps: Array<{ order: number; action: string }>;
  }> {
    const skills: Array<{
      name: string;
      type: SkillType;
      steps: Array<{ order: number; action: string }>;
    }> = [];

    // Look for numbered steps
    const numberedSteps = assistantText.match(/(?:^|\n)\s*\d+[\.\)]\s*([^\n]+)/g);
    if (numberedSteps && numberedSteps.length >= 3) {
      skills.push({
        name: 'Numbered procedure',
        type: SkillType.WORKFLOW,
        steps: numberedSteps.map((step, i) => ({
          order: i + 1,
          action: step.replace(/^\s*\d+[\.\)]\s*/, '').trim(),
        })),
      });
    }

    // Look for step-by-step instructions
    const stepPattern = /(?:step\s*\d+|first|second|third|fourth|fifth|then|next|finally|lastly)[:\s]+([^.!?\n]+)/gi;
    const steps: string[] = [];
    let match;
    while ((match = stepPattern.exec(assistantText)) !== null) {
      steps.push(match[1].trim());
    }

    if (steps.length >= 3) {
      skills.push({
        name: 'Step-by-step procedure',
        type: SkillType.WORKFLOW,
        steps: steps.map((action, i) => ({ order: i + 1, action })),
      });
    }

    // Look for code patterns
    const codeBlocks = assistantText.match(/```[\w]*\n[\s\S]*?```/g);
    if (codeBlocks && codeBlocks.length > 0) {
      skills.push({
        name: 'Code pattern',
        type: SkillType.CODE_PATTERN,
        steps: codeBlocks.map((block, i) => ({
          order: i + 1,
          action: `Code block: ${block.slice(3, 50)}...`,
        })),
      });
    }

    // Look for "How to" patterns
    const howToMatch = assistantText.match(/how to ([^:.\n]+)/i);
    if (howToMatch) {
      skills.push({
        name: `How to ${howToMatch[1]}`,
        type: SkillType.WORKFLOW,
        steps: [{ order: 1, action: 'Tutorial provided in conversation' }],
      });
    }

    return skills.slice(0, 3);
  }

  /**
   * Assess importance of content
   */
  private assessImportance(text: string): MemoryImportance {
    if (!text || typeof text !== 'string') {
      return { score: 0.5, factors: { emotionalIntensity: 0, novelty: 0.5, relevanceToGoals: 0.5, frequency: 0, userEmphasis: 0, temporalProximity: 1.0, semanticCentrality: 0.5 } };
    }
    const factors = {
      emotionalIntensity: 0,
      novelty: 0.5,
      relevanceToGoals: 0.5,
      frequency: 0,
      userEmphasis: 0,
      temporalProximity: 1.0, // Recent is always 1.0
      semanticCentrality: 0.5,
    };

    const lowerText = text.toLowerCase();

    // Emotional intensity
    const positiveWords = ['love', 'amazing', 'excited', 'wonderful', 'fantastic', 'great', 'happy', 'joy'];
    const negativeWords = ['hate', 'terrible', 'worried', 'anxious', 'frustrated', 'angry', 'sad', 'awful'];
    const urgentWords = ['urgent', 'important', 'critical', 'asap', 'immediately', 'emergency', 'deadline'];

    const positiveCount = positiveWords.filter((w) => lowerText.includes(w)).length;
    const negativeCount = negativeWords.filter((w) => lowerText.includes(w)).length;
    const urgentCount = urgentWords.filter((w) => lowerText.includes(w)).length;

    factors.emotionalIntensity = Math.min(
      (positiveCount + negativeCount + urgentCount * 2) / 10,
      1
    );

    // User emphasis
    factors.userEmphasis = Math.min(
      (text.match(/!/g) || []).length / 5 +
      (text.match(/\?{2,}/g) || []).length / 3 +
      (lowerText.includes('remember') ? 0.3 : 0) +
      (lowerText.includes('important') ? 0.3 : 0) +
      (lowerText.includes('don\'t forget') ? 0.4 : 0),
      1
    );

    // Relevance to goals (check for goal-related keywords)
    const goalWords = ['want', 'need', 'goal', 'plan', 'will', 'going to', 'intend', 'hope', 'wish'];
    factors.relevanceToGoals = Math.min(
      goalWords.filter((w) => lowerText.includes(w)).length / 5,
      1
    );

    // Calculate weighted score
    const weights = {
      emotionalIntensity: 0.2,
      novelty: 0.15,
      relevanceToGoals: 0.2,
      frequency: 0.1,
      userEmphasis: 0.2,
      temporalProximity: 0.05,
      semanticCentrality: 0.1,
    };

    const score = Object.entries(factors).reduce(
      (sum, [key, value]) => sum + value * weights[key as keyof typeof weights],
      0
    );

    return { score, factors };
  }

  // ==========================================================================
  // SEMANTIC SEARCH
  // ==========================================================================

  /**
   * Search memories using combined similarity methods
   */
  semanticSearch(
    query: string,
    options?: {
      layers?: MemoryLayer[];
      limit?: number;
      minSimilarity?: number;
      useActivation?: boolean;
      boostRecent?: boolean;
    }
  ): Array<{ memory: MemoryEntry; similarity: number; metrics?: RetrievalMetrics }> {
    const startTime = Date.now();
    const store = useMemoryStore.getState();
    const params = this.metaMemory.getAdaptiveParams();

    // Check cache
    const cacheKey = `${query}-${JSON.stringify(options)}`;
    const cached = this.retrievalCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      this.metaMemory.recordRetrieval(query, cached.results.length);
      return cached.results;
    }

    const minSim = options?.minSimilarity ?? params.similarityThreshold;
    const limit = options?.limit ?? params.maxRetrievalResults;

    // Use activation spreading if enabled
    let activations = new Map<string, number>();
    if (options?.useActivation) {
      // Find most similar memory to start activation from
      const similar = this.embedding.findSimilar(query, 3);
      for (const { docId, score } of similar) {
        // Find memory ID from doc ID
        for (const [memId, dId] of this.memoryIdToDocId.entries()) {
          if (dId === docId) {
            const spread = this.graph.activate(memId, score, params.activationSpreadDepth);
            spread.forEach((activation, id) => {
              activations.set(id, Math.max(activations.get(id) || 0, activation));
            });
            break;
          }
        }
      }
    }

    const results: Array<{ memory: MemoryEntry; similarity: number }> = [];
    let memoriesScanned = 0;

    store.memories.forEach((memory) => {
      memoriesScanned++;

      // Skip archived memories
      if (memory.isArchived) return;

      // Filter by layer
      if (options?.layers && !options.layers.includes(memory.layer)) return;

      // Get document ID
      const docId = this.memoryIdToDocId.get(memory.id);
      if (docId === undefined) return;

      // Calculate combined similarity
      let similarity = this.embedding.combinedSimilarity(query, docId);

      // Apply temporal decay
      const decay = this.temporalReasoning.calculateDecay(memory);
      similarity *= decay;

      // Apply activation boost
      if (options?.useActivation && activations.has(memory.id)) {
        similarity = similarity * 0.7 + activations.get(memory.id)! * 0.3;
      }

      // Boost recent memories
      if (options?.boostRecent) {
        const hoursSinceCreation = (Date.now() - memory.createdAt) / 3600000;
        if (hoursSinceCreation < 24) {
          similarity *= 1 + (24 - hoursSinceCreation) / 48;
        }
      }

      // Boost high-salience memories
      similarity *= 1 + memory.salience * 0.2;

      if (similarity >= minSim) {
        results.push({ memory, similarity });
      }
    });

    // Sort by similarity
    results.sort((a, b) => b.similarity - a.similarity);

    // Limit results
    const limited = results.slice(0, limit);

    // Update access counts for retrieved memories
    for (const { memory } of limited) {
      store.updateMemory(memory.id, { lastAccessedAt: Date.now(), accessCount: (memory.accessCount || 0) + 1 });
    }

    // Cache results
    this.retrievalCache.set(cacheKey, { results: limited, timestamp: Date.now() });

    // Record retrieval for meta-memory
    this.metaMemory.recordRetrieval(query, limited.length);

    return limited;
  }

  // ==========================================================================
  // CONTEXT BUILDING
  // ==========================================================================

  /**
   * Build comprehensive context for a conversation
   */
  buildConversationContext(
    conversationId: string,
    currentQuery: string,
    tokenBudget: number = 4000
  ): ConversationContext {
    const store = useMemoryStore.getState();

    // 1. Get recent short-term memories from this conversation
    const recentMemories = store
      .retrieveMemories({
        layers: [MemoryLayer.SHORT_TERM],
        sortBy: 'recency',
        limit: 5,
      })
      .map((r) => r.memory);

    // 2. Semantic search with activation spreading
    const semanticResults = this.semanticSearch(currentQuery, {
      layers: [MemoryLayer.LONG_TERM, MemoryLayer.SEMANTIC, MemoryLayer.EPISODIC],
      limit: 15,
      minSimilarity: 0.2,
      useActivation: true,
      boostRecent: true,
    });

    // 3. Get relevant entities
    const entityMemories = store
      .retrieveMemories({
        layers: [MemoryLayer.RELATIONAL],
        sortBy: 'access_count',
        limit: 5,
      })
      .map((r) => r.memory);

    // 4. Get relevant procedures
    const proceduralMemories = store
      .retrieveMemories({
        layers: [MemoryLayer.PROCEDURAL],
        sortBy: 'salience',
        limit: 3,
      })
      .map((r) => r.memory);

    // 5. Infer facts using graph traversal
    const inferredFacts = this.inferFacts(currentQuery);

    // Combine and deduplicate
    const allMemories = new Map<string, MemoryEntry>();
    const attentionWeights = new Map<string, number>();

    recentMemories.forEach((m) => {
      allMemories.set(m.id, m);
      attentionWeights.set(m.id, 0.9); // Recent memories get high attention
    });

    semanticResults.forEach(({ memory, similarity }) => {
      if (!allMemories.has(memory.id)) {
        allMemories.set(memory.id, memory);
      }
      attentionWeights.set(memory.id, Math.max(attentionWeights.get(memory.id) || 0, similarity));
    });

    entityMemories.forEach((m) => {
      if (!allMemories.has(m.id)) {
        allMemories.set(m.id, m);
        attentionWeights.set(m.id, 0.6);
      }
    });

    proceduralMemories.forEach((m) => {
      if (!allMemories.has(m.id)) {
        allMemories.set(m.id, m);
        attentionWeights.set(m.id, 0.5);
      }
    });

    // Sort by attention weight
    const sortedMemories = Array.from(allMemories.values()).sort((a, b) => {
      const aWeight = attentionWeights.get(a.id) || 0;
      const bWeight = attentionWeights.get(b.id) || 0;
      return bWeight - aWeight;
    });

    // Fit within token budget
    const relevantMemories: MemoryEntry[] = [];
    let tokensUsed = 0;

    for (const memory of sortedMemories) {
      const memoryTokens = Math.ceil(memory.content.length / 4);
      if (tokensUsed + memoryTokens <= tokenBudget) {
        relevantMemories.push(memory);
        tokensUsed += memoryTokens;
      } else {
        break;
      }
    }

    // Extract user preferences
    const userPreferences: Record<string, unknown> = {};
    entityMemories
      .filter((m) => (m as RelationalMemory).entityType === EntityType.USER)
      .forEach((m) => {
        const relational = m as RelationalMemory;
        relational.preferences?.forEach((value, key) => {
          userPreferences[key] = value;
        });
      });

    // Extract previous topics
    const previousTopics = recentMemories
      .flatMap((m) => m.tags)
      .filter((tag, i, arr) => arr.indexOf(tag) === i)
      .slice(0, 10);

    return {
      relevantMemories,
      userPreferences,
      previousTopics,
      inferredFacts,
      attentionWeights,
      tokenBudget,
      tokensUsed,
    };
  }

  /**
   * Infer facts using graph traversal
   */
  private inferFacts(query: string): string[] {
    const inferred: string[] = [];
    const store = useMemoryStore.getState();

    // Find semantically similar memories
    const similar = this.semanticSearch(query, { limit: 5, minSimilarity: 0.4 });

    for (const { memory } of similar) {
      // Get neighbors in graph
      const neighbors = this.graph.getNeighbors(memory.id, 2);

      for (const neighborId of neighbors) {
        const neighbor = store.memories.get(neighborId);
        if (!neighbor) continue;

        // Check for inference patterns
        if (neighbor.layer === MemoryLayer.SEMANTIC) {
          const semantic = neighbor as SemanticMemory;

          // If A is related to B, and B is X, then A might be related to X
          const path = this.graph.findPath(memory.id, neighborId);
          if (path && path.length === 2) {
            inferred.push(`Inferred: ${semantic.content} (via ${memory.content.slice(0, 50)})`);
          }
        }
      }
    }

    return inferred.slice(0, 5);
  }

  /**
   * Format context for system prompt
   */
  formatContextForPrompt(context: ConversationContext): string {
    if (context.relevantMemories.length === 0) {
      return '';
    }

    const sections: string[] = ['## Relevant Context from Memory\n'];

    // Group by layer
    const byLayer = new Map<MemoryLayer, MemoryEntry[]>();
    context.relevantMemories.forEach((m) => {
      if (!byLayer.has(m.layer)) {
        byLayer.set(m.layer, []);
      }
      byLayer.get(m.layer)!.push(m);
    });

    // Format each layer with attention indicators
    const layerOrder = [
      MemoryLayer.SHORT_TERM,
      MemoryLayer.LONG_TERM,
      MemoryLayer.SEMANTIC,
      MemoryLayer.RELATIONAL,
      MemoryLayer.EPISODIC,
      MemoryLayer.PROCEDURAL,
    ];

    for (const layer of layerOrder) {
      const memories = byLayer.get(layer);
      if (!memories || memories.length === 0) continue;

      const layerName = layer.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      sections.push(`### ${layerName}\n`);

      memories.forEach((m) => {
        const attention = context.attentionWeights.get(m.id) || 0;
        const indicator = attention > 0.8 ? '⭐' : attention > 0.5 ? '•' : '◦';
        sections.push(`${indicator} ${m.content.slice(0, 250)}${m.content.length > 250 ? '...' : ''}`);
      });

      sections.push('');
    }

    // Add user preferences
    if (Object.keys(context.userPreferences).length > 0) {
      sections.push('### User Preferences\n');
      Object.entries(context.userPreferences).forEach(([key, value]) => {
        sections.push(`- ${key}: ${value}`);
      });
      sections.push('');
    }

    // Add inferred facts
    if (context.inferredFacts.length > 0) {
      sections.push('### Inferred Context\n');
      context.inferredFacts.forEach((fact) => {
        sections.push(`- ${fact}`);
      });
      sections.push('');
    }

    return sections.join('\n');
  }

  // ==========================================================================
  // WORKING MEMORY
  // ==========================================================================

  /**
   * Create working memory for an active task
   */
  createWorkingMemory(
    taskId: string,
    taskType: string,
    initialVariables: Record<string, unknown> = {}
  ): string {
    const store = useMemoryStore.getState();

    const id = store.addMemory({
      layer: MemoryLayer.WORKING,
      content: `Working memory for task: ${taskType}`,
      taskId,
      taskType,
      variables: new Map(Object.entries(initialVariables)),
      reasoningSteps: [],
      currentStep: 0,
      hypotheses: [],
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      salience: 1,
      decayRate: 0,
      tags: ['working', taskType],
      relatedMemories: [],
    } as any);

    // Add to graph with connections to relevant memories
    this.graph.addNode(id);

    // Find related memories and connect
    const related = this.semanticSearch(taskType, { limit: 5 });
    for (const { memory } of related) {
      this.graph.addEdge(id, memory.id, 'reference');
    }

    return id;
  }

  /**
   * Update working memory with a reasoning step
   */
  addReasoningStep(
    workingMemoryId: string,
    step: {
      thought: string;
      action?: string;
      observation?: string;
      conclusion?: string;
    }
  ): void {
    const store = useMemoryStore.getState();
    const memory = store.memories.get(workingMemoryId) as WorkingMemory;

    if (memory && memory.layer === MemoryLayer.WORKING) {
      const reasoningSteps = [
        ...memory.reasoningSteps,
        {
          step: memory.reasoningSteps.length + 1,
          ...step,
        },
      ];

      store.updateMemory(workingMemoryId, {
        reasoningSteps,
        currentStep: reasoningSteps.length,
      });

      // Activate related memories based on reasoning content
      const activationQuery = step.thought + (step.observation || '');
      this.graph.activate(workingMemoryId, 0.5, 2);
    }
  }

  /**
   * Add hypothesis to working memory
   */
  addHypothesis(
    workingMemoryId: string,
    hypothesis: {
      content: string;
      confidence: number;
      evidence: string[];
    }
  ): void {
    const store = useMemoryStore.getState();
    const memory = store.memories.get(workingMemoryId) as WorkingMemory;

    if (memory && memory.layer === MemoryLayer.WORKING) {
      store.updateMemory(workingMemoryId, {
        hypotheses: [...memory.hypotheses, hypothesis],
      });
    }
  }

  // ==========================================================================
  // CONSOLIDATION & MAINTENANCE
  // ==========================================================================

  /**
   * Manually trigger consolidation
   */
  async triggerConsolidation(): Promise<ConsolidationResult> {
    const store = useMemoryStore.getState();
    return this.consolidationEngine.consolidate(store, this.graph, this.embedding);
  }

  /**
   * Get memory system health
   */
  getSystemHealth(): ReturnType<typeof MetaMemorySystem.prototype.assessHealth> {
    return this.metaMemory.assessHealth();
  }

  /**
   * Get system statistics
   */
  getStats(): MetaMemoryStats {
    const store = useMemoryStore.getState();
    return this.metaMemory.updateStats(store, this.graph);
  }

  /**
   * Get graph statistics
   */
  getGraphStats(): ReturnType<typeof MemoryGraph.prototype.getStats> {
    return this.graph.getStats();
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Extract text from content blocks
   */
  private extractText(content: ContentBlock[]): string {
    return content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('\n');
  }

  /**
   * Boost salience for accessed memories
   */
  boostSalience(memoryIds: string[], amount: number = 0.1): void {
    const store = useMemoryStore.getState();
    memoryIds.forEach((id) => {
      store.updateSalience(id, amount);

      // Also boost in graph
      this.graph.activate(id, amount, 1);
    });
  }

  /**
   * Find path between memories
   */
  findMemoryPath(sourceId: string, targetId: string): string[] | null {
    return this.graph.findPath(sourceId, targetId);
  }

  /**
   * Get memory neighbors
   */
  getMemoryNeighbors(memoryId: string, depth: number = 1): string[] {
    return Array.from(this.graph.getNeighbors(memoryId, depth));
  }

  /**
   * Reconstruct timeline for a topic
   */
  getTimeline(topic: string): Array<{ memory: MemoryEntry; timestamp: number; relevance: number }> {
    const store = useMemoryStore.getState();
    return this.temporalReasoning.reconstructEventSequence(store, topic, this.embedding);
  }

  /**
   * Infer causal relationships
   */
  getCausalRelationships(): Array<{ cause: string; effect: string; confidence: number }> {
    const store = useMemoryStore.getState();
    return this.temporalReasoning.inferCausalRelationships(this.graph, store);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const memoryService = new MemoryService();

// ============================================================================
// REACT HOOK
// ============================================================================

import { useCallback, useMemo } from 'react';

export function useMemoryService() {
  const store = useMemoryStore();

  const searchMemories = useCallback(
    (query: string, options?: Parameters<typeof memoryService.semanticSearch>[1]) => {
      return memoryService.semanticSearch(query, options);
    },
    []
  );

  const buildContext = useCallback(
    (conversationId: string, query: string, tokenBudget?: number) => {
      return memoryService.buildConversationContext(conversationId, query, tokenBudget);
    },
    []
  );

  const formMemories = useCallback(
    async (userMessage: Message, assistantMessage: Message, conversationId: string) => {
      return memoryService.formMemoriesFromConversation(
        userMessage,
        assistantMessage,
        conversationId
      );
    },
    []
  );

  const getHealth = useCallback(() => {
    return memoryService.getSystemHealth();
  }, []);

  const getStats = useCallback(() => {
    return memoryService.getStats();
  }, []);

  const triggerConsolidation = useCallback(async () => {
    return memoryService.triggerConsolidation();
  }, []);

  return {
    ...store,
    searchMemories,
    buildContext,
    formMemories,
    getHealth,
    getStats,
    triggerConsolidation,
    service: memoryService,
  };
}
