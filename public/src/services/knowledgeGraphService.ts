/**
 * Knowledge Graph Service - Entity extraction and graph construction from memories
 */

import { nanoid } from 'nanoid';
import { embeddingService } from './embeddingService';

export interface KGNode {
  id: string;
  label: string;
  type: 'person' | 'concept' | 'tool' | 'file' | 'event' | 'topic' | 'skill' | 'project';
  weight: number;
  properties: Record<string, string>;
  memoryIds: string[];
  color?: string;
}

export interface KGEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight: number;
  type: 'related_to' | 'uses' | 'created_by' | 'part_of' | 'depends_on' | 'similar_to' | 'mentioned_with';
}

export interface KnowledgeGraph {
  nodes: KGNode[];
  edges: KGEdge[];
  metadata: {
    nodeCount: number;
    edgeCount: number;
    createdAt: number;
    lastUpdated: number;
  };
}

const NODE_TYPE_COLORS: Record<KGNode['type'], string> = {
  person: '#f472b6',
  concept: '#60a5fa',
  tool: '#34d399',
  file: '#fbbf24',
  event: '#a78bfa',
  topic: '#fb923c',
  skill: '#2dd4bf',
  project: '#f87171',
};

// Patterns for entity extraction
const ENTITY_PATTERNS: Array<{ pattern: RegExp; type: KGNode['type'] }> = [
  { pattern: /(?:using|with|via|through)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g, type: 'tool' },
  { pattern: /(?:file|path|module)\s+["`']?([a-zA-Z][\w./\\-]+\.\w+)["`']?/gi, type: 'file' },
  { pattern: /(?:project|repo|repository)\s+["`']?([A-Z][\w-]+)["`']?/gi, type: 'project' },
  { pattern: /(?:learned|know|understand|skill)\s+(?:about\s+)?([a-z][\w\s]{2,30})/gi, type: 'skill' },
];

class KnowledgeGraphService {
  /**
   * Extract entities from text
   */
  extractEntities(text: string, memoryId: string): KGNode[] {
    const entities: KGNode[] = [];
    const seen = new Set<string>();

    // Pattern-based extraction
    ENTITY_PATTERNS.forEach(({ pattern, type }) => {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        const label = match[1]!.trim();
        const key = `${type}:${label.toLowerCase()}`;
        if (!seen.has(key) && label.length > 1 && label.length < 50) {
          seen.add(key);
          entities.push({
            id: nanoid(),
            label,
            type,
            weight: 1,
            properties: {},
            memoryIds: [memoryId],
            color: NODE_TYPE_COLORS[type],
          });
        }
      }
    });

    // Extract capitalized noun phrases as concepts
    const conceptPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
    let match;
    while ((match = conceptPattern.exec(text)) !== null) {
      const label = match[1]!.trim();
      const key = `concept:${label.toLowerCase()}`;
      if (!seen.has(key) && label.length > 3) {
        seen.add(key);
        entities.push({
          id: nanoid(),
          label,
          type: 'concept',
          weight: 1,
          properties: {},
          memoryIds: [memoryId],
          color: NODE_TYPE_COLORS.concept,
        });
      }
    }

    // Extract topics from key phrases
    const topicPattern = /(?:about|regarding|concerning|related to)\s+([a-z][\w\s]{3,25})/gi;
    while ((match = topicPattern.exec(text)) !== null) {
      const label = match[1]!.trim();
      const key = `topic:${label.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({
          id: nanoid(),
          label,
          type: 'topic',
          weight: 1,
          properties: {},
          memoryIds: [memoryId],
          color: NODE_TYPE_COLORS.topic,
        });
      }
    }

    return entities;
  }

  /**
   * Build a knowledge graph from memories
   */
  buildKnowledgeGraph(
    memories: Array<{ id: string; content: string; tags: string[]; layer: string; salience: number }>
  ): KnowledgeGraph {
    const nodeMap = new Map<string, KGNode>();
    const edges: KGEdge[] = [];

    // Add all memory content to embedding service corpus
    embeddingService.addDocuments(memories.map(m => m.content));

    // Extract entities from each memory
    memories.forEach(memory => {
      const entities = this.extractEntities(memory.content, memory.id);

      entities.forEach(entity => {
        const key = `${entity.type}:${entity.label.toLowerCase()}`;
        const existing = nodeMap.get(key);
        if (existing) {
          existing.weight += 1;
          if (!existing.memoryIds.includes(memory.id)) {
            existing.memoryIds.push(memory.id);
          }
        } else {
          nodeMap.set(key, entity);
        }
      });

      // Add tag-based nodes
      memory.tags.forEach(tag => {
        const key = `topic:${tag.toLowerCase()}`;
        const existing = nodeMap.get(key);
        if (existing) {
          existing.weight += 0.5;
          if (!existing.memoryIds.includes(memory.id)) {
            existing.memoryIds.push(memory.id);
          }
        } else {
          nodeMap.set(key, {
            id: nanoid(),
            label: tag,
            type: 'topic',
            weight: 1,
            properties: { source: 'tag' },
            memoryIds: [memory.id],
            color: NODE_TYPE_COLORS.topic,
          });
        }
      });
    });

    const nodes = Array.from(nodeMap.values());

    // Build edges based on co-occurrence in memories
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const sharedMemories = nodes[i]!.memoryIds.filter(id => nodes[j]!.memoryIds.includes(id));
        if (sharedMemories.length > 0) {
          edges.push({
            id: nanoid(),
            source: nodes[i]!.id,
            target: nodes[j]!.id,
            label: 'mentioned_with',
            weight: sharedMemories.length,
            type: 'mentioned_with',
          });
        }
      }
    }

    // Add semantic similarity edges
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const sim = embeddingService.cosineSimilarity(nodes[i]!.label, nodes[j]!.label);
        if (sim > 0.3) {
          const existingEdge = edges.find(e =>
            (e.source === nodes[i]!.id && e.target === nodes[j]!.id) ||
            (e.source === nodes[j]!.id && e.target === nodes[i]!.id)
          );
          if (!existingEdge) {
            edges.push({
              id: nanoid(),
              source: nodes[i]!.id,
              target: nodes[j]!.id,
              label: 'similar_to',
              weight: sim,
              type: 'similar_to',
            });
          }
        }
      }
    }

    return {
      nodes,
      edges,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
      },
    };
  }

  /**
   * Query the graph for nodes related to a query
   */
  queryGraph(graph: KnowledgeGraph, query: string, maxResults: number = 10): KGNode[] {
    const candidates = graph.nodes.map(node => ({
      node,
      score: embeddingService.cosineSimilarity(query, node.label) * node.weight,
    }));

    return candidates
      .filter(c => c.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(c => c.node);
  }
}

export const knowledgeGraphService = new KnowledgeGraphService();
