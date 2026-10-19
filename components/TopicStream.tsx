import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { TopicItem, TopicCarpoolStatus, Visitor } from '../types';
import { INITIAL_PREDEFINED_TOPICS } from '../constants';
import {
  Search,
  X,
  LayoutGrid,
  List,
  Play,
  Pause,
  Pencil,
  Check,
} from 'lucide-react';
import { XLogo, RedditLogo, FacebookLogo } from './icons/SocialLogos';

interface TopicStreamProps {
  topics: TopicItem[];
  carpoolStatus: Record<string, TopicCarpoolStatus>;
  currentVisitor: Visitor | null;
  waitingTopicId: string | null;
  activeTopicId?: string | null;
  onTopicSelect: (topicId: string) => void;
  onEditTopic?: (topicId: string, title: string) => void;
}

// Build fallback topics for instant zero-gap startup before WebSocket init:state arrives
const FALLBACK_STARTUP_TOPICS: TopicItem[] = (() => {
  const list: TopicItem[] = [];
  let counter = 1;
  INITIAL_PREDEFINED_TOPICS.forEach((row, rowIndex) => {
    row.forEach((title) => {
      list.push({
        id: `top-${counter++}`,
        title,
        createdAt: 0,
        createdBy: 'System',
        rowIndex,
      });
    });
  });
  return list;
})();

interface PillDomRefs {
  key: string;
  button: HTMLButtonElement;
  titleWrap: HTMLSpanElement;
  titleText: HTMLSpanElement;
  tagBadge: HTMLSpanElement | null;
  rIdx: number;
  itemIdx: number;
  fullTargetWidth: number;
}

const BASE_MAX_W = 215;
// Minimum items in a single `base` copy so even on 4K/ultrawide screens at -50% offset there is never a gap
const MIN_ITEMS_PER_COPY = 20;

