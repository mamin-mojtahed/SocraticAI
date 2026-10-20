import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { TopicNode, TopicPairCloseness, AiDebugLog } from '../types';
import {
  Network,
  Zap,
  X,
  Activity,
  Info,
  Sparkles,
  TrendingUp,
  Clock,
  Target,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MousePointerClick,
  Cpu,
  Sliders,
  ArrowRight,
} from 'lucide-react';

interface DebugMatchViewProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: TopicNode[];
  pairs: TopicPairCloseness[];
  logs: AiDebugLog[];
  matchThreshold?: number;
  activeEmbeddingModel?: string;
  onTriggerEvaluation?: () => void;
  onSetMatchThreshold?: (threshold: number) => void;
}

interface Point {
  x: number;
  y: number;
}

interface PhysicsNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface NodeDimension {
  width: number;
  height: number;
  lines: string[];
}

export interface EnrichedPairLogPoint {
  log: AiDebugLog;
  personAId: string;
  personBId: string;
  personAName: string;
  personBName: string;
  personAColor: string;
  personBColor: string;
  topicA: string;
  topicB: string;
  stanceA: string;
  stanceB: string;
  prevTopicA?: string;
  prevTopicB?: string;
  topicAChanged: boolean;
  topicBChanged: boolean;
  anyTopicChanged: boolean;
  stanceChanged: boolean;
  scoreDelta: number;
}

// Distinct classical Greek palette for each two-person trajectory line
// (Notice: emerald green #10b981 is exclusively reserved for match threshold and >= threshold states)
const PAIR_PALETTE = [
  { stroke: '#f59e0b', fill: '#d97706', name: 'Antique Gold' },
  { stroke: '#38bdf8', fill: '#0284c7', name: 'Aegean Sky' },
  { stroke: '#c2593f', fill: '#9e4732', name: 'Terracotta' },
  { stroke: '#a855f7', fill: '#9333ea', name: 'Attic Violet' },
  { stroke: '#5c9e8f', fill: '#437a6d', name: 'Aegean Bronze' },
  { stroke: '#b87333', fill: '#8c5320', name: 'Burnished Copper' },
  { stroke: '#f43f5e', fill: '#e11d48', name: 'Delphi Rose' },
  { stroke: '#e6b86a', fill: '#c8963e', name: 'Attic Ochre' },
];

// Distinct color formatting palette to clearly identify and distinguish edges in dialogue graph
const EDGE_DISTINCT_PALETTE = [
  { stroke: '#38bdf8', fill: '#0284c7', name: 'Sky Cyan' },
  { stroke: '#f59e0b', fill: '#d97706', name: 'Warm Amber' },
  { stroke: '#a855f7', fill: '#9333ea', name: 'Attic Violet' },
  { stroke: '#fb7185', fill: '#e11d48', name: 'Delphi Rose' },
  { stroke: '#2dd4bf', fill: '#0d9488', name: 'Sea Teal' },
  { stroke: '#fb923c', fill: '#ea580c', name: 'Corinthian Coral' },
  { stroke: '#818cf8', fill: '#6366f1', name: 'Ionian Indigo' },
  { stroke: '#e6b86a', fill: '#c8963e', name: 'Attic Ochre' },
];

