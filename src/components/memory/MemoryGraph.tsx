/**
 * Memory Graph - Interactive Knowledge Graph Visualization
 *
 * Displays memories as nodes in an interactive graph with relationships.
 * Uses SVG for rendering with force-directed layout simulation.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  ArrowsPointingOutIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

// Store
import { useMemoryStore } from '@store/memoryStore';

// Types
import { MemoryLayer } from '../../types/memory';
import type { MemoryGraph as MemoryGraphType, MemoryNode, MemoryEdge } from '../../types/memory';

// ============================================================================
// LAYER COLORS
// ============================================================================

const LAYER_COLORS: Record<MemoryLayer, string> = {
  [MemoryLayer.SHORT_TERM]: '#3b82f6',
  [MemoryLayer.LONG_TERM]: '#8b5cf6',
  [MemoryLayer.SEMANTIC]: '#10b981',
  [MemoryLayer.RELATIONAL]: '#f59e0b',
  [MemoryLayer.PROCEDURAL]: '#ec4899',
  [MemoryLayer.WORKING]: '#6366f1',
  [MemoryLayer.EPISODIC]: '#14b8a6',
  [MemoryLayer.META]: '#a855f7',
};

// ============================================================================
// MEMORY GRAPH COMPONENT
// ============================================================================

interface MemoryGraphProps {
  onSelectMemory: (id: string) => void;
}

export function MemoryGraph({ onSelectMemory }: MemoryGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Store state
  const graph = useMemoryStore((state) => state.graph);
  const buildGraph = useMemoryStore((state) => state.buildGraph);

  // Local state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(
    new Map()
  );

  // Initialize node positions with force-directed layout
  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;

    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;
    const centerX = width / 2;
    const centerY = height / 2;

    // Simple force-directed layout simulation
    const positions = new Map<string, { x: number; y: number }>();

    // Initialize positions randomly
    graph.nodes.forEach((node) => {
      positions.set(node.id, {
        x: centerX + (Math.random() - 0.5) * width * 0.6,
        y: centerY + (Math.random() - 0.5) * height * 0.6,
      });
    });

    // Simple force simulation (a few iterations)
    const iterations = 100;
    const repulsionForce = 5000;
    const attractionForce = 0.01;

    for (let i = 0; i < iterations; i++) {
      // Repulsion between all nodes
      graph.nodes.forEach((nodeA) => {
        graph.nodes.forEach((nodeB) => {
          if (nodeA.id === nodeB.id) return;

          const posA = positions.get(nodeA.id)!;
          const posB = positions.get(nodeB.id)!;
          const dx = posA.x - posB.x;
          const dy = posA.y - posB.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;

          const force = repulsionForce / (distance * distance);
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;

          posA.x += fx * 0.01;
          posA.y += fy * 0.01;
        });
      });

      // Attraction along edges
      graph.edges.forEach((edge) => {
        const posSource = positions.get(edge.source);
        const posTarget = positions.get(edge.target);
        if (!posSource || !posTarget) return;

        const dx = posTarget.x - posSource.x;
        const dy = posTarget.y - posSource.y;

        posSource.x += dx * attractionForce;
        posSource.y += dy * attractionForce;
        posTarget.x -= dx * attractionForce;
        posTarget.y -= dy * attractionForce;
      });

      // Keep nodes in bounds
      positions.forEach((pos) => {
        pos.x = Math.max(50, Math.min(width - 50, pos.x));
        pos.y = Math.max(50, Math.min(height - 50, pos.y));
      });
    }

    setNodePositions(positions);
  }, [graph]);

  // Handle zoom
  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.max(0.1, Math.min(3, prev + delta)));
  };

  // Handle pan start
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  // Handle pan move
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  // Handle pan end
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Reset view
  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Refresh graph
  const refreshGraph = async () => {
    await buildGraph();
  };

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-background-tertiary">
          <ArrowPathIcon className="h-8 w-8 text-text-tertiary" />
        </div>
        <h3 className="mb-2 font-semibold text-text-primary">No Graph Data</h3>
        <p className="mb-4 text-sm text-text-tertiary">
          Create some memories to see the knowledge graph
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-background-primary">
      {/* Controls */}
      <div className="absolute right-4 top-4 z-10 flex flex-col gap-2">
        <button
          onClick={() => handleZoom(0.2)}
          className="rounded-lg bg-background-secondary p-2 text-text-primary shadow-lg hover:bg-background-hover"
        >
          <MagnifyingGlassPlusIcon className="h-5 w-5" />
        </button>
        <button
          onClick={() => handleZoom(-0.2)}
          className="rounded-lg bg-background-secondary p-2 text-text-primary shadow-lg hover:bg-background-hover"
        >
          <MagnifyingGlassMinusIcon className="h-5 w-5" />
        </button>
        <button
          onClick={resetView}
          className="rounded-lg bg-background-secondary p-2 text-text-primary shadow-lg hover:bg-background-hover"
        >
          <ArrowsPointingOutIcon className="h-5 w-5" />
        </button>
        <button
          onClick={refreshGraph}
          className="rounded-lg bg-background-secondary p-2 text-text-primary shadow-lg hover:bg-background-hover"
        >
          <ArrowPathIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Stats */}
      <div className="absolute left-4 top-4 z-10 rounded-lg bg-background-secondary/90 p-3 shadow-lg backdrop-blur-sm">
        <div className="text-xs text-text-tertiary">
          <p>{graph.nodes.length} nodes</p>
          <p>{graph.edges.length} connections</p>
          <p>Density: {(graph.density * 100).toFixed(1)}%</p>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 rounded-lg bg-background-secondary/90 p-3 shadow-lg backdrop-blur-sm">
        <p className="mb-2 text-xs font-medium text-text-primary">Memory Layers</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {Object.entries(LAYER_COLORS).map(([layer, color]) => (
            <div key={layer} className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-text-tertiary">
                {layer.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* SVG Graph */}
      <svg
        ref={svgRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {graph.edges.map((edge, i) => {
            const sourcePos = nodePositions.get(edge.source);
            const targetPos = nodePositions.get(edge.target);
            if (!sourcePos || !targetPos) return null;

            const isHighlighted =
              hoveredNode === edge.source || hoveredNode === edge.target;

            return (
              <line
                key={`edge-${i}`}
                x1={sourcePos.x}
                y1={sourcePos.y}
                x2={targetPos.x}
                y2={targetPos.y}
                stroke={isHighlighted ? '#6366f1' : '#374151'}
                strokeWidth={isHighlighted ? 2 : 1}
                strokeOpacity={isHighlighted ? 1 : 0.3}
              />
            );
          })}

          {/* Nodes */}
          {graph.nodes.map((node) => {
            const pos = nodePositions.get(node.id);
            if (!pos) return null;

            const isHovered = hoveredNode === node.id;
            const color = LAYER_COLORS[node.layer] || '#6366f1';

            return (
              <g
                key={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => onSelectMemory(node.memoryId)}
              >
                {/* Glow effect on hover */}
                {isHovered && (
                  <circle
                    r={node.size + 10}
                    fill={color}
                    fillOpacity={0.2}
                  />
                )}

                {/* Main node */}
                <circle
                  r={node.size}
                  fill={color}
                  stroke={isHovered ? '#fff' : 'none'}
                  strokeWidth={2}
                />

                {/* Label on hover */}
                {isHovered && (
                  <g>
                    <rect
                      x={node.size + 5}
                      y={-10}
                      width={node.label.length * 7 + 10}
                      height={20}
                      fill="#1f2937"
                      rx={4}
                    />
                    <text
                      x={node.size + 10}
                      y={4}
                      fill="#fff"
                      fontSize={12}
                    >
                      {node.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hovered Node Info */}
      {hoveredNode && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-4 right-4 z-10 max-w-xs rounded-lg bg-background-secondary p-4 shadow-xl"
        >
          {(() => {
            const node = graph.nodes.find((n) => n.id === hoveredNode);
            if (!node) return null;

            return (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <div
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: LAYER_COLORS[node.layer] }}
                  />
                  <span className="text-sm font-medium text-text-primary">
                    {node.layer.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm text-text-secondary">{node.label}</p>
                <div className="mt-2 text-xs text-text-tertiary">
                  <p>Connections: {node.degree}</p>
                  <p>Centrality: {(node.centrality * 100).toFixed(0)}%</p>
                </div>
              </>
            );
          })()}
        </motion.div>
      )}
    </div>
  );
}

export default MemoryGraph;
