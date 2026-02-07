/**
 * KnowledgeGraph3D - Force-directed graph visualization for knowledge graphs
 * Uses CSS-based rendering with force simulation
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import type { KnowledgeGraph, KGNode } from '../../services/knowledgeGraphService';

interface KnowledgeGraph3DProps {
  graph: KnowledgeGraph;
  onNodeClick?: (node: KGNode) => void;
  width?: number;
  height?: number;
}

interface SimNode extends KGNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number;
  fy?: number;
}

const TYPE_COLORS: Record<string, string> = {
  person: '#f472b6',
  concept: '#60a5fa',
  tool: '#34d399',
  file: '#fbbf24',
  event: '#a78bfa',
  topic: '#fb923c',
  skill: '#2dd4bf',
  project: '#f87171',
};

export const KnowledgeGraph3D: React.FC<KnowledgeGraph3DProps> = ({
  graph,
  onNodeClick,
  width = 600,
  height = 400,
}) => {
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const animFrameRef = useRef<number>(0);

  // Initialize node positions
  useEffect(() => {
    const simNodes: SimNode[] = graph.nodes.map((node, i) => {
      const angle = (i / graph.nodes.length) * Math.PI * 2;
      const radius = 100 + Math.random() * 100;
      return {
        ...node,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    setNodes(simNodes);
  }, [graph.nodes, width, height]);

  // Force simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    const simulate = () => {
      setNodes(prev => {
        const next = prev.map(n => ({ ...n }));
        const centerX = width / 2;
        const centerY = height / 2;

        // Apply forces
        for (let i = 0; i < next.length; i++) {
          const nodeI = next[i]!;
          if (nodeI.fx !== undefined) continue;

          let fx = 0, fy = 0;

          // Center gravity
          fx += (centerX - nodeI.x) * 0.001;
          fy += (centerY - nodeI.y) * 0.001;

          // Node repulsion
          for (let j = 0; j < next.length; j++) {
            if (i === j) continue;
            const nodeJ = next[j]!;
            const dx = nodeI.x - nodeJ.x;
            const dy = nodeI.y - nodeJ.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = 500 / (d * d);
            fx += (dx / d) * force;
            fy += (dy / d) * force;
          }

          // Edge attraction
          graph.edges.forEach(edge => {
            const isSource = edge.source === nodeI.id;
            const isTarget = edge.target === nodeI.id;
            if (!isSource && !isTarget) return;

            const other = next.find(n => n.id === (isSource ? edge.target : edge.source));
            if (!other) return;

            const dx = other.x - nodeI.x;
            const dy = other.y - nodeI.y;
            fx += dx * 0.005 * edge.weight;
            fy += dy * 0.005 * edge.weight;
          });

          // Apply velocity with damping
          nodeI.vx = (nodeI.vx + fx) * 0.9;
          nodeI.vy = (nodeI.vy + fy) * 0.9;
          nodeI.x += nodeI.vx;
          nodeI.y += nodeI.vy;

          // Boundary constraints
          nodeI.x = Math.max(20, Math.min(width - 20, nodeI.x));
          nodeI.y = Math.max(20, Math.min(height - 20, nodeI.y));
        }

        return next;
      });

      animFrameRef.current = requestAnimationFrame(simulate);
    };

    animFrameRef.current = requestAnimationFrame(simulate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [nodes.length, graph.edges, width, height]);

  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (searchQuery) {
      result = result.filter(n => n.label.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (selectedType) {
      result = result.filter(n => n.type === selectedType);
    }
    return result;
  }, [nodes, searchQuery, selectedType]);

  const filteredNodeIds = new Set(filteredNodes.map(n => n.id));

  const visibleEdges = useMemo(() => {
    return graph.edges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target));
  }, [graph.edges, filteredNodeIds]);

  const nodeTypes = useMemo(() => {
    const types = new Set(graph.nodes.map(n => n.type));
    return Array.from(types);
  }, [graph.nodes]);

  const getNodePos = useCallback((id: string) => {
    return nodes.find(n => n.id === id);
  }, [nodes]);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="w-full pl-8 pr-3 py-1.5 bg-background-tertiary border border-border-primary rounded-lg text-xs text-text-primary placeholder:text-text-tertiary"
          />
        </div>
        <div className="flex gap-1">
          {nodeTypes.map(type => (
            <button
              key={type}
              onClick={() => setSelectedType(selectedType === type ? null : type)}
              className={`px-2 py-1 rounded text-[10px] transition-colors ${
                selectedType === type
                  ? 'text-white'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
              style={{
                backgroundColor: selectedType === type ? TYPE_COLORS[type] : 'transparent',
                border: `1px solid ${TYPE_COLORS[type]}40`,
              }}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Graph SVG */}
      <div className="relative bg-background-tertiary rounded-xl overflow-hidden border border-border-primary">
        <svg width={width} height={height} className="block">
          {/* Edges */}
          {visibleEdges.map(edge => {
            const source = getNodePos(edge.source);
            const target = getNodePos(edge.target);
            if (!source || !target) return null;

            const isHighlighted = hoveredNode === edge.source || hoveredNode === edge.target;

            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={isHighlighted ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}
                strokeWidth={Math.max(1, edge.weight * (isHighlighted ? 2 : 1))}
              />
            );
          })}

          {/* Nodes */}
          {filteredNodes.map(node => {
            const isHovered = hoveredNode === node.id;
            const size = Math.max(6, Math.min(20, node.weight * 4 + 6));
            const color = TYPE_COLORS[node.type] || '#888';

            return (
              <g key={node.id}>
                {/* Glow */}
                {isHovered && (
                  <circle cx={node.x} cy={node.y} r={size + 8} fill={`${color}20`} />
                )}
                {/* Node */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={size}
                  fill={color}
                  opacity={isHovered ? 1 : 0.7}
                  stroke={isHovered ? 'white' : 'none'}
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => onNodeClick?.(node)}
                />
                {/* Label */}
                {(isHovered || node.weight >= 3) && (
                  <text
                    x={node.x}
                    y={node.y - size - 5}
                    textAnchor="middle"
                    fill="white"
                    fontSize={isHovered ? 12 : 10}
                    fontWeight={isHovered ? 'bold' : 'normal'}
                    opacity={isHovered ? 1 : 0.6}
                  >
                    {node.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Stats overlay */}
        <div className="absolute bottom-2 left-2 text-[10px] text-text-tertiary bg-background-primary/80 px-2 py-1 rounded">
          {graph.metadata.nodeCount} nodes · {graph.metadata.edgeCount} edges
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-[10px] text-text-tertiary">
        {nodeTypes.map(type => (
          <span key={type} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TYPE_COLORS[type] }} />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
};

export default KnowledgeGraph3D;