function extractPersonName(formatted: string): string {
  if (!formatted) return 'Visitor';
  const match = formatted.match(/^([^("]+)/);
  return match ? match[1].trim() : formatted.trim();
}

function extractTopicFromFormatted(formatted: string): string {
  if (!formatted) return 'Topic';
  const match = formatted.match(/\("(.+)"\)$/);
  return match ? match[1].trim() : formatted.trim();
}

/**
 * Canonical person-pair key: groups logs strictly by the TWO PERSONS involved,
 * so even when their topics or stances change over time, they stay on one trajectory line.
 */
function getPersonPairKey(log: AiDebugLog): string {
  if (log.pairKey) return log.pairKey;
  if (log.userAId && log.userBId) {
    return [log.userAId, log.userBId].sort().join('::');
  }
  const nameA = log.userAName || extractPersonName(log.userA || 'Visitor A');
  const nameB = log.userBName || extractPersonName(log.userB || 'Visitor B');
  return [nameA, nameB].sort().join('::');
}

// Word-wrap utility to format topic titles into multiple lines without truncation
function wrapTopicTitle(title: string, maxCharsPerLine = 20): string[] {
  if (!title) return ['No topic'];
  const words = title.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxCharsPerLine) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length > 3) {
    const firstTwo = lines.slice(0, 2);
    const rest = lines.slice(2).join(' ');
    firstTwo.push(rest);
    return firstTwo;
  }
  return lines;
}

export const DebugMatchView: React.FC<DebugMatchViewProps> = ({
  isOpen,
  onClose,
  nodes,
  pairs,
  logs,
  matchThreshold = 70,
  activeEmbeddingModel = 'gemini-embedding-2-preview',
  onTriggerEvaluation,
  onSetMatchThreshold,
}) => {
  const [activeTab, setActiveTab] = useState<'graph' | 'logs'>('graph');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredPairKey, setHoveredPairKey] = useState<string | null>(null);
  const [selectedPairKey, setSelectedPairKey] = useState<string | null>(null);

  // Expansion toggles for dense diagnostic instances
  const [isInstanceExpanded, setIsInstanceExpanded] = useState<boolean>(false);
  const [isGraphInstanceExpanded, setIsGraphInstanceExpanded] = useState<boolean>(false);

  // Floating & physics state
  const [isFloating] = useState<boolean>(true);
  const [displayPositions, setDisplayPositions] = useState<Record<string, Point>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  // Evaluation Logs line graph interaction state
  const [hoveredLogId, setHoveredLogId] = useState<string | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [lastHoveredLogId, setLastHoveredLogId] = useState<string | null>(null);

  // Multi-select connections state & X-axis timeline window state
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const seenUserIdsRef = useRef<Set<string>>(new Set());
  const isNoneSelectedModeRef = useRef<boolean>(false);
  const [timelineWindow, setTimelineWindow] = useState<{ startIdx: number; endIdx: number } | null>(
    null
  );
  const timelineBrushRef = useRef<HTMLDivElement>(null);

  // Resizable slider divider between Graph canvas and extra info pane
  const [extraInfoHeight, setExtraInfoHeight] = useState<number>(195);
  const [isDraggingDivider, setIsDraggingDivider] = useState<boolean>(false);
  const graphContainerRef = useRef<HTMLDivElement>(null);

  const handleGraphDividerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setIsDraggingDivider(true);

      const containerEl = graphContainerRef.current;
      if (!containerEl) return;

      const startClientY = e.clientY;
      const startHeight = extraInfoHeight;
      const containerRect = containerEl.getBoundingClientRect();

      const onPointerMove = (moveEvent: PointerEvent) => {
        // Dragging upward (negative deltaY) increases extra info pane height
        const deltaY = moveEvent.clientY - startClientY;
        const newHeight = startHeight - deltaY;

        // Ensure graph canvas retains at least 100px and extra info pane stays between 50px and containerRect.height - 100px
        const minHeight = 50;
        const maxHeight = Math.max(minHeight + 60, containerRect.height - 100);
        const clampedHeight = Math.max(minHeight, Math.min(maxHeight, Math.round(newHeight)));
        setExtraInfoHeight(clampedHeight);
      };

      const onPointerUp = () => {
        setIsDraggingDivider(false);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },
    [extraInfoHeight]
  );

  // Automatically empty and clean up selections when referenced nodes or pairs disconnect or are deleted
  useEffect(() => {
    if (selectedPairKey) {
      const exists = pairs.some(
        (p) =>
          p.pairKey === selectedPairKey &&
          nodes.some((n) => n.visitorId === p.userA.id) &&
          nodes.some((n) => n.visitorId === p.userB.id)
      );
      if (!exists) setSelectedPairKey(null);
    }
    if (hoveredPairKey) {
      const exists = pairs.some(
        (p) =>
          p.pairKey === hoveredPairKey &&
          nodes.some((n) => n.visitorId === p.userA.id) &&
          nodes.some((n) => n.visitorId === p.userB.id)
      );
      if (!exists) setHoveredPairKey(null);
    }
    if (hoveredNodeId) {
      const exists = nodes.some((n) => n.visitorId === hoveredNodeId);
      if (!exists) setHoveredNodeId(null);
    }
  }, [pairs, nodes, selectedPairKey, hoveredPairKey, hoveredNodeId]);

  useEffect(() => {
    const current = hoveredLogId || selectedLogId;
    if (current) {
      setLastHoveredLogId(current);
    }
  }, [hoveredLogId, selectedLogId]);

  const physicsNodesRef = useRef<Record<string, PhysicsNode>>({});
  const dragRef = useRef<{
    nodeId: string | null;
    currentSvgX: number;
    currentSvgY: number;
    offsetX: number;
    offsetY: number;
  }>({ nodeId: null, currentSvgX: 0, currentSvgY: 0, offsetX: 0, offsetY: 0 });

  const svgRef = useRef<SVGSVGElement>(null);

  const VIEW_WIDTH = 900;
  const VIEW_HEIGHT = 480;
  const CENTER_X = VIEW_WIDTH / 2;
  const CENTER_Y = VIEW_HEIGHT / 2 - 10;

  // Compute dynamic node card dimensions
  const nodeDimensions = useMemo<Record<string, NodeDimension>>(() => {
    const map: Record<string, NodeDimension> = {};
    nodes.forEach((node) => {
      const lines = wrapTopicTitle(node.topicTitle, 21);
      const longestLine = Math.max(...lines.map((l) => l.length), node.visitorName.length + 5);
      const width = Math.max(178, Math.min(265, Math.round(longestLine * 7.6 + 54)));
      const height = lines.length === 1 ? 68 : lines.length === 2 ? 84 : 100;
      map[node.visitorId] = { width, height, lines };
    });
    return map;
  }, [nodes]);

  // Compute default geometric layout
  const defaultPositions = useMemo(() => {
    const pos: Record<string, Point> = {};
    const count = nodes.length;

    if (count === 1) {
      pos[nodes[0].visitorId] = { x: CENTER_X, y: CENTER_Y };
    } else if (count === 2) {
      pos[nodes[0].visitorId] = { x: CENTER_X - 230, y: CENTER_Y };
      pos[nodes[1].visitorId] = { x: CENTER_X + 230, y: CENTER_Y };
    } else if (count === 3) {
      pos[nodes[0].visitorId] = { x: CENTER_X, y: CENTER_Y - 125 };
      pos[nodes[1].visitorId] = { x: CENTER_X - 240, y: CENTER_Y + 105 };
      pos[nodes[2].visitorId] = { x: CENTER_X + 240, y: CENTER_Y + 105 };
    } else if (count > 3) {
      const radiusX = Math.min(300, VIEW_WIDTH / 2 - 130);
      const radiusY = Math.min(160, VIEW_HEIGHT / 2 - 80);
      nodes.forEach((node, idx) => {
        const angle = (idx / count) * 2 * Math.PI - Math.PI / 2;
        pos[node.visitorId] = {
          x: Math.round(CENTER_X + radiusX * Math.cos(angle)),
          y: Math.round(CENTER_Y + radiusY * Math.sin(angle)),
        };
      });
    }

    return pos;
  }, [nodes, CENTER_X, CENTER_Y, VIEW_WIDTH, VIEW_HEIGHT]);

  useEffect(() => {
    const current = physicsNodesRef.current;
    const currentIds = new Set(nodes.map((n) => n.visitorId));

    nodes.forEach((node) => {
      if (!current[node.visitorId]) {
        const def = defaultPositions[node.visitorId] || { x: CENTER_X, y: CENTER_Y };
        current[node.visitorId] = {
          x: def.x,
          y: def.y,
          vx: 0,
          vy: 0,
        };
      }
    });

    Object.keys(current).forEach((id) => {
      if (!currentIds.has(id)) {
        delete current[id];
      }
    });

    const initialPos: Record<string, Point> = {};
    Object.entries(current).forEach(([id, p]) => {
      initialPos[id] = { x: p.x, y: p.y };
    });
    setDisplayPositions(initialPos);
  }, [nodes, defaultPositions, CENTER_X, CENTER_Y]);

  const floatParams = useMemo(() => {
    const params: Record<
      string,
      { freqX: number; freqY: number; phaseX: number; phaseY: number }
    > = {};

    nodes.forEach((node, idx) => {
      let hash = 0;
      for (let i = 0; i < node.visitorId.length; i++) {
        hash = (hash << 5) - hash + node.visitorId.charCodeAt(i);
        hash |= 0;
      }
      const seed = Math.abs(hash + idx * 787);
      params[node.visitorId] = {
        freqX: 0.0004 + (seed % 30) * 0.000005,
        freqY: 0.00035 + ((seed >> 2) % 30) * 0.000005,
        phaseX: (seed % 628) / 100,
        phaseY: ((seed >> 3) % 628) / 100,
      };
    });

    return params;
  }, [nodes]);

  const getSvgCoordinates = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const svg = svgRef.current;
      if (!svg) return null;

      const ctm = svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const svgP = pt.matrixTransform(ctm.inverse());
        return { x: svgP.x, y: svgP.y };
      }

      const rect = svg.getBoundingClientRect();
      const scaleX = VIEW_WIDTH / (rect.width || 1);
      const scaleY = VIEW_HEIGHT / (rect.height || 1);
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [VIEW_WIDTH, VIEW_HEIGHT]
  );

  const handlePointerDownNode = (e: React.PointerEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const svgP = getSvgCoordinates(e.clientX, e.clientY);
    if (!svgP) return;

    const currentP = physicsNodesRef.current[nodeId] || { x: CENTER_X, y: CENTER_Y, vx: 0, vy: 0 };

    dragRef.current = {
      nodeId,
      currentSvgX: currentP.x,
      currentSvgY: currentP.y,
      offsetX: svgP.x - currentP.x,
      offsetY: svgP.y - currentP.y,
    };

    setDraggingNodeId(nodeId);
  };

  useEffect(() => {
    if (!draggingNodeId) return;

    const handlePointerMove = (e: PointerEvent) => {
      const activeId = dragRef.current.nodeId;
      if (!activeId) return;

      const svgP = getSvgCoordinates(e.clientX, e.clientY);
      if (!svgP) return;

      const dim = nodeDimensions[activeId] || { width: 180, height: 68 };
      const halfW = dim.width / 2 + 12;
      const halfH = dim.height / 2 + 12;

      const newX = Math.max(halfW, Math.min(VIEW_WIDTH - halfW, svgP.x - dragRef.current.offsetX));
      const newY = Math.max(halfH, Math.min(VIEW_HEIGHT - halfH, svgP.y - dragRef.current.offsetY));

      dragRef.current.currentSvgX = newX;
      dragRef.current.currentSvgY = newY;

      if (physicsNodesRef.current[activeId]) {
        physicsNodesRef.current[activeId].x = newX;
        physicsNodesRef.current[activeId].y = newY;
        physicsNodesRef.current[activeId].vx = 0;
        physicsNodesRef.current[activeId].vy = 0;
      }
    };

    const handlePointerUp = () => {
      dragRef.current.nodeId = null;
      setDraggingNodeId(null);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [draggingNodeId, getSvgCoordinates, VIEW_WIDTH, VIEW_HEIGHT, nodeDimensions]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'graph') return;

    let animFrameId: number;

    const tick = (now: number) => {
      const pNodes = physicsNodesRef.current;
      const nodeIds = Object.keys(pNodes);

      if (nodeIds.length > 0) {
        const fx: Record<string, number> = {};
        const fy: Record<string, number> = {};

        nodeIds.forEach((id) => {
          fx[id] = 0;
          fy[id] = 0;
        });

        const REPULSION_RADIUS = 360;
        for (let i = 0; i < nodeIds.length; i++) {
          const idA = nodeIds[i];
          const nodeA = pNodes[idA];
          if (!nodeA) continue;
          const dimA = nodeDimensions[idA] || { width: 180, height: 68 };

          for (let j = i + 1; j < nodeIds.length; j++) {
            const idB = nodeIds[j];
            const nodeB = pNodes[idB];
            if (!nodeB) continue;
            const dimB = nodeDimensions[idB] || { width: 180, height: 68 };

            const dx = nodeA.x - nodeB.x;
            const dy = nodeA.y - nodeB.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;

            if (dist < REPULSION_RADIUS) {
              const nx = dx / dist;
              const ny = dy / dist;

              const ratio = (REPULSION_RADIUS - dist) / REPULSION_RADIUS;
              let repForce = ratio * ratio * 0.85;

              const minDist = (dimA.width + dimB.width) / 2 + 35;
              if (dist < minDist) {
                repForce += (minDist - dist) * 0.025;
              }

              fx[idA] += repForce * nx;
              fy[idA] += repForce * ny;
              fx[idB] -= repForce * nx;
              fy[idB] -= repForce * ny;
            }
          }
        }

        const TARGET_EDGE_LENGTH = 340;
        const SPRING_STIFFNESS = 0.0055;

        pairs.forEach((pair) => {
          const nodeA = pNodes[pair.userA.id];
          const nodeB = pNodes[pair.userB.id];
          if (!nodeA || !nodeB) return;

          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;

          const thresh = pair.threshold ?? matchThreshold;
          const targetLen =
            pair.closeness >= thresh ? TARGET_EDGE_LENGTH - 25 : TARGET_EDGE_LENGTH + 25;
          const displacement = dist - targetLen;
          const springForce = displacement * SPRING_STIFFNESS;

          const nx = dx / dist;
          const ny = dy / dist;

          fx[pair.userA.id] += springForce * nx;
          fy[pair.userA.id] += springForce * ny;
          fx[pair.userB.id] -= springForce * nx;
          fy[pair.userB.id] -= springForce * ny;
        });

        const CENTER_GRAVITY = 0.0018;
        nodeIds.forEach((id) => {
          const node = pNodes[id];
          if (!node) return;
          fx[id] += (CENTER_X - node.x) * CENTER_GRAVITY;
          fy[id] += (CENTER_Y - node.y) * CENTER_GRAVITY;
        });

        nodeIds.forEach((id) => {
          const node = pNodes[id];
          if (!node) return;
          const dim = nodeDimensions[id] || { width: 180, height: 68 };
          const halfW = dim.width / 2 + 12;
          const halfH = dim.height / 2 + 10;

          const minX = halfW;
          const maxX = VIEW_WIDTH - halfW;
          const minY = halfH;
          const maxY = VIEW_HEIGHT - halfH;

          const wallBuffer = 55;
          if (node.x < minX + wallBuffer) {
            fx[id] += (minX + wallBuffer - node.x) * 0.035;
          } else if (node.x > maxX - wallBuffer) {
            fx[id] -= (node.x - (maxX - wallBuffer)) * 0.035;
          }

          if (node.y < minY + wallBuffer) {
            fy[id] += (minY + wallBuffer - node.y) * 0.035;
          } else if (node.y > maxY - wallBuffer) {
            fy[id] -= (node.y - (maxY - wallBuffer)) * 0.035;
          }
        });

        if (isFloating) {
          const isAnyHovered =
            hoveredNodeId !== null || hoveredPairKey !== null || dragRef.current.nodeId !== null;
          nodeIds.forEach((id) => {
            const p = floatParams[id];
            if (p) {
              const floatDamping = isAnyHovered ? 0.02 : 1.0;
              const ox = Math.sin(now * p.freqX + p.phaseX) * 0.16 * floatDamping;
              const oy = Math.cos(now * p.freqY + p.phaseY) * 0.14 * floatDamping;
              fx[id] += ox;
              fy[id] += oy;
            }
          });
        }

        const NODE_MASS = 11.0;
        const DAMPING = 0.94;
        const MAX_SPEED = 1.35;
        const activeDraggedId = dragRef.current.nodeId;

        const nextPositions: Record<string, Point> = {};

        nodeIds.forEach((id) => {
          const node = pNodes[id];
          if (!node) return;

          const dim = nodeDimensions[id] || { width: 180, height: 68 };
          const halfW = dim.width / 2 + 10;
          const halfH = dim.height / 2 + 10;

          if (activeDraggedId === id) {
            node.x = dragRef.current.currentSvgX;
            node.y = dragRef.current.currentSvgY;
            node.vx = 0;
            node.vy = 0;
          } else {
            const ax = fx[id] / NODE_MASS;
            const ay = fy[id] / NODE_MASS;

            node.vx = (node.vx + ax) * DAMPING;
            node.vy = (node.vy + ay) * DAMPING;

            const currentSpeed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
            if (currentSpeed > MAX_SPEED) {
              node.vx = (node.vx / currentSpeed) * MAX_SPEED;
              node.vy = (node.vy / currentSpeed) * MAX_SPEED;
            }

            node.x += node.vx;
            node.y += node.vy;

            node.x = Math.max(halfW, Math.min(VIEW_WIDTH - halfW, node.x));
            node.y = Math.max(halfH, Math.min(VIEW_HEIGHT - halfH, node.y));
          }

          nextPositions[id] = { x: node.x, y: node.y };
        });

        setDisplayPositions(nextPositions);
      }

      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameId);
  }, [
    isOpen,
    activeTab,
    isFloating,
    pairs,
    floatParams,
    CENTER_X,
    CENTER_Y,
    VIEW_WIDTH,
    VIEW_HEIGHT,
    nodeDimensions,
    hoveredNodeId,
    hoveredPairKey,
    matchThreshold,
  ]);

  // Chronologically sorted logs
  const sortedLogs = useMemo(() => {
    return [...logs].sort((a, b) => a.timestamp - b.timestamp || a.iteration - b.iteration);
  }, [logs]);

  /**
   * Group logs strictly by TWO PERSONS (Person A ⟷ Person B).
   * Along each line, we track how those two persons' topics, stances, and Gemini Embedding scores evolve over time.
   */
  const pairGroups = useMemo(() => {
    const groupsMap: Record<
      string,
      {
        pairKey: string;
        personAId: string;
        personBId: string;
        personAName: string;
        personBName: string;
        personAColor: string;
        personBColor: string;
        label: string;
        color: { stroke: string; fill: string; name: string };
        points: EnrichedPairLogPoint[];
        logs: AiDebugLog[];
        initialScore: number;
        latestScore: number;
        highestScore: number;
        latestCosine: number;
        latestTopicA: string;
        latestTopicB: string;
        distinctTopicsA: string[];
        distinctTopicsB: string[];
        topicTransitionsCount: number;
        embeddingModel: string;
      }
    > = {};

    let colorIdx = 0;

    sortedLogs.forEach((log) => {
      const key = getPersonPairKey(log);

      const rawIdA = log.userAId || extractPersonName(log.userA);
      const rawIdB = log.userBId || extractPersonName(log.userB);
      const rawNameA = log.userAName || extractPersonName(log.userA);
      const rawNameB = log.userBName || extractPersonName(log.userB);
      const rawTopicA = log.topicA || extractTopicFromFormatted(log.userA);
      const rawTopicB = log.topicB || extractTopicFromFormatted(log.userB);
      const rawStanceA = log.stanceA || rawTopicA;
      const rawStanceB = log.stanceB || rawTopicB;
      const rawColorA = log.userAColor || '#6366f1';
      const rawColorB = log.userBColor || '#06b6d4';

      if (!groupsMap[key]) {
        const palette = PAIR_PALETTE[colorIdx % PAIR_PALETTE.length];
        colorIdx++;

        // Canonical order for this pair
        const isSorted = rawIdA.localeCompare(rawIdB) <= 0;
        const pAId = isSorted ? rawIdA : rawIdB;
        const pBId = isSorted ? rawIdB : rawIdA;
        const pAName = isSorted ? rawNameA : rawNameB;
        const pBName = isSorted ? rawNameB : rawNameA;
        const pAColor = isSorted ? rawColorA : rawColorB;
        const pBColor = isSorted ? rawColorB : rawColorA;

        groupsMap[key] = {
          pairKey: key,
          personAId: pAId,
          personBId: pBId,
          personAName: pAName,
          personBName: pBName,
          personAColor: pAColor,
          personBColor: pBColor,
          label: `${pAName} ⟷ ${pBName}`,
          color: palette,
          points: [],
          logs: [],
          initialScore: log.score,
          latestScore: log.score,
          highestScore: log.score,
          latestCosine: log.cosineSimilarity ?? log.score / 100,
          latestTopicA: isSorted ? rawTopicA : rawTopicB,
          latestTopicB: isSorted ? rawTopicB : rawTopicA,
          distinctTopicsA: [],
          distinctTopicsB: [],
          topicTransitionsCount: 0,
          embeddingModel: log.embeddingModel || activeEmbeddingModel,
        };
      }

      const grp = groupsMap[key];
      const matchesOrder = rawIdA === grp.personAId || (!log.userAId && rawNameA === grp.personAName);

      const pAName = matchesOrder ? rawNameA : rawNameB;
      const pBName = matchesOrder ? rawNameB : rawNameA;
      const topicA = matchesOrder ? rawTopicA : rawTopicB;
      const topicB = matchesOrder ? rawTopicB : rawTopicA;
      const stanceA = matchesOrder ? rawStanceA : rawStanceB;
      const stanceB = matchesOrder ? rawStanceB : rawStanceA;
      const colorA = matchesOrder ? rawColorA : rawColorB;
      const colorB = matchesOrder ? rawColorB : rawColorA;

      // Update latest person names in case profile alias changed
      grp.personAName = pAName;
      grp.personBName = pBName;
      grp.personAColor = colorA;
      grp.personBColor = colorB;
      grp.label = `${pAName} ⟷ ${pBName}`;

      const prevPoint = grp.points.length > 0 ? grp.points[grp.points.length - 1] : null;
      const topicAChanged = Boolean(prevPoint && prevPoint.topicA !== topicA);
      const topicBChanged = Boolean(prevPoint && prevPoint.topicB !== topicB);
      const anyTopicChanged = topicAChanged || topicBChanged;
      const stanceChanged = Boolean(
        prevPoint && (prevPoint.stanceA !== stanceA || prevPoint.stanceB !== stanceB)
      );
      const scoreDelta = prevPoint ? log.score - prevPoint.log.score : 0;

      if (anyTopicChanged) {
        grp.topicTransitionsCount += 1;
      }

      if (!grp.distinctTopicsA.includes(topicA)) {
        grp.distinctTopicsA.push(topicA);
      }
      if (!grp.distinctTopicsB.includes(topicB)) {
        grp.distinctTopicsB.push(topicB);
      }

      const enrichedPoint: EnrichedPairLogPoint = {
        log,
        personAId: grp.personAId,
        personBId: grp.personBId,
        personAName: pAName,
        personBName: pBName,
        personAColor: colorA,
        personBColor: colorB,
        topicA,
        topicB,
        stanceA,
        stanceB,
        prevTopicA: prevPoint?.topicA,
        prevTopicB: prevPoint?.topicB,
        topicAChanged,
        topicBChanged,
        anyTopicChanged,
        stanceChanged,
        scoreDelta,
      };

      grp.points.push(enrichedPoint);
      grp.logs.push(log);
      grp.latestScore = log.score;
      grp.latestCosine = log.cosineSimilarity ?? log.score / 100;
      grp.latestTopicA = topicA;
      grp.latestTopicB = topicB;
      if (log.embeddingModel) {
        grp.embeddingModel = log.embeddingModel;
      }
      if (log.score > grp.highestScore) {
        grp.highestScore = log.score;
      }
    });

    return Object.values(groupsMap);
  }, [sortedLogs, activeEmbeddingModel]);

  // Unique connections extracted from trajectory pair groups (enriched with live node info if present)
  const trajectoryUserNodes = useMemo(() => {
    const userMap = new Map<
      string,
      { id: string; name: string; color: string; topic: string }
    >();

    pairGroups.forEach((grp) => {
      const liveNodeA = nodes.find((n) => n.visitorId === grp.personAId);
      userMap.set(grp.personAId, {
        id: grp.personAId,
        name: liveNodeA?.visitorName || grp.personAName,
        color: liveNodeA?.visitorColor || grp.personAColor,
        topic: liveNodeA?.topicTitle || grp.latestTopicA,
      });

      const liveNodeB = nodes.find((n) => n.visitorId === grp.personBId);
      userMap.set(grp.personBId, {
        id: grp.personBId,
        name: liveNodeB?.visitorName || grp.personBName,
        color: liveNodeB?.visitorColor || grp.personBColor,
        topic: liveNodeB?.topicTitle || grp.latestTopicB,
      });
    });

    return Array.from(userMap.values());
  }, [pairGroups, nodes]);

  // Automatically include newly appearing connections unless the user explicitly clicked Select None
  useEffect(() => {
    if (trajectoryUserNodes.length === 0) return;
    const newlyAdded: string[] = [];
    trajectoryUserNodes.forEach((u) => {
      if (!seenUserIdsRef.current.has(u.id)) {
        seenUserIdsRef.current.add(u.id);
        newlyAdded.push(u.id);
      }
    });
    if (newlyAdded.length > 0 && !isNoneSelectedModeRef.current) {
      setSelectedUserIds((prev) => {
        const next = new Set(prev);
        newlyAdded.forEach((id) => next.add(id));
        return Array.from(next);
      });
    }
  }, [trajectoryUserNodes]);

  const selectedUserIdSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);

  const handleToggleTrajectoryUser = useCallback((userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      isNoneSelectedModeRef.current = next.size === 0;
      return Array.from(next);
    });
  }, []);

  const handleSelectAllUsers = useCallback(() => {
    isNoneSelectedModeRef.current = false;
    setSelectedUserIds(trajectoryUserNodes.map((u) => u.id));
  }, [trajectoryUserNodes]);

  const handleSelectNoneUsers = useCallback(() => {
    isNoneSelectedModeRef.current = true;
    setSelectedUserIds([]);
  }, []);

  // Display each pair responding to the multi-selected connections
  const displayedPairGroups = useMemo(() => {
    if (selectedUserIdSet.size < 2) return [];
    return pairGroups.filter(
      (g) => selectedUserIdSet.has(g.personAId) && selectedUserIdSet.has(g.personBId)
    );
  }, [pairGroups, selectedUserIdSet]);

  // Unified chronological timeline passes for X-axis
  const timelinePasses = useMemo(() => {
    const passSet = new Map<number, { timestamp: number; iteration: number }>();
    sortedLogs.forEach((l) => {
      if (!passSet.has(l.timestamp)) {
        passSet.set(l.timestamp, { timestamp: l.timestamp, iteration: l.iteration });
      }
    });
    return Array.from(passSet.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [sortedLogs]);

  // Effective X-axis timeline window bounds
  const maxPassIdx = Math.max(0, timelinePasses.length - 1);
  const winStartIdx = timelineWindow
    ? Math.min(Math.max(0, timelineWindow.startIdx), maxPassIdx)
    : 0;
  const winEndIdx = timelineWindow
    ? Math.max(winStartIdx, Math.min(timelineWindow.endIdx, maxPassIdx))
    : maxPassIdx;
  const isTimelineWindowNarrowed =
    timelinePasses.length > 1 && (winStartIdx > 0 || winEndIdx < maxPassIdx);

  const windowedTimelinePasses = useMemo(() => {
    if (timelinePasses.length === 0) return [];
    return timelinePasses.slice(winStartIdx, winEndIdx + 1);
  }, [timelinePasses, winStartIdx, winEndIdx]);

  const passIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    windowedTimelinePasses.forEach((p, idx) => {
      map.set(p.timestamp, idx);
    });
    return map;
  }, [windowedTimelinePasses]);

  // Pair groups restricted to both the selected connections and the active X-axis timeline window
  const windowedDisplayedPairGroups = useMemo(() => {
    if (windowedTimelinePasses.length === 0) return [];
    const minTs = windowedTimelinePasses[0].timestamp;
    const maxTs = windowedTimelinePasses[windowedTimelinePasses.length - 1].timestamp;
    return displayedPairGroups
      .map((grp) => ({
        ...grp,
        points: grp.points.filter(
          (pt) => pt.log.timestamp >= minTs && pt.log.timestamp <= maxTs
        ),
      }))
      .filter((grp) => grp.points.length > 0);
  }, [displayedPairGroups, windowedTimelinePasses]);

  const handleTimelineBrushPointerDown = useCallback(
    (e: React.PointerEvent, mode: 'start' | 'end' | 'pan') => {
      e.preventDefault();
      e.stopPropagation();
      const trackEl = timelineBrushRef.current;
      if (!trackEl || timelinePasses.length <= 1) return;

      const rect = trackEl.getBoundingClientRect();
      const totalMaxIdx = timelinePasses.length - 1;
      const initialStart = winStartIdx;
      const initialEnd = winEndIdx;
      const span = initialEnd - initialStart;
      const startClientX = e.clientX;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (mode === 'pan') {
          const deltaPx = moveEvent.clientX - startClientX;
          const deltaIdx = Math.round((deltaPx / Math.max(1, rect.width)) * totalMaxIdx);
          let nextStart = initialStart + deltaIdx;
          let nextEnd = initialEnd + deltaIdx;
          if (nextStart < 0) {
            nextStart = 0;
            nextEnd = span;
          }
          if (nextEnd > totalMaxIdx) {
            nextEnd = totalMaxIdx;
            nextStart = Math.max(0, totalMaxIdx - span);
          }
          setTimelineWindow({ startIdx: nextStart, endIdx: nextEnd });
        } else {
          const ratio = Math.max(
            0,
            Math.min(1, (moveEvent.clientX - rect.left) / Math.max(1, rect.width))
          );
          const idx = Math.round(ratio * totalMaxIdx);
          if (mode === 'start') {
            const nextStart = Math.min(idx, initialEnd);
            setTimelineWindow({ startIdx: nextStart, endIdx: initialEnd });
          } else {
            const nextEnd = Math.max(idx, initialStart);
            setTimelineWindow({ startIdx: initialStart, endIdx: nextEnd });
          }
        }
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },
    [timelinePasses.length, winStartIdx, winEndIdx]
  );

  // Locate both the active log and its enriched two-person trajectory point & group among displayed pairs
  const activeSelection = useMemo(() => {
    if (windowedDisplayedPairGroups.length === 0) return null;

    const candidateIds = [hoveredLogId, selectedLogId, lastHoveredLogId].filter(
      Boolean
    ) as string[];

    for (const candId of candidateIds) {
      for (const grp of windowedDisplayedPairGroups) {
        const ptIdx = grp.points.findIndex((p) => p.log.id === candId);
        if (ptIdx !== -1) {
          return {
            group: grp,
            point: grp.points[ptIdx],
            pointIndex: ptIdx,
            log: grp.points[ptIdx].log,
          };
        }
      }
    }

    // Fallback to the latest chronological point among visible displayed pair groups
    let latestMatch: {
      group: (typeof windowedDisplayedPairGroups)[0];
      point: EnrichedPairLogPoint;
      pointIndex: number;
      log: AiDebugLog;
    } | null = null;

    for (const grp of windowedDisplayedPairGroups) {
      const lastIdx = grp.points.length - 1;
      if (lastIdx >= 0) {
        const pt = grp.points[lastIdx];
        if (!latestMatch || pt.log.timestamp >= latestMatch.log.timestamp) {
          latestMatch = {
            group: grp,
            point: pt,
            pointIndex: lastIdx,
            log: pt.log,
          };
        }
      }
    }

    return latestMatch;
  }, [windowedDisplayedPairGroups, hoveredLogId, selectedLogId, lastHoveredLogId]);

  const activeLog = activeSelection?.log || null;

  // Active pair in Dialogue Logs: only populated if user explicitly hovered or selected an edge,
  // AND both participants currently exist in active nodes list (empty if a referenced node disconnects or nothing is selected)
  const activePair = useMemo(() => {
    const targetKey = hoveredPairKey || selectedPairKey;
    if (!targetKey) return null;

    const found = pairs.find((p) => p.pairKey === targetKey);
    if (!found) return null;

    // Verify both participants currently exist as active nodes (neither disconnected)
    const hasNodeA = nodes.some((n) => n.visitorId === found.userA.id);
    const hasNodeB = nodes.some((n) => n.visitorId === found.userB.id);
    if (!hasNodeA || !hasNodeB) return null;

    return found;
  }, [pairs, nodes, hoveredPairKey, selectedPairKey]);

  // Visible sampled timeline passes to prevent label collision on the X-axis when there are many evaluations
  const visibleTimelinePasses = useMemo(() => {
    if (windowedTimelinePasses.length <= 6) return windowedTimelinePasses;

    // Evenly select at most 5 ticks across the active X-axis window
    const count = 5;
    const step = (windowedTimelinePasses.length - 1) / (count - 1);
    const selected: typeof windowedTimelinePasses = [];
    const usedIndices = new Set<number>();

    for (let i = 0; i < count; i++) {
      const idx = Math.min(windowedTimelinePasses.length - 1, Math.round(i * step));
      if (!usedIndices.has(idx)) {
        usedIndices.add(idx);
        selected.push(windowedTimelinePasses[idx]);
      }
    }

    // If an activeLog point is currently selected/hovered and its pass is not among visible,
    // include it so the user can inspect its timestamp
    if (activeLog) {
      const activePass = windowedTimelinePasses.find((p) => p.timestamp === activeLog.timestamp);
      if (activePass && !selected.some((p) => p.timestamp === activePass.timestamp)) {
        selected.push(activePass);
        selected.sort((a, b) => a.timestamp - b.timestamp);
      }
    }

    return selected;
  }, [windowedTimelinePasses, activeLog]);

  if (!isOpen) return null;

  const isFallbackModel =
    activeEmbeddingModel !== 'gemini-embedding-2-preview' &&
    Boolean(activeEmbeddingModel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-1.5 sm:p-4 bg-black/85 backdrop-blur-sm animate-fade-in select-none">
      <div className="relative w-full max-w-5xl h-[96dvh] sm:h-[90vh] bg-gray-900 border border-gray-700/80 rounded-xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden text-white text-xs">
        {/* Top Header */}
        <div className="flex items-center justify-between px-3 sm:px-5 py-2 sm:py-3 bg-gray-950 border-b border-gray-800 flex-shrink-0 gap-2">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 flex-shrink-0">
              <Network className="w-4 h-4 sm:w-5 sm:h-5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="font-bold text-xs sm:text-base text-gray-100 tracking-wide truncate font-serif">
                  Dialogue Logs
                </h2>
                <span
                  className={`hidden sm:flex px-2 py-0.5 rounded-full font-mono text-[9px] sm:text-[10px] font-semibold items-center gap-1 border flex-shrink-0 ${
                    isFallbackModel
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                      : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
                  }`}
                  title="Active Embedding Model"
                >
                  <Cpu className="w-3 h-3" />
                  <span>{activeEmbeddingModel}</span>
                  {isFallbackModel && <span className="text-[8px] uppercase">(Fallback)</span>}
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-gray-400 truncate hidden sm:block">
                Live topic alignment and two-person score trajectories
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {onTriggerEvaluation && (
              <button
                onClick={onTriggerEvaluation}
                className="px-2 sm:px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-300 hover:text-white transition-colors text-[10px] sm:text-[11px] font-semibold flex items-center gap-1 shadow-sm cursor-pointer"
                title="Re-embed participant stances and recalculate pairwise cosine similarity"
              >
                <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Evaluate Embeddings</span>
                <span className="sm:hidden">Evaluate</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1 sm:p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-gray-800 transition-colors ml-0.5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Switcher & Match Threshold Control */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3 sm:px-5 py-1.5 sm:py-2 bg-gray-950/70 border-b border-gray-800 text-xs font-semibold flex-shrink-0 gap-1.5 sm:gap-2">
          <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto">
            <button
              onClick={() => setActiveTab('graph')}
              className={`pb-1 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'graph'
                  ? 'text-indigo-400 border-indigo-500'
                  : 'text-gray-400 border-transparent hover:text-gray-200'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Graph</span>
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`pb-1 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'logs'
                  ? 'text-indigo-400 border-indigo-500'
                  : 'text-gray-400 border-transparent hover:text-gray-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Trajectories</span>
            </button>
          </div>

          {/* Interactive Match Threshold Control */}
          <div className="flex items-center justify-between sm:justify-start gap-2 flex-shrink-0 bg-gray-900/90 border border-gray-800 px-2.5 py-1 rounded-lg">
            <div className="flex items-center gap-1.5">
              <Sliders className="w-3 h-3 text-emerald-400 hidden sm:inline" />
              <span className="text-[10px] sm:text-[11px] text-gray-300 font-mono">
                Match Threshold:{' '}
                <strong className="text-emerald-400">
                  ≥ {matchThreshold}%
                </strong>
              </span>
            </div>
            {onSetMatchThreshold && (
              <div className="flex items-center gap-1 ml-1">
                <input
                  type="range"
                  min={30}
                  max={95}
                  step={5}
                  value={matchThreshold}
                  onChange={(e) => onSetMatchThreshold(Number(e.target.value))}
                  className="w-20 sm:w-20 accent-emerald-500 cursor-pointer h-1 bg-gray-700 rounded-lg"
                  title={`Adjust Semantic Match Threshold (≥ ${matchThreshold}%)`}
                />
              </div>
            )}
          </div>
        </div>

        {/* Main Body */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-950 min-h-0">
          {activeTab === 'graph' ? (
            <div
              ref={graphContainerRef}
              className={`flex-1 flex flex-col min-h-0 overflow-hidden relative ${
                isDraggingDivider ? 'cursor-row-resize select-none pointer-events-none' : ''
              }`}
            >
              {/* NODE GRAPH FRAME */}
              <div className="flex-1 relative w-full overflow-hidden bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 min-h-0 pointer-events-auto">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                  className="w-full h-full select-none cursor-default"
                  preserveAspectRatio="xMidYMid meet"
                  style={{ touchAction: 'none' }}
                >
                  <defs>
                    <filter id="readyGlow" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="nodeGlow" x="-30%" y="-30%" width="160%" height="160%">
                      <feGaussianBlur stdDeviation="5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    {/* Cohesive, purely harmonious emerald gradient for match-ready connections (no arbitrary red/amber) */}
                    <linearGradient id="edgeGradReady" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="50%" stopColor="#34d399" />
                      <stop offset="100%" stopColor="#10b981" />
                    </linearGradient>

                    {/* Per-pair node-to-node gradients aligned directly along the vector from Node A to Node B */}
                    {pairs.map((pair) => {
                      const posA =
                        displayPositions[pair.userA.id] ||
                        defaultPositions[pair.userA.id] ||
                        { x: 200, y: 200 };
                      const posB =
                        displayPositions[pair.userB.id] ||
                        defaultPositions[pair.userB.id] ||
                        { x: 600, y: 200 };
                      const safeKey = pair.pairKey.replace(/[^a-zA-Z0-9]/g, '_');
                      const colorA = pair.userA.color || '#6366f1';
                      const colorB = pair.userB.color || '#06b6d4';

                      return (
                        <linearGradient
                          key={`grad_${safeKey}`}
                          id={`edgeGrad_${safeKey}`}
                          x1={posA.x}
                          y1={posA.y}
                          x2={posB.x}
                          y2={posB.y}
                          gradientUnits="userSpaceOnUse"
                        >
                          <stop offset="0%" stopColor={colorA} />
                          <stop offset="100%" stopColor={colorB} />
                        </linearGradient>
                      );
                    })}
                    <pattern id="gridPattern" width="32" height="32" patternUnits="userSpaceOnUse">
                      <path
                        d="M 32 0 L 0 0 0 32"
                        fill="none"
                        stroke="#332619"
                        strokeWidth="0.5"
                        strokeOpacity="0.5"
                      />
                      <circle cx="32" cy="32" r="1" fill="#4d3b27" fillOpacity="0.5" />
                    </pattern>
                  </defs>

                  <rect
                    width={VIEW_WIDTH}
                    height={VIEW_HEIGHT}
                    fill="url(#gridPattern)"
                    onClick={() => setSelectedPairKey(null)}
                    className="cursor-default"
                  />

                  {/* EDGES (PAIRWISE EMBEDDING COMPARISONS) */}
                  {pairs.map((pair, pIdx) => {
                    const posA =
                      displayPositions[pair.userA.id] ||
                      defaultPositions[pair.userA.id] ||
                      { x: 200, y: 200 };
                    const posB =
                      displayPositions[pair.userB.id] ||
                      defaultPositions[pair.userB.id] ||
                      { x: 600, y: 200 };

                    const isHovered = hoveredPairKey === pair.pairKey;
                    const isIncidentHovered =
                      hoveredNodeId === pair.userA.id || hoveredNodeId === pair.userB.id;
                    const isAnyHovered = Boolean(hoveredPairKey || hoveredNodeId);
                    const isPairActive =
                      isHovered ||
                      isIncidentHovered ||
                      selectedPairKey === pair.pairKey;

                    const thresh = pair.threshold ?? matchThreshold;
                    const isReady = pair.closeness >= thresh;

                    const safeKey = pair.pairKey.replace(/[^a-zA-Z0-9]/g, '_');
                    const pairColor =
                      EDGE_DISTINCT_PALETTE[pIdx % EDGE_DISTINCT_PALETTE.length];

                    const midX = (posA.x + posB.x) / 2;
                    const midY = (posA.y + posB.y) / 2;

                    return (
                      <g
                        key={pair.pairKey}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredPairKey(pair.pairKey)}
                        onMouseLeave={() => setHoveredPairKey(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPairKey(selectedPairKey === pair.pairKey ? null : pair.pairKey);
                        }}
                      >
                        {/* Generous invisible hit zone for easy hovering and tapping */}
                        <line
                          x1={posA.x}
                          y1={posA.y}
                          x2={posB.x}
                          y2={posB.y}
                          stroke="transparent"
                          strokeWidth={26}
                        />

                        {/* Outer Glow Halo when edge is Active or Ready */}
                        {(isReady || isPairActive) && (
                          <line
                            x1={posA.x}
                            y1={posA.y}
                            x2={posB.x}
                            y2={posB.y}
                            stroke={isReady ? '#10b981' : pairColor.stroke}
                            strokeWidth={isReady ? 8 : 6}
                            strokeOpacity={isReady ? 0.38 : 0.28}
                            filter="url(#readyGlow)"
                          />
                        )}

                        {/* Main Edge Line */}
                        <line
                          x1={posA.x}
                          y1={posA.y}
                          x2={posB.x}
                          y2={posB.y}
                          stroke={
                            isReady
                              ? 'url(#edgeGradReady)'
                              : isPairActive
                              ? pairColor.stroke
                              : `url(#edgeGrad_${safeKey})`
                          }
                          strokeWidth={isReady ? 4.5 : isPairActive ? 3.8 : 2.5}
                          strokeDasharray={isReady ? '8 4' : isPairActive ? 'none' : '5 4'}
                          strokeOpacity={
                            isReady
                              ? 1
                              : isPairActive
                              ? 1
                              : isAnyHovered
                              ? 0.25
                              : 0.75
                          }
                          filter={isReady ? 'url(#readyGlow)' : undefined}
                        />

                        {/* Midpoint Similarity Badge */}
                        <g transform={`translate(${midX}, ${midY})`}>
                          <rect
                            x={isReady ? -48 : -36}
                            y={-14}
                            width={isReady ? 96 : 72}
                            height={28}
                            rx={10}
                            fill={
                              isReady
                                ? '#064e3b'
                                : isPairActive
                                ? '#1e1b4b'
                                : '#0f172a'
                            }
                            stroke={
                              isReady
                                ? '#10b981'
                                : isPairActive
                                ? '#ffffff'
                                : pairColor.stroke
                            }
                            strokeWidth={isReady || isPairActive ? 1.8 : 1.2}
                            strokeOpacity={isAnyHovered && !isPairActive ? 0.4 : 1}
                          />
                          <text
                            x={0}
                            y={4}
                            textAnchor="middle"
                            fill={
                              isReady
                                ? '#6ee7b7'
                                : isPairActive
                                ? '#ffffff'
                                : '#cbd5e1'
                            }
                            fillOpacity={isAnyHovered && !isPairActive ? 0.4 : 1}
                            fontSize={10.5}
                            fontWeight="bold"
                            fontFamily="monospace"
                          >
                            {isReady ? `★ ${pair.closeness}%` : `${pair.closeness}%`}
                          </text>
                        </g>
                      </g>
                    );
                  })}

                  {/* NODES */}
                  {nodes.map((node) => {
                    const pos =
                      displayPositions[node.visitorId] ||
                      defaultPositions[node.visitorId] ||
                      { x: CENTER_X, y: CENTER_Y };

                    const dim = nodeDimensions[node.visitorId] || {
                      width: 185,
                      height: 68,
                      lines: [node.topicTitle],
                    };
                    const { width: cardW, height: cardH, lines } = dim;

                    const isDragging = draggingNodeId === node.visitorId;
                    const isHovered = hoveredNodeId === node.visitorId;
                    const isConnectedToHoveredEdge =
                      activePair &&
                      (activePair.userA.id === node.visitorId ||
                        activePair.userB.id === node.visitorId);

                    return (
                      <g
                        key={node.visitorId}
                        transform={`translate(${pos.x}, ${pos.y})`}
                        className="cursor-grab active:cursor-grabbing select-none"
                        onPointerDown={(e) => handlePointerDownNode(e, node.visitorId)}
                        onMouseEnter={() => setHoveredNodeId(node.visitorId)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                      >
                        {(isConnectedToHoveredEdge || isHovered || isDragging) && (
                          <rect
                            x={-cardW / 2 - 4}
                            y={-cardH / 2 - 4}
                            width={cardW + 8}
                            height={cardH + 8}
                            rx={16}
                            fill="none"
                            stroke={node.visitorColor || '#6366f1'}
                            strokeWidth={2}
                            strokeOpacity={0.75}
                            filter="url(#nodeGlow)"
                          />
                        )}

                        <rect
                          x={-cardW / 2}
                          y={-cardH / 2}
                          width={cardW}
                          height={cardH}
                          rx={8}
                          fill="#1d150e"
                          stroke={
                            isConnectedToHoveredEdge
                              ? '#da9844'
                              : isHovered
                              ? '#b39872'
                              : '#4d3b27'
                          }
                          strokeWidth={isConnectedToHoveredEdge ? 2 : 1}
                        />

                        {/* User Color Avatar */}
                        <circle
                          cx={-cardW / 2 + 18}
                          cy={-cardH / 2 + 18}
                          r={11}
                          fill={node.visitorColor || '#c88a32'}
                        />
                        <text
                          x={-cardW / 2 + 18}
                          y={-cardH / 2 + 22}
                          textAnchor="middle"
                          fill="#fbf7f0"
                          fontSize={10.5}
                          fontWeight="bold"
                        >
                          {node.visitorName?.charAt(0) || 'S'}
                        </text>

                        {/* User Name */}
                        <text
                          x={-cardW / 2 + 35}
                          y={-cardH / 2 + 22}
                          fill="#f5ebd9"
                          fontSize={11}
                          fontWeight="bold"
                        >
                          {node.visitorName.length > 16
                            ? `${node.visitorName.slice(0, 15)}…`
                            : node.visitorName}
                        </text>

                        {/* Topic Container */}
                        <g transform={`translate(${-cardW / 2 + 10}, ${-cardH / 2 + 35})`}>
                          <rect
                            x={0}
                            y={0}
                            width={cardW - 20}
                            height={cardH - 41}
                            rx={5}
                            fill="#2d1e12"
                            stroke="#884b18"
                            strokeWidth={0.7}
                          />

                          <text x={8} y={11} fill="#f2d5a9" fontSize={9.5} fontWeight="600">
                            {lines.map((line, lIdx) => (
                              <tspan key={lIdx} x={8} dy={lIdx === 0 ? 0 : 13}>
                                {lines.length === 1
                                  ? `"${line}"`
                                  : lIdx === 0
                                  ? `"${line}`
                                  : lIdx === lines.length - 1
                                  ? `${line}"`
                                  : line}
                              </tspan>
                            ))}
                          </text>
                        </g>

                        {/* Active stance evolution dot */}
                        {node.currentSummary && node.currentSummary !== node.topicTitle && (
                          <circle
                            cx={cardW / 2 - 8}
                            cy={-cardH / 2 + 8}
                            r={3.5}
                            fill="#38bdf8"
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>

                {nodes.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/60 backdrop-blur-xs">
                    <div className="p-6 rounded-2xl bg-gray-900 border border-gray-800 text-center max-w-md space-y-2 text-gray-400">
                      <Network className="w-8 h-8 text-indigo-400 mx-auto" />
                      <p className="font-bold text-white text-sm">No Waiting Nodes in Lobby</p>
                      <p className="text-xs">
                        Select any topic from the stream to join the lobby and compare stances.
                      </p>
                    </div>
                  </div>
                )}

                {nodes.length === 1 && (
                  <div className="absolute top-3 left-3 bg-gray-900/90 border border-indigo-500/40 px-3 py-1.5 rounded-xl text-[11px] text-gray-300 shadow flex items-center gap-2">
                    <Info className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                    <span>
                      1 participant in lobby. Open Split View or a 2nd session to compare!
                    </span>
                  </div>
                )}

                {/* Always-visible clean legend overlay in the bottom-left corner of the canvas */}
                <div className="absolute bottom-2.5 left-3 pointer-events-none flex items-center gap-3 bg-gray-950/85 backdrop-blur-xs border border-gray-800/80 px-2.5 py-1 rounded-lg text-[10px] text-gray-400 font-mono shadow-md">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-1.5 bg-emerald-400 inline-block rounded-full shadow-[0_0_5px_rgba(16,185,129,0.8)]" />
                    <span className="text-gray-300 font-semibold">Match Ready (≥{matchThreshold}%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-1.5 bg-sky-400 inline-block rounded-full" />
                    <span className="text-gray-400">Connection</span>
                  </div>
                </div>
              </div>

              {/* DRAGGABLE RESIZER SLIDER BAR (moves border between graph canvas and extra info pane) */}
              <div
                onPointerDown={handleGraphDividerPointerDown}
                onDoubleClick={() => setExtraInfoHeight(195)}
                className={`h-2 relative flex items-center justify-center cursor-row-resize transition-all select-none z-30 flex-shrink-0 touch-none pointer-events-auto group before:content-[''] before:absolute before:-inset-y-2.5 before:inset-x-0 ${
                  isDraggingDivider
                    ? 'bg-indigo-600 h-2.5'
                    : 'bg-gray-850 hover:bg-indigo-600/70 border-y border-gray-700/80'
                }`}
                title="Drag up or down to move border between graph and extra info pane (double click to reset)"
              >
                <div
                  className={`w-10 sm:w-12 h-1 rounded-full transition-colors ${
                    isDraggingDivider ? 'bg-gray-100' : 'bg-gray-500 group-hover:bg-indigo-300'
                  }`}
                />
              </div>

              {/* RESERVED EXTRA INFO AREA: reserved at all times, height controlled by slider, empty when nothing is hovered */}
              <div
                style={{ height: `${extraInfoHeight}px` }}
                className="flex-shrink-0 bg-gray-950 overflow-y-auto pointer-events-auto"
              >
                {activePair ? (
                  <div className="p-3.5 sm:p-4 space-y-2.5 animate-fade-in">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 font-bold text-white text-xs">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block"
                            style={{ backgroundColor: activePair.userA.color }}
                          />
                          <span>{activePair.userA.name}</span>
                          <span className="text-gray-400 font-normal">
                            ("{activePair.userA.topic}")
                          </span>
                        </div>
                        <span className="text-indigo-400 font-bold">⟷</span>
                        <div className="flex items-center gap-1.5 font-bold text-white text-xs">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block"
                            style={{ backgroundColor: activePair.userB.color }}
                          />
                          <span>{activePair.userB.name}</span>
                          <span className="text-gray-400 font-normal">
                            ("{activePair.userB.topic}")
                          </span>
                        </div>
                      </div>

                      {/* Score Badges & Action Controls */}
                      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
                        <span
                          className={`px-2.5 py-0.5 rounded-full font-mono font-bold text-xs ${
                            activePair.closeness >= (activePair.threshold ?? matchThreshold)
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          }`}
                          title="Calibrated semantic similarity score"
                        >
                          Score: {activePair.closeness}%
                        </span>
                        {typeof activePair.cosineSimilarity === 'number' && (
                          <span
                            className="px-2 py-0.5 rounded-full bg-gray-900 border border-gray-700 text-gray-300 font-mono text-[11px]"
                            title="Raw mathematical cosine similarity of normalized embedding vectors"
                          >
                            {activePair.cosineSimilarity.toFixed(4)} cos
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            activePair.closeness >= (activePair.threshold ?? matchThreshold)
                              ? 'bg-emerald-600 text-white'
                              : 'bg-gray-800 text-gray-400'
                          }`}
                        >
                          {activePair.closeness >= (activePair.threshold ?? matchThreshold)
                            ? 'MATCH READY'
                            : 'BELOW THRESHOLD'}
                        </span>
                        <button
                          onClick={() => setIsGraphInstanceExpanded(!isGraphInstanceExpanded)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-gray-850 hover:bg-gray-800 text-indigo-300 hover:text-white border border-gray-700 text-[10px] font-medium transition-colors cursor-pointer"
                          title={isGraphInstanceExpanded ? 'Collapse instance details' : 'Expand instance details'}
                        >
                          {isGraphInstanceExpanded ? (
                            <>
                              <ChevronUp className="w-3 h-3" />
                              <span>Collapse</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3 h-3" />
                              <span>Expand Instance</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => setSelectedPairKey(null)}
                          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors cursor-pointer ml-0.5"
                          title="Deselect edge (empty details)"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Progress bar with threshold marker */}
                    <div className="relative w-full bg-gray-900 rounded-full h-2.5 overflow-hidden border border-gray-800">
                      <div
                        className={`h-full transition-all duration-300 ${
                          activePair.closeness >= (activePair.threshold ?? matchThreshold)
                            ? 'bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]'
                            : 'bg-gradient-to-r from-indigo-600 to-indigo-400'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, activePair.closeness))}%` }}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 z-10 shadow-[0_0_4px_rgba(16,185,129,0.9)]"
                        style={{ left: `${Math.min(100, Math.max(0, activePair.threshold ?? matchThreshold))}%` }}
                        title={`Match Threshold: ${activePair.threshold ?? matchThreshold}%`}
                      />
                    </div>

                    {/* Synthesized debate topic & common ground rationale */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                      <div className="p-2.5 rounded-xl bg-gray-900/90 border border-indigo-500/30 space-y-1">
                        <span className="text-[10px] font-bold uppercase text-indigo-400 flex items-center gap-1 font-serif">
                          <Sparkles className="w-3 h-3" />
                          Proposed Shared Socratic Inquiry:
                        </span>
                        <p
                          className={`font-bold text-gray-100 text-xs leading-snug font-serif ${
                            isGraphInstanceExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'
                          }`}
                        >
                          "{activePair.bridgeTopic}"
                        </p>
                      </div>

                      <div className="p-2.5 rounded-xl bg-gray-900/90 border border-gray-800 space-y-1">
                        <span className="text-[10px] font-bold uppercase text-gray-400">
                          Embedding Vector Nexus / Rationale:
                        </span>
                        <p
                          className={`text-gray-300 italic leading-snug ${
                            isGraphInstanceExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'
                          }`}
                        >
                          {activePair.commonGround}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Empty when nothing is hovered */
                  <div className="h-full w-full" />
                )}
              </div>
            </div>
          ) : (
            // =========================================================
            // TWO-PERSON TRAJECTORY LINE GRAPH:
            // Each line represents TWO PERSONS whose topics and embedding scores change over time
            // =========================================================
            <div className="flex-1 flex flex-col overflow-y-auto bg-gray-950 p-3 sm:p-5 space-y-3 min-h-0">
              {pairGroups.length > 0 ? (
                <>
                  {/* MULTI-SELECT CONNECTIONS BAR */}
                  <div className="bg-gray-900/70 border border-gray-800 p-3 rounded-xl space-y-2.5 flex-shrink-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <TrendingUp className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        <span className="font-bold text-white text-xs sm:text-sm">
                          Connections
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono text-[10px] font-bold">
                          {selectedUserIds.length}/{trajectoryUserNodes.length} Users •{' '}
                          {windowedDisplayedPairGroups.length}{' '}
                          {windowedDisplayedPairGroups.length === 1 ? 'Pair' : 'Pairs'} Shown
                        </span>
                      </div>

                      {/* Select All / None Users Controls */}
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleSelectAllUsers}
                          disabled={selectedUserIds.length === trajectoryUserNodes.length}
                          className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:pointer-events-none text-indigo-300 hover:text-white border border-gray-700 text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          Select All
                        </button>
                        <button
                          onClick={handleSelectNoneUsers}
                          disabled={selectedUserIds.length === 0}
                          className="px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:pointer-events-none text-gray-300 hover:text-white border border-gray-700 text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          Select None
                        </button>
                      </div>
                    </div>

                    {/* Multi-selectable User:Topic Node Chips */}
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                      {trajectoryUserNodes.map((u) => {
                        const isSelected = selectedUserIdSet.has(u.id);
                        return (
                          <button
                            key={u.id}
                            onClick={() => handleToggleTrajectoryUser(u.id)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-950/60 border-indigo-500/80 text-white shadow-sm ring-1 ring-indigo-500/30'
                                : 'bg-gray-950/70 border-gray-800 text-gray-500 hover:border-gray-700 hover:text-gray-300 opacity-60'
                            }`}
                            title={`${u.name}: "${u.topic}" (Click to toggle user:topic node)`}
                          >
                            <span
                              className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-[9px] font-bold flex-shrink-0 transition-colors ${
                                isSelected
                                  ? 'bg-indigo-600 border-indigo-400 text-white'
                                  : 'bg-gray-900 border-gray-700 text-transparent'
                              }`}
                            >
                              ✓
                            </span>
                            <span
                              className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                              style={{ backgroundColor: u.color }}
                            />
                            <span className="font-bold truncate max-w-[120px]">{u.name}:</span>
                            <span className="text-gray-300 italic truncate max-w-[180px]">
                              "{u.topic}"
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {windowedDisplayedPairGroups.length > 0 ? (
                    <>
                      {/* LINE GRAPH SVG CONTAINER (Responsive to narrow windows + X-axis timeline resizer) */}
                      <div className="w-full bg-gray-900/90 border border-gray-800 rounded-xl p-2 sm:p-3 shadow-inner relative flex-shrink-0 space-y-2">
                        {(() => {
                          const GRAPH_W = 860;
                          const GRAPH_H = 250;
                          const PAD_L = 48;
                          const PAD_R = 36;
                          const PAD_T = 28;
                          const PAD_B = 38;

                          const plotW = GRAPH_W - PAD_L - PAD_R;
                          const plotH = GRAPH_H - PAD_T - PAD_B;

                          const numPasses = Math.max(1, windowedTimelinePasses.length);

                          const getX = (timestamp: number) => {
                            const idx = passIndexMap.get(timestamp) ?? 0;
                            return numPasses === 1
                              ? PAD_L + plotW / 2
                              : PAD_L + (idx / (numPasses - 1)) * plotW;
                          };

                          const getY = (score: number) => {
                            const clamped = Math.max(0, Math.min(100, score));
                            return PAD_T + (1 - clamped / 100) * plotH;
                          };

                          const yThresh = getY(matchThreshold);

                          return (
                            <svg
                              viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
                              className="w-full h-auto select-none"
                              preserveAspectRatio="xMidYMid meet"
                            >
                              {/* Match Ready shaded zone above matchThreshold */}
                              <rect
                                x={PAD_L}
                                y={PAD_T}
                                width={plotW}
                                height={Math.max(0, yThresh - PAD_T)}
                                fill="#10b981"
                                fillOpacity="0.06"
                              />

                              {/* Horizontal Grid lines */}
                              {[0, 25, 50, 75, 100].map((score) => {
                                const y = getY(score);
                                return (
                                  <g key={score}>
                                    <line
                                      x1={PAD_L}
                                      y1={y}
                                      x2={PAD_L + plotW}
                                      y2={y}
                                      stroke="#374151"
                                      strokeDasharray="2 3"
                                      strokeWidth="0.8"
                                      strokeOpacity="0.6"
                                    />
                                    <text
                                      x={PAD_L - 8}
                                      y={y + 3.5}
                                      textAnchor="end"
                                      fill="#9ca3af"
                                      fontSize="9.5"
                                      fontFamily="monospace"
                                    >
                                      {score}%
                                    </text>
                                  </g>
                                );
                              })}

                              {/* Dynamic Embedding Match Threshold Line */}
                              <line
                                x1={PAD_L}
                                y1={yThresh}
                                x2={PAD_L + plotW}
                                y2={yThresh}
                                stroke="#10b981"
                                strokeWidth="1.6"
                                strokeDasharray="5 4"
                              />
                              <text
                                x={PAD_L + plotW - 6}
                                y={Math.max(PAD_T + 10, yThresh - 6)}
                                textAnchor="end"
                                fill="#10b981"
                                fontSize="9"
                                fontWeight="bold"
                                fontFamily="monospace"
                              >
                                MATCH THRESHOLD (≥ {matchThreshold}%)
                              </text>

                              {/* Vertical crosshair through active point */}
                              {activeLog && passIndexMap.has(activeLog.timestamp) && (
                                <line
                                  x1={getX(activeLog.timestamp)}
                                  y1={PAD_T}
                                  x2={getX(activeLog.timestamp)}
                                  y2={PAD_T + plotH}
                                  stroke="#818cf8"
                                  strokeWidth="1.2"
                                  strokeDasharray="3 3"
                                  strokeOpacity="0.9"
                                />
                              )}

                              {/* DRAW ONE CONTINUOUS LINE PER DISPLAYED PAIR */}
                              {windowedDisplayedPairGroups.map((group) => {
                                const pts = group.points;

                                let pathStr = '';
                                if (pts.length === 1) {
                                  const px = getX(pts[0].log.timestamp);
                                  const py = getY(pts[0].log.score);
                                  pathStr = `M ${px - 18} ${py} L ${px + 18} ${py}`;
                                } else {
                                  pathStr = pts
                                    .map((pt, i) => {
                                      const px = getX(pt.log.timestamp);
                                      const py = getY(pt.log.score);
                                      return i === 0 ? `M ${px} ${py}` : `L ${px} ${py}`;
                                    })
                                    .join(' ');
                                }

                                const isLineActive =
                                  activeSelection?.group.pairKey === group.pairKey;

                                return (
                                  <g key={group.pairKey}>
                                    {/* Two-Person Trajectory Path */}
                                    <path
                                      d={pathStr}
                                      fill="none"
                                      stroke={group.color.stroke}
                                      strokeWidth={isLineActive ? 3.8 : 2.5}
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeOpacity={isLineActive ? 1 : 0.85}
                                    />

                                    {/* Data points along this two-person line */}
                                    {pts.map((pt) => {
                                      const { log, anyTopicChanged, topicA, topicB } = pt;
                                      const px = getX(log.timestamp);
                                      const py = getY(log.score);
                                      const isPointActive = activeLog?.id === log.id;

                                      const shortTopicA =
                                        topicA.length > 14 ? `${topicA.slice(0, 13)}…` : topicA;
                                      const shortTopicB =
                                        topicB.length > 14 ? `${topicB.slice(0, 13)}…` : topicB;

                                      return (
                                        <g
                                          key={log.id}
                                          className="cursor-pointer"
                                          onMouseEnter={() => setHoveredLogId(log.id)}
                                          onMouseLeave={() => setHoveredLogId(null)}
                                          onClick={() =>
                                            setSelectedLogId(
                                              selectedLogId === log.id ? null : log.id
                                            )
                                          }
                                        >
                                          <circle cx={px} cy={py} r={22} fill="transparent" />

                                          {/* Outer halo when point is active */}
                                          {isPointActive && (
                                            <circle
                                              cx={px}
                                              cy={py}
                                              r={11}
                                              fill={group.color.stroke}
                                              fillOpacity={0.28}
                                              stroke={group.color.stroke}
                                              strokeWidth={1.6}
                                            />
                                          )}

                                          {/* Topic Shift Ring if either person changed their topic at this point */}
                                          {anyTopicChanged && (
                                            <circle
                                              cx={px}
                                              cy={py}
                                              r={8}
                                              fill="none"
                                              stroke="#c084fc"
                                              strokeWidth={1.5}
                                              strokeDasharray="2 2"
                                            />
                                          )}

                                          {/* Match zone indicator ring if point reached or exceeded match threshold */}
                                          {log.score >= matchThreshold && (
                                            <circle
                                              cx={px}
                                              cy={py}
                                              r={isPointActive ? 9.5 : 7.5}
                                              fill="none"
                                              stroke="#10b981"
                                              strokeWidth={1.8}
                                              strokeOpacity={0.9}
                                            />
                                          )}

                                          {/* Data Point Dot */}
                                          <circle
                                            cx={px}
                                            cy={py}
                                            r={isPointActive ? 6.5 : 4.8}
                                            fill={
                                              log.score >= matchThreshold
                                                ? '#10b981'
                                                : group.color.stroke
                                            }
                                            stroke="#0f172a"
                                            strokeWidth={2}
                                          />

                                          {/* Score label above point */}
                                          <text
                                            x={px}
                                            y={py - (anyTopicChanged || isPointActive ? 18 : 9)}
                                            textAnchor="middle"
                                            fill={
                                              isPointActive
                                                ? '#ffffff'
                                                : log.score >= matchThreshold
                                                ? '#6ee7b7'
                                                : '#cbd5e1'
                                            }
                                            fontSize={isPointActive ? 10.5 : 9}
                                            fontWeight="bold"
                                            fontFamily="monospace"
                                          >
                                            {log.score >= matchThreshold
                                              ? `★ ${log.score}%`
                                              : `${log.score}%`}
                                          </text>

                                          {/* Topic evolution tag on active point or when topics changed */}
                                          {(isPointActive || anyTopicChanged) && (
                                            <text
                                              x={px}
                                              y={py - 8}
                                              textAnchor="middle"
                                              fill={anyTopicChanged ? '#d8b4fe' : '#94a3b8'}
                                              fontSize={8}
                                              fontWeight="600"
                                            >
                                              {anyTopicChanged
                                                ? `↻ "${shortTopicA}" / "${shortTopicB}"`
                                                : `"${shortTopicA}" vs "${shortTopicB}"`}
                                            </text>
                                          )}
                                        </g>
                                      );
                                    })}
                                  </g>
                                );
                              })}

                              {/* X-AXIS TIME TICKS (SAMPLED TO AVOID OVERLAP) */}
                              {visibleTimelinePasses.map((p) => {
                                const px = getX(p.timestamp);
                                const isCurrentPass =
                                  activeLog && activeLog.timestamp === p.timestamp;

                                return (
                                  <g key={p.timestamp}>
                                    <line
                                      x1={px}
                                      y1={PAD_T + plotH}
                                      x2={px}
                                      y2={PAD_T + plotH + 4}
                                      stroke={isCurrentPass ? '#818cf8' : '#475569'}
                                      strokeWidth={isCurrentPass ? 1.5 : 1}
                                    />
                                    <text
                                      x={px}
                                      y={PAD_T + plotH + 16}
                                      textAnchor="middle"
                                      fill={isCurrentPass ? '#818cf8' : '#64748b'}
                                      fontSize="8.5"
                                      fontFamily="monospace"
                                      fontWeight={isCurrentPass ? 'bold' : 'normal'}
                                    >
                                      {new Date(p.timestamp).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        second: '2-digit',
                                      })}
                                    </text>
                                    <text
                                      x={px}
                                      y={PAD_T + plotH + 28}
                                      textAnchor="middle"
                                      fill={isCurrentPass ? '#cbd5e1' : '#475569'}
                                      fontSize="8"
                                      fontFamily="monospace"
                                      fontWeight={isCurrentPass ? 'bold' : 'normal'}
                                    >
                                      #{p.iteration}
                                    </text>
                                  </g>
                                );
                              })}

                              <line
                                x1={PAD_L}
                                y1={PAD_T + plotH}
                                x2={PAD_L + plotW}
                                y2={PAD_T + plotH}
                                stroke="#475569"
                                strokeWidth="1.2"
                              />
                              <line
                                x1={PAD_L}
                                y1={PAD_T}
                                x2={PAD_L}
                                y2={PAD_T + plotH}
                                stroke="#475569"
                                strokeWidth="1.2"
                              />
                            </svg>
                          );
                        })()}

                        {/* RESIZABLE X-AXIS TIMELINE WINDOW BRUSH / RANGE CONTROL */}
                        {timelinePasses.length > 1 && (
                          <div className="pt-1 border-t border-gray-800/80 space-y-1.5 px-1">
                            <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400 font-mono">
                              <span>
                                X-Axis Timeline Window: Pass #{timelinePasses[winStartIdx]?.iteration}{' '}
                                — #{timelinePasses[winEndIdx]?.iteration} (
                                {windowedTimelinePasses.length} of {timelinePasses.length} evals)
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-gray-500 hidden sm:inline">
                                  Drag handles to narrow X-axis window
                                </span>
                                {isTimelineWindowNarrowed && (
                                  <button
                                    onClick={() => setTimelineWindow(null)}
                                    className="px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 font-sans font-semibold text-[10px] cursor-pointer transition-colors"
                                  >
                                    Reset Window
                                  </button>
                                )}
                              </div>
                            </div>

                            <div
                              ref={timelineBrushRef}
                              onDoubleClick={() => setTimelineWindow(null)}
                              className="relative h-6 w-full bg-gray-950 border border-gray-800 rounded-lg select-none touch-none overflow-hidden flex items-center"
                              title="Drag left/right handles to narrow X-axis timeline window, or drag center to pan (double-click to reset)"
                            >
                              {/* Background pass tick markers */}
                              {timelinePasses.map((p, idx) => {
                                const pct =
                                  timelinePasses.length > 1
                                    ? (idx / (timelinePasses.length - 1)) * 100
                                    : 50;
                                return (
                                  <div
                                    key={p.timestamp}
                                    style={{ left: `${pct}%` }}
                                    className="absolute top-1.5 bottom-1.5 w-px bg-gray-800 pointer-events-none"
                                  />
                                );
                              })}

                              {/* Active draggable window region */}
                              {(() => {
                                const totalMax = Math.max(1, timelinePasses.length - 1);
                                const leftPct = (winStartIdx / totalMax) * 100;
                                const rightPct = 100 - (winEndIdx / totalMax) * 100;
                                return (
                                  <div
                                    style={{
                                      left: `${leftPct}%`,
                                      right: `${rightPct}%`,
                                    }}
                                    onPointerDown={(e) => handleTimelineBrushPointerDown(e, 'pan')}
                                    className="absolute inset-y-0 bg-indigo-500/25 border-y border-indigo-400/60 cursor-grab active:cursor-grabbing flex items-center justify-between min-w-[18px]"
                                  >
                                    {/* Left Resize Handle */}
                                    <div
                                      onPointerDown={(e) =>
                                        handleTimelineBrushPointerDown(e, 'start')
                                      }
                                      className="w-2.5 h-full bg-indigo-500 hover:bg-indigo-400 cursor-ew-resize flex items-center justify-center flex-shrink-0"
                                      title="Drag to adjust timeline window start"
                                    >
                                      <span className="w-0.5 h-3 bg-white/80 rounded-full" />
                                    </div>

                                    {/* Right Resize Handle */}
                                    <div
                                      onPointerDown={(e) =>
                                        handleTimelineBrushPointerDown(e, 'end')
                                      }
                                      className="w-2.5 h-full bg-indigo-500 hover:bg-indigo-400 cursor-ew-resize flex items-center justify-center flex-shrink-0"
                                      title="Drag to adjust timeline window end"
                                    >
                                      <span className="w-0.5 h-3 bg-white/80 rounded-full" />
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* DETAILS PANEL BELOW THE GRAPH: TWO-PERSON TOPIC & SCORE EVOLUTION */}
                      {activeSelection ? (
                        <div className="bg-gray-900 border border-indigo-500/30 rounded-xl p-3.5 sm:p-4 shadow-xl space-y-3 animate-fade-in flex-shrink-0">
                          {/* Top Status Bar with Prev/Next Navigation Moved Up */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-800 pb-2.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className="w-3 h-3 rounded-full inline-block flex-shrink-0"
                                style={{ backgroundColor: activeSelection.group.color.stroke }}
                              />
                              <span className="font-bold text-white text-xs sm:text-sm">
                                {activeSelection.group.label}
                              </span>

                              {/* Prev / Next Point Controls at top of info pane */}
                              <div className="flex items-center gap-1 bg-gray-950 border border-gray-800 rounded-lg p-0.5">
                                <button
                                  onClick={() => {
                                    const pts = activeSelection.group.points;
                                    const idx = activeSelection.pointIndex;
                                    if (idx > 0) setSelectedLogId(pts[idx - 1].log.id);
                                  }}
                                  disabled={activeSelection.pointIndex <= 0}
                                  className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-35 disabled:pointer-events-none text-white text-[11px] font-semibold flex items-center gap-0.5 cursor-pointer transition-colors"
                                  title="Previous point on this trajectory"
                                >
                                  <ChevronLeft className="w-3 h-3" /> Prev
                                </button>
                                <span className="px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-300">
                                  Point {activeSelection.pointIndex + 1} of{' '}
                                  {activeSelection.group.points.length} (Iter #
                                  {activeSelection.log.iteration})
                                </span>
                                <button
                                  onClick={() => {
                                    const pts = activeSelection.group.points;
                                    const idx = activeSelection.pointIndex;
                                    if (idx < pts.length - 1) setSelectedLogId(pts[idx + 1].log.id);
                                  }}
                                  disabled={
                                    activeSelection.pointIndex >=
                                    activeSelection.group.points.length - 1
                                  }
                                  className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-35 disabled:pointer-events-none text-white text-[11px] font-semibold flex items-center gap-0.5 cursor-pointer transition-colors"
                                  title="Next point on this trajectory"
                                >
                                  Next <ChevronRight className="w-3 h-3" />
                                </button>
                              </div>

                              <div className="flex items-center gap-1 text-gray-400 text-xs">
                                <Clock className="w-3.5 h-3.5 text-gray-500" />
                                <span>
                                  {new Date(activeSelection.log.timestamp).toLocaleTimeString()}
                                </span>
                              </div>
                            </div>

                            {/* Score Badge & Expand Toggle */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`px-2.5 py-0.5 rounded-full font-mono font-bold text-xs flex items-center gap-1 ${
                                  activeSelection.log.score >=
                                  (activeSelection.log.threshold ?? matchThreshold)
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                }`}
                                title="Calibrated semantic similarity score"
                              >
                                <Target className="w-3.5 h-3.5" />
                                <span>Score: {activeSelection.log.score}%</span>
                                {activeSelection.point.scoreDelta !== 0 && (
                                  <span className="text-[10px] opacity-90">
                                    ({activeSelection.point.scoreDelta > 0 ? '+' : ''}
                                    {activeSelection.point.scoreDelta}%)
                                  </span>
                                )}
                              </span>
                              {typeof activeSelection.log.cosineSimilarity === 'number' && (
                                <span
                                  className="px-2 py-0.5 rounded-full bg-gray-950 border border-gray-700 text-gray-300 font-mono text-[11px]"
                                  title="Raw mathematical cosine similarity of embedding vectors"
                                >
                                  {activeSelection.log.cosineSimilarity.toFixed(4)} cos
                                </span>
                              )}
                              <button
                                onClick={() => setIsInstanceExpanded(!isInstanceExpanded)}
                                className="flex items-center gap-1 px-2.5 py-0.5 rounded bg-gray-800 hover:bg-gray-750 text-indigo-300 hover:text-white border border-gray-700 text-[10px] font-semibold transition-all cursor-pointer"
                                title={
                                  isInstanceExpanded
                                    ? 'Collapse instance details'
                                    : 'Expand full instance details'
                                }
                              >
                                {isInstanceExpanded ? (
                                  <>
                                    <ChevronUp className="w-3 h-3" />
                                    <span>Collapse</span>
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="w-3 h-3" />
                                    <span>Expand Instance</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* TWO PERSONS' TOPICS & STANCES AT THIS TIMESTAMP */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {/* Person A Card */}
                            <div className="p-2.5 rounded-xl bg-gray-950/90 border border-gray-800 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full inline-block"
                                    style={{ backgroundColor: activeSelection.point.personAColor }}
                                  />
                                  <span className="font-bold text-white text-xs">
                                    {activeSelection.point.personAName}
                                  </span>
                                </div>
                                {activeSelection.point.topicAChanged && (
                                  <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono text-[9px] font-bold">
                                    ↻ TOPIC CHANGED
                                  </span>
                                )}
                              </div>

                              {activeSelection.point.topicAChanged &&
                                activeSelection.point.prevTopicA && (
                                  <div className="flex items-center gap-1 text-[10px] text-gray-400 font-mono">
                                    <span className="line-through opacity-75 truncate max-w-[140px]">
                                      "{activeSelection.point.prevTopicA}"
                                    </span>
                                    <ArrowRight className="w-3 h-3 text-purple-400 flex-shrink-0" />
                                  </div>
                                )}

                              <p className="text-indigo-200 font-semibold text-xs">
                                Topic: "{activeSelection.point.topicA}"
                              </p>
                              {activeSelection.point.stanceA &&
                                activeSelection.point.stanceA !== activeSelection.point.topicA && (
                                  <p
                                    className={`text-[11px] italic leading-snug ${
                                      isInstanceExpanded
                                        ? 'text-gray-300 whitespace-pre-wrap'
                                        : 'text-gray-400 line-clamp-2'
                                    }`}
                                  >
                                    Stance: {activeSelection.point.stanceA}
                                  </p>
                                )}
                            </div>

                            {/* Person B Card */}
                            <div className="p-2.5 rounded-xl bg-gray-950/90 border border-gray-800 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full inline-block"
                                    style={{ backgroundColor: activeSelection.point.personBColor }}
                                  />
                                  <span className="font-bold text-white text-xs">
                                    {activeSelection.point.personBName}
                                  </span>
                                </div>
                                {activeSelection.point.topicBChanged && (
                                  <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono text-[9px] font-bold">
                                    ↻ TOPIC CHANGED
                                  </span>
                                )}
                              </div>

                              {activeSelection.point.topicBChanged &&
                                activeSelection.point.prevTopicB && (
                                  <div className="flex items-center gap-1 text-[10px] text-gray-400 font-mono">
                                    <span className="line-through opacity-75 truncate max-w-[140px]">
                                      "{activeSelection.point.prevTopicB}"
                                    </span>
                                    <ArrowRight className="w-3 h-3 text-purple-400 flex-shrink-0" />
                                  </div>
                                )}

                              <p className="text-cyan-200 font-semibold text-xs">
                                Topic: "{activeSelection.point.topicB}"
                              </p>
                              {activeSelection.point.stanceB &&
                                activeSelection.point.stanceB !== activeSelection.point.topicB && (
                                  <p
                                    className={`text-[11px] italic leading-snug ${
                                      isInstanceExpanded
                                        ? 'text-gray-300 whitespace-pre-wrap'
                                        : 'text-gray-400 line-clamp-2'
                                    }`}
                                  >
                                    Stance: {activeSelection.point.stanceB}
                                  </p>
                                )}
                            </div>
                          </div>

                          {/* EXPANDED INSTANCE EXTENDED CONTEXT */}
                          {isInstanceExpanded && (
                            <div className="p-3 rounded-xl bg-gray-950/90 border border-indigo-500/30 space-y-2 text-[11px] animate-fade-in">
                              <div className="flex items-center justify-between text-[10px] font-bold uppercase text-indigo-400 border-b border-gray-800 pb-1">
                                <span>Diagnostic Evaluation Instance Details</span>
                                <span className="font-mono text-gray-400">
                                  Iter #{activeSelection.log.iteration}
                                </span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-gray-300">
                                <div>
                                  <span className="text-gray-500 font-medium">
                                    Embedding Model:{' '}
                                  </span>
                                  <span className="font-mono text-gray-200">
                                    {activeSelection.log.embeddingModel || activeEmbeddingModel}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-500 font-medium">Evaluated At: </span>
                                  <span className="font-mono text-gray-200">
                                    {new Date(activeSelection.log.timestamp).toLocaleTimeString()} (
                                    {new Date(activeSelection.log.timestamp).toLocaleDateString()})
                                  </span>
                                </div>
                                {activeSelection.log.notes && (
                                  <div className="sm:col-span-2 pt-1">
                                    <span className="text-gray-500 font-medium block">
                                      Nexus / Comparative Analysis:
                                    </span>
                                    <p className="text-gray-300 italic pt-0.5 leading-relaxed">
                                      {activeSelection.log.notes}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Synthesized Bridge Topic & Embedding Notes */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-0.5 text-xs">
                            <div className="p-2.5 rounded-xl bg-gray-950/80 border border-indigo-500/30 space-y-1">
                              <span className="text-[10px] font-bold uppercase text-indigo-400 flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                                Synthesized Bridge Debate Topic:
                              </span>
                              <p className="text-white text-xs font-semibold leading-relaxed">
                                "{activeSelection.log.proposedTopic}"
                              </p>
                            </div>

                            <div className="p-2.5 rounded-xl bg-gray-950/80 border border-gray-800 space-y-1">
                              <span className="text-[10px] font-bold uppercase text-gray-400 flex items-center gap-1">
                                <Info className="w-3.5 h-3.5 text-gray-400" />
                                Embedding Vector Nexus & Notes:
                              </span>
                              <p className="text-gray-300 text-xs italic leading-relaxed">
                                {activeSelection.log.notes}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="py-2.5 px-4 rounded-xl border border-dashed border-gray-800 text-center text-gray-500 text-xs flex-shrink-0 flex items-center justify-center gap-2">
                          <MousePointerClick className="w-4 h-4 text-gray-600 flex-shrink-0" />
                          <span>
                            Hover or tap any point along a trajectory line above to inspect details
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="p-8 text-center text-gray-400 space-y-2 bg-gray-900/40 border border-gray-800 rounded-2xl my-auto">
                      <MousePointerClick className="w-8 h-8 text-indigo-400 mx-auto opacity-70" />
                      <p className="font-bold text-white text-sm">
                        Select at least 2 Connections Above
                      </p>
                      <p className="text-xs text-gray-400 max-w-md mx-auto">
                        Toggle two or more connections (or click "Select All") to display each pair trajectory responding to your selection.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-8 sm:p-12 text-center text-gray-400 space-y-3 bg-gray-900/40 border border-gray-800 rounded-2xl my-auto">
                  <Activity className="w-10 h-10 text-indigo-400 mx-auto opacity-70" />
                  <div className="space-y-1">
                    <p className="font-bold text-white text-sm">
                      No Two-Person Embedding Evaluations Recorded Yet
                    </p>
                    <p className="text-xs text-gray-400 max-w-md mx-auto">
                      Have at least two visitors join topics in the lobby (use Split View or New Session). As they switch topics or practice with Socratic AI, their two-person trajectory line will plot their topic and embedding score changes over time.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DebugMatchView;