const TopicStream: React.FC<TopicStreamProps> = ({
  topics,
  carpoolStatus,
  waitingTopicId,
  activeTopicId,
  onTopicSelect,
  onEditTopic,
}) => {
  const [isPaused, setIsPaused] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [showGridView, setShowGridView] = useState(false);

  // Inline editing state for Grid / List View
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState<number>(220);

  // Refs for stable per-row pause & demand-driven honeycomb zoom
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const hoveredRowRef = useRef<number | null>(null);
  const hoveredKeyRef = useRef<string | null>(null);
  const hoveredItemIdxRef = useRef<number | null>(null);
  const lastFocalKeyPerRowRef = useRef<Record<number, string>>({});

  // Layer 1: CSS marquee outer track
  const rowMarqueeRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const lockedRowWidthRef = useRef<Record<number, number>>({});

  // Layer 2: Flexbox inner track
  const rowFlexRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const rowFlexShiftRef = useRef<Record<number, number>>({});

  // Pill DOM refs indexed by row -> key
  const rowPillsMapRef = useRef<Map<number, Map<string, PillDomRefs>>>(new Map());
  const pillZoomValuesRef = useRef<Map<string, number>>(new Map());
  const activeZoomedKeysRef = useRef<Set<string>>(new Set());
  const animFrameIdRef = useRef<number | null>(null);

  const [stableTopics, setStableTopics] = useState<TopicItem[]>(() =>
    topics.length > 0 ? topics : FALLBACK_STARTUP_TOPICS
  );
  const pendingTopicsRef = useRef<TopicItem[] | null>(null);

  useEffect(() => {
    if (topics.length === 0) return;
    if (hoveredRowRef.current !== null) {
      pendingTopicsRef.current = topics;
    } else {
      pendingTopicsRef.current = null;
      setStableTopics((prev) => {
        if (
          prev.length === topics.length &&
          prev.every((t, i) => t.id === topics[i].id && t.title === topics[i].title)
        ) {
          return prev;
        }
        return topics;
      });
    }
  }, [topics]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setContainerHeight(entry.contentRect.height);
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Allocate 42px per row for comfortable larger classical typography
  const availableHeight = Math.max(60, containerHeight - 36);
  const dynamicRowCount = Math.max(2, Math.min(10, Math.floor(availableHeight / 42)));

  // Deterministic random placement based ONLY on `topic.id`
  const randomizedTopics = useMemo(() => {
    const list = [...stableTopics];
    for (let i = list.length - 1; i > 0; i--) {
      let hash = 0;
      const str = list[i].id;
      for (let c = 0; c < str.length; c++) {
        hash = (hash << 5) - hash + str.charCodeAt(c);
        hash |= 0;
      }
      const j = Math.abs(hash * 1664525 + 1013904223) % (i + 1);
      const temp = list[i];
      list[i] = list[j];
      list[j] = temp;
    }
    return list;
  }, [stableTopics]);

  const rows: TopicItem[][] = useMemo(() => {
    const r: TopicItem[][] = Array.from({ length: dynamicRowCount }, () => []);
    randomizedTopics.forEach((topic, idx) => {
      r[idx % dynamicRowCount].push(topic);
    });
    return r;
  }, [randomizedTopics, dynamicRowCount]);

  const normalizedRows = useMemo(() => {
    return rows.map((row, rIdx) => {
      const source = row.length > 0 ? row : FALLBACK_STARTUP_TOPICS.slice(0, 8);

      const rowCopy = [...source];
      for (let i = rowCopy.length - 1; i > 0; i--) {
        const j = (i * 37 + rIdx * 19 + 7) % (i + 1);
        const temp = rowCopy[i];
        rowCopy[i] = rowCopy[j];
        rowCopy[j] = temp;
      }

      let base = [...rowCopy];
      while (base.length < MIN_ITEMS_PER_COPY) {
        base = [...base, ...rowCopy];
      }

      return [...base, ...base];
    });
  }, [rows]);

  useEffect(() => {
    for (let rIdx = 0; rIdx < dynamicRowCount; rIdx++) {
      const marqueeEl = rowMarqueeRefs.current[rIdx];
      if (!marqueeEl) continue;
      const shouldPause = isPaused || hoveredRowRef.current === rIdx;
      marqueeEl.style.animationPlayState = shouldPause ? 'paused' : 'running';
    }
  }, [isPaused, dynamicRowCount]);

  // Pure style write helper with larger readable font scaling
  const applyPillFlexboxStyles = useCallback(
    (refs: PillDomRefs, nextZ: number, isDirectlyHovered: boolean) => {
      if (nextZ <= 0) {
        refs.button.style.fontSize = '';
        refs.button.style.paddingTop = '';
        refs.button.style.paddingBottom = '';
        refs.button.style.paddingLeft = '';
        refs.button.style.paddingRight = '';
        refs.button.style.boxShadow = '';
        refs.titleWrap.style.maxWidth = '';
        refs.titleText.style.overflow = '';
        refs.titleText.style.textOverflow = '';
        if (refs.tagBadge) {
          refs.tagBadge.style.display = 'none';
        }
        return;
      }

      const fontSize = 13 + nextZ * 3.2; // 13px base up to 16.2px on hover
      const padY = 3 + nextZ * 3.5;
      const padX = 11 + nextZ * 5.0;

      const targetMaxW = isDirectlyHovered
        ? refs.fullTargetWidth
        : BASE_MAX_W + nextZ * 135;
      const currentMaxW = BASE_MAX_W + nextZ * (targetMaxW - BASE_MAX_W);

      refs.button.style.fontSize = `${fontSize.toFixed(1)}px`;
      refs.button.style.paddingTop = `${padY.toFixed(1)}px`;
      refs.button.style.paddingBottom = `${padY.toFixed(1)}px`;
      refs.button.style.paddingLeft = `${padX.toFixed(1)}px`;
      refs.button.style.paddingRight = `${padX.toFixed(1)}px`;
      refs.titleWrap.style.maxWidth = `${Math.round(currentMaxW)}px`;

      if (isDirectlyHovered && nextZ > 0.82) {
        refs.titleText.style.overflow = 'visible';
        refs.titleText.style.textOverflow = 'clip';
      } else {
        refs.titleText.style.overflow = 'hidden';
        refs.titleText.style.textOverflow = 'ellipsis';
      }

      if (isDirectlyHovered) {
        refs.button.style.boxShadow = '0 6px 20px -4px rgba(204, 132, 41, 0.45)';
        if (refs.tagBadge) {
          refs.tagBadge.style.display = 'inline-block';
        }
      } else {
        refs.button.style.boxShadow = '';
        if (refs.tagBadge) {
          refs.tagBadge.style.display = 'none';
        }
      }
    },
    []
  );

  const startHoneycombLoop = useCallback(() => {
    if (animFrameIdRef.current !== null) return;

    const tick = () => {
      const activeRow = hoveredRowRef.current;
      const activeKey = hoveredKeyRef.current;
      const activeItemIdx = hoveredItemIdxRef.current;

      const targetZooms = new Map<string, number>();

      if (activeRow !== null && activeKey !== null && activeItemIdx !== null) {
        const rowMap = rowPillsMapRef.current.get(activeRow);
        if (rowMap) {
          rowMap.forEach((refs, key) => {
            const distIdx = Math.abs(refs.itemIdx - activeItemIdx);
            if (distIdx === 0) {
              targetZooms.set(key, 1.0);
            } else if (distIdx === 1) {
              targetZooms.set(key, 0.62);
            } else if (distIdx === 2) {
              targetZooms.set(key, 0.3);
            } else if (distIdx === 3) {
              targetZooms.set(key, 0.12);
            }
          });
        }
      }

      let beforeFocalCenter: number | null = null;
      let focalRefs: PillDomRefs | undefined;
      if (activeRow !== null) {
        const focalKey = lastFocalKeyPerRowRef.current[activeRow];
        const rowMap = rowPillsMapRef.current.get(activeRow);
        focalRefs = focalKey && rowMap ? rowMap.get(focalKey) : undefined;
        if (focalRefs) {
          beforeFocalCenter =
            focalRefs.button.offsetLeft + focalRefs.button.offsetWidth * 0.5;
        }
      }

      const keysToProcess = new Set<string>(activeZoomedKeysRef.current);
      targetZooms.forEach((_, k) => keysToProcess.add(k));

      let anyStillAnimating = false;

      keysToProcess.forEach((key) => {
        let refs: PillDomRefs | undefined;
        for (let r = 0; r < dynamicRowCount; r++) {
          const m = rowPillsMapRef.current.get(r);
          if (m && m.has(key)) {
            refs = m.get(key);
            break;
          }
        }
        if (!refs) {
          activeZoomedKeysRef.current.delete(key);
          pillZoomValuesRef.current.delete(key);
          return;
        }

        const targetZ = targetZooms.get(key) ?? 0;
        const prevZ = pillZoomValuesRef.current.get(key) ?? 0;
        const diff = targetZ - prevZ;

        let nextZ: number;
        if (Math.abs(diff) < 0.003) {
          nextZ = targetZ;
        } else {
          nextZ = prevZ + diff * 0.26;
          anyStillAnimating = true;
        }

        if (nextZ > 0) {
          activeZoomedKeysRef.current.add(key);
        } else {
          activeZoomedKeysRef.current.delete(key);
        }

        if (nextZ !== prevZ) {
          pillZoomValuesRef.current.set(key, nextZ);
          const isDirectlyHovered = activeKey === key && nextZ > 0.05;
          applyPillFlexboxStyles(refs, nextZ, isDirectlyHovered);
        }
      });

      for (let rIdx = 0; rIdx < dynamicRowCount; rIdx++) {
        const flexEl = rowFlexRefs.current[rIdx];
        const marqueeEl = rowMarqueeRefs.current[rIdx];
        if (!flexEl) continue;

        let shiftX = rowFlexShiftRef.current[rIdx] ?? 0;

        if (rIdx === activeRow && focalRefs && beforeFocalCenter !== null) {
          const afterFocalCenter =
            focalRefs.button.offsetLeft + focalRefs.button.offsetWidth * 0.5;
          const deltaC = afterFocalCenter - beforeFocalCenter;
          if (Math.abs(deltaC) > 0.02) {
            shiftX += deltaC;
            rowFlexShiftRef.current[rIdx] = shiftX;
            flexEl.style.transform = `translate3d(${-shiftX.toFixed(2)}px, 0, 0)`;
          }
        } else if (rIdx !== activeRow) {
          const rowMap = rowPillsMapRef.current.get(rIdx);
          let rowHasZoom = false;
          if (rowMap) {
            rowMap.forEach((_, k) => {
              if ((pillZoomValuesRef.current.get(k) ?? 0) > 0) {
                rowHasZoom = true;
              }
            });
          }

          if (Math.abs(shiftX) > 0.1) {
            shiftX *= 0.78;
            if (Math.abs(shiftX) <= 0.15 && !rowHasZoom) {
              shiftX = 0;
              rowFlexShiftRef.current[rIdx] = 0;
              flexEl.style.transform = '';
            } else {
              rowFlexShiftRef.current[rIdx] = shiftX;
              flexEl.style.transform = `translate3d(${-shiftX.toFixed(2)}px, 0, 0)`;
              anyStillAnimating = true;
            }
          }

          if (!rowHasZoom && shiftX === 0 && lockedRowWidthRef.current[rIdx]) {
            delete lockedRowWidthRef.current[rIdx];
            if (marqueeEl) {
              marqueeEl.style.width = '';
            }
          }
        }
      }

      if (anyStillAnimating) {
        animFrameIdRef.current = requestAnimationFrame(tick);
      } else {
        animFrameIdRef.current = null;
      }
    };

    animFrameIdRef.current = requestAnimationFrame(tick);
  }, [dynamicRowCount, applyPillFlexboxStyles]);

  useEffect(() => {
    return () => {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, []);

  const updateRowPauseState = useCallback(
    (hoveredRow: number | null) => {
      hoveredRowRef.current = hoveredRow;

      for (let rIdx = 0; rIdx < dynamicRowCount; rIdx++) {
        const marqueeEl = rowMarqueeRefs.current[rIdx];
        const flexEl = rowFlexRefs.current[rIdx];
        if (!marqueeEl) continue;

        const shouldPause = isPausedRef.current || hoveredRow === rIdx;

        if (hoveredRow === rIdx && flexEl && !lockedRowWidthRef.current[rIdx]) {
          const unzoomedW = flexEl.offsetWidth;
          if (unzoomedW > 0) {
            lockedRowWidthRef.current[rIdx] = unzoomedW;
            marqueeEl.style.width = `${unzoomedW}px`;
          }
        }

        marqueeEl.style.animationPlayState = shouldPause ? 'paused' : 'running';
      }

      if (hoveredRow === null && pendingTopicsRef.current) {
        const deferred = pendingTopicsRef.current;
        pendingTopicsRef.current = null;
        setStableTopics(deferred);
      }
    },
    [dynamicRowCount]
  );

  const handlePointerLeaveStream = useCallback(() => {
    hoveredKeyRef.current = null;
    hoveredItemIdxRef.current = null;
    updateRowPauseState(null);
    startHoneycombLoop();
  }, [updateRowPauseState, startHoneycombLoop]);

  const filteredTopics = filterQuery.trim()
    ? stableTopics.filter((t) =>
        t.title.toLowerCase().includes(filterQuery.toLowerCase())
      )
    : stableTopics;

  const handleSaveEdit = (topicId: string) => {
    if (editingTitle.trim() && onEditTopic) {
      onEditTopic(topicId, editingTitle.trim());
    }
    setEditingTopicId(null);
    setEditingTitle('');
  };

  // Helper to get classical Socratic / Greek parchment & terracotta visuals with Lucide icons
  const getTopicVisuals = (topic: TopicItem, isListMode = false) => {
    const status = carpoolStatus[topic.id];
    const waitingCount = status?.waitingCount || 0;
    const activeCount = status?.activeDebatesCount || 0;
    const isUserWaiting = waitingTopicId === topic.id;
    const isUserDebating = activeTopicId === topic.id;

    let platformClass = '';
    let platformLabel = '';
    if (topic.platform === 'x') {
      platformClass =
        'bg-gray-900/95 text-gray-100 border-gray-700 hover:border-indigo-400 hover:text-gray-50 shadow-sm';
      platformLabel = 'X';
    } else if (topic.platform === 'reddit') {
      platformClass =
        'bg-[#29150c] text-orange-100 border-orange-800/70 hover:border-orange-400 hover:text-gray-50 shadow-sm';
      platformLabel = 'Reddit';
    } else if (topic.platform === 'facebook') {
      platformClass =
        'bg-[#251a0f] text-amber-100 border-amber-800/70 hover:border-amber-400 hover:text-gray-50 shadow-sm';
      platformLabel = 'Facebook';
    }

    let badgeClass =
      platformClass ||
      'bg-gray-900/95 text-gray-100 border-gray-700/90 hover:border-indigo-400 hover:text-gray-50';

    let counterIndicator = (
      <span className="flex items-center gap-1 font-mono text-[11px] text-gray-500 font-semibold flex-shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-600"></span>
        0/2
      </span>
    );

    if (isUserWaiting) {
      badgeClass = `${platformClass || 'bg-amber-950/80'} ring-2 ring-amber-500 border-amber-400 text-amber-200 animate-pulse`;
      counterIndicator = (
        <span className="flex items-center gap-1 font-mono text-[11px] text-amber-300 font-bold flex-shrink-0">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping"></span>
          1/2
        </span>
      );
    } else if (isUserDebating) {
      badgeClass = `${platformClass || 'bg-indigo-950/80'} ring-2 ring-indigo-500 border-indigo-400 text-indigo-200`;
      counterIndicator = (
        <span className="flex items-center gap-1 font-mono text-[11px] text-indigo-300 font-bold flex-shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400"></span>
          2/2
        </span>
      );
    } else if (waitingCount > 0) {
      badgeClass = `${platformClass || 'bg-amber-950/70'} ring-1 ring-amber-500/80 border-amber-500 text-amber-100 ${
        isListMode ? 'hover:scale-102' : ''
      } shadow-md shadow-amber-950/40`;
      counterIndicator = (
        <span className="flex items-center gap-1 font-mono text-[11px] text-amber-300 font-bold flex-shrink-0">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping"></span>
          1/2
        </span>
      );
    } else if (activeCount > 0) {
      badgeClass = `${platformClass || 'bg-emerald-950/40'} border-emerald-700/60 text-emerald-200 hover:bg-emerald-900/40`;
      counterIndicator = (
        <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400 font-bold flex-shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
          2/2
        </span>
      );
    }

    const platformLogoElement = topic.platform ? (
      <span className="flex-shrink-0 flex items-center pr-1" title={`${platformLabel} Discourse`}>
        {topic.platform === 'x' && <XLogo className="w-3.5 h-3.5 text-gray-200 flex-shrink-0" />}
        {topic.platform === 'reddit' && <RedditLogo className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />}
        {topic.platform === 'facebook' && <FacebookLogo className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
      </span>
    ) : null;

    return { badgeClass, counterIndicator, platformLogoElement, platformLabel };
  };

  // Render List / Grid card with inline Topic Editing
  const renderListCard = (topic: TopicItem) => {
    const { badgeClass, counterIndicator, platformLogoElement, platformLabel } =
      getTopicVisuals(topic, true);
    const isEditing = editingTopicId === topic.id;

    if (isEditing) {
      return (
        <div
          key={topic.id}
          className="flex items-center gap-2 rounded-lg border border-indigo-500 bg-gray-900 p-2.5 shadow-lg"
        >
          <input
            type="text"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit(topic.id);
              if (e.key === 'Escape') setEditingTopicId(null);
            }}
            autoFocus
            className="flex-1 bg-gray-950 border border-gray-700 rounded px-2.5 py-1 text-xs sm:text-sm text-gray-100 focus:outline-none focus:border-indigo-400"
          />
          <button
            type="button"
            onClick={() => handleSaveEdit(topic.id)}
            className="p-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-gray-100 transition-colors cursor-pointer"
            title="Save topic title"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setEditingTopicId(null)}
            className="p-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors cursor-pointer"
            title="Cancel edit"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }

    return (
      <div
        key={topic.id}
        className={`group relative flex items-start justify-between gap-2 rounded-lg border p-3 transition-all text-left text-xs sm:text-sm font-medium ${badgeClass}`}
      >
        <button
          type="button"
          onClick={() => onTopicSelect(topic.id)}
          className="flex-1 min-w-0 space-y-1 text-left cursor-pointer"
        >
          <div className="flex items-start gap-1.5">
            {platformLogoElement}
            <span className="break-words whitespace-normal leading-snug group-hover:text-gray-50">
              {topic.title}
            </span>
          </div>
          {topic.trendTag && (
            <div className="flex items-center gap-1 pt-0.5">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-gray-300 font-semibold border border-gray-700">
                {topic.trendTag}
              </span>
              <span className="text-[9px] uppercase font-bold text-gray-500 font-mono">
                {platformLabel} Discourse
              </span>
            </div>
          )}
        </button>

        <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5 border-l border-gray-700/60 pl-2">
          {onEditTopic && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditingTopicId(topic.id);
                setEditingTitle(topic.title);
              }}
              className="p-1 rounded text-gray-400 hover:text-indigo-300 hover:bg-gray-800/80 transition-colors cursor-pointer"
              title="Edit inquiry title"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {counterIndicator}
        </div>
      </div>
    );
  };

  // Render Stream Pill with classical tablet/scroll proportion
  const renderStreamPill = (
    topic: TopicItem,
    instanceKey: string,
    rIdx: number,
    itemIdx: number
  ) => {
    const { badgeClass, counterIndicator, platformLogoElement } =
      getTopicVisuals(topic, false);

    const fullTargetWidth = Math.max(
      250,
      Math.ceil(topic.title.length * 9.8 + (topic.trendTag ? 110 : 50))
    );

    return (
      <button
        key={instanceKey}
        ref={(btn) => {
          if (!btn) return;
          let rowMap = rowPillsMapRef.current.get(rIdx);
          if (!rowMap) {
            rowMap = new Map();
            rowPillsMapRef.current.set(rIdx, rowMap);
          }

          const titleWrap = btn.querySelector('[data-role="title-wrap"]') as HTMLSpanElement;
          const titleText = btn.querySelector('[data-role="title-text"]') as HTMLSpanElement;
          const tagBadge = btn.querySelector('[data-role="trend-tag"]') as HTMLSpanElement | null;
          if (titleWrap && titleText) {
            rowMap.set(instanceKey, {
              key: instanceKey,
              button: btn,
              titleWrap,
              titleText,
              tagBadge,
              rIdx,
              itemIdx,
              fullTargetWidth,
            });
          }
        }}
        onClick={() => onTopicSelect(topic.id)}
        onPointerEnter={() => {
          if (hoveredRowRef.current !== rIdx) {
            updateRowPauseState(rIdx);
          }
          if (hoveredKeyRef.current !== instanceKey) {
            hoveredKeyRef.current = instanceKey;
            hoveredItemIdxRef.current = itemIdx;
            lastFocalKeyPerRowRef.current[rIdx] = instanceKey;
            startHoneycombLoop();
          }
        }}
        className={`group relative flex items-center justify-between gap-2 rounded-md border px-3.5 py-1 text-left flex-shrink-0 cursor-pointer text-[13px] font-medium select-none transition-colors ${badgeClass}`}
      >
        <span
          data-role="title-wrap"
          className="flex items-center gap-1.5 max-w-[185px] sm:max-w-[215px] overflow-hidden"
        >
          {platformLogoElement}
          <span data-role="title-text" className="truncate group-hover:text-gray-50">
            {topic.title}
          </span>
          {topic.trendTag && (
            <span
              data-role="trend-tag"
              style={{ display: 'none' }}
              className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/50 text-indigo-200 border border-gray-700 flex-shrink-0"
            >
              {topic.trendTag}
            </span>
          )}
        </span>
        <span className="border-l border-gray-700/60 pl-1.5 flex-shrink-0">
          {counterIndicator}
        </span>
      </button>
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-full w-full overflow-hidden bg-gray-950"
    >
      {/* Top Header Toolbar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-gray-950 border-b border-gray-800 z-30 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
          </span>
          <span className="text-xs uppercase tracking-widest font-bold text-gray-200 font-serif">
            Subjects of Inquiry
          </span>
          <span className="text-[11px] text-gray-400 font-mono">
            ({stableTopics.length} subjects • {dynamicRowCount} stoa lanes)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Quick Search */}
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder="Filter or edit inquiries..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-32 sm:w-48 bg-gray-900 border border-gray-700/80 rounded-md pl-7 pr-2.5 py-1 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2 pointer-events-none" />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="absolute right-2 text-gray-500 hover:text-gray-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Pause / Play marquee animation */}
          {!showGridView && (
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="p-1.5 rounded bg-gray-900 hover:bg-gray-850 border border-gray-700/80 text-gray-300 hover:text-gray-100 transition-colors"
              title={isPaused ? 'Resume stream' : 'Pause stream'}
            >
              {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Toggle Grid / Stream mode */}
          <button
            onClick={() => setShowGridView(!showGridView)}
            className={`p-1.5 rounded border transition-colors ${
              showGridView
                ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500'
                : 'bg-gray-900 hover:bg-gray-850 border-gray-700/80 text-gray-300 hover:text-gray-100'
            }`}
            title={showGridView ? 'Switch to flowing stream' : 'Switch to tablet index & edit mode'}
          >
            {showGridView ? <List className="w-3.5 h-3.5" /> : <LayoutGrid className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Topic Area */}
      {showGridView || filterQuery ? (
        /* Full Grid / List View */
        <div className="flex-1 overflow-y-auto p-3.5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 bg-gray-950">
          {filteredTopics.length > 0 ? (
            filteredTopics.map((topic) => renderListCard(topic))
          ) : (
            <div className="col-span-full py-8 text-center text-gray-500 text-sm italic">
              No subjects matching "{filterQuery}"
            </div>
          )}
        </div>
      ) : (
        /* Multi-lane Infinite Marquee Stream */
        <div
          onPointerLeave={handlePointerLeaveStream}
          className="flex-1 flex flex-col justify-evenly py-1 overflow-hidden relative select-none"
        >
          {normalizedRows.map((rowTopics, rIdx) => {
            const isRowCurrentlyPaused = isPaused || hoveredRowRef.current === rIdx;
            const lockedW = lockedRowWidthRef.current[rIdx];

            return (
              <div
                key={rIdx}
                onPointerEnter={() => {
                  if (hoveredRowRef.current !== rIdx) {
                    updateRowPauseState(rIdx);
                    startHoneycombLoop();
                  }
                }}
                onPointerLeave={() => {
                  if (hoveredRowRef.current === rIdx) {
                    hoveredKeyRef.current = null;
                    hoveredItemIdxRef.current = null;
                    updateRowPauseState(null);
                    startHoneycombLoop();
                  }
                }}
                className="flex items-center h-10 overflow-hidden whitespace-nowrap relative flex-shrink-0"
              >
                {/* Layer 1: CSS Marquee Track */}
                <div
                  ref={(el) => {
                    rowMarqueeRefs.current[rIdx] = el;
                  }}
                  style={{
                    animationDuration: `${75 + (rIdx % 4) * 12}s`,
                    animationPlayState: isRowCurrentlyPaused ? 'paused' : 'running',
                    width: lockedW ? `${lockedW}px` : undefined,
                  }}
                  className={rIdx % 2 === 0 ? 'animate-marquee' : 'animate-marquee-reverse'}
                >
                  {/* Layer 2: Flexbox Inner Track */}
                  <div
                    ref={(el) => {
                      rowFlexRefs.current[rIdx] = el;
                    }}
                    className="flex items-center gap-2.5 pr-2.5 w-max will-change-transform"
                  >
                    {rowTopics.map((topic, i) =>
                      renderStreamPill(topic, `${topic.id}-${rIdx}-${i}`, rIdx, i)
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TopicStream;
