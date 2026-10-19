import React, { useState, useCallback, useRef } from 'react';
import TopicStream from './components/TopicStream';
import VisitorPane from './components/VisitorPane';
import Archive from './components/Archive';
import DebugMatchView from './components/DebugMatchView';
import { useDebateSocket } from './services/useDebateSocket';
import { 
  Network, 
  ExternalLink, 
  Archive as ArchiveLucide, 
  MessagesSquare, 
  MessageSquare,
  Radio,
  Clock,
  RefreshCw,
  X,
} from 'lucide-react';
import { XLogo, RedditLogo, FacebookLogo } from './components/icons/SocialLogos';

const App: React.FC = () => {
  const primarySocket = useDebateSocket();

  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [isPulseOpen, setIsPulseOpen] = useState(false);

  // Resizable Slider between Upper and Lower Halves (15% to 80%)
  const [upperHeightPercent, setUpperHeightPercent] = useState(40);
  const [isResizing, setIsResizing] = useState(false);
  const mainContainerRef = useRef<HTMLElement>(null);

  const handleSliderPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const mainEl = mainContainerRef.current;
    if (!mainEl) return;

    const mainRect = mainEl.getBoundingClientRect();

    const onPointerMove = (moveEvent: PointerEvent) => {
      const offsetY = moveEvent.clientY - mainRect.top;
      const rawPercent = (offsetY / mainRect.height) * 100;
      const clampedPercent = Math.max(15, Math.min(80, rawPercent));
      setUpperHeightPercent(clampedPercent);
    };

    const onPointerUp = () => {
      setIsResizing(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }, []);

  // New window launcher - exclusively located in top header
  const handleOpenNewVisitorWindow = useCallback(() => {
    const randomSeed = 'v_' + Math.random().toString(36).substring(2, 8);
    const url = new URL(window.location.href);
    url.searchParams.set('v', randomSeed);

    const newWindow = window.open(url.toString(), '_blank');
    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
      setShowCopyModal(true);
    }
  }, []);

  const handleCopyLink = () => {
    const randomSeed = 'v_' + Math.random().toString(36).substring(2, 8);
    const url = new URL(window.location.href);
    url.searchParams.set('v', randomSeed);
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2500);
    });
  };

  const handleTopicSelectFromStream = (topicId: string) => {
    primarySocket.selectTopic(topicId);
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-950 text-gray-100 font-sans overflow-hidden select-none">
      {/* Classical Socratic Top Header */}
      <header className="flex h-12 items-center justify-between px-4 bg-gray-950 border-b border-gray-800 flex-shrink-0 z-50 shadow-sm relative">
        <div className="flex items-center gap-2.5">
          <MessagesSquare className="w-5 h-5 text-indigo-400" />
          <span className="font-serif font-bold text-[20px] tracking-wide text-gray-100">
            SocraticAI
          </span>
          <span className="hidden md:inline text-xs italic text-gray-400 font-serif border-l border-gray-800 pl-2.5">
            Agora of Dialogue
          </span>
        </div>

        {/* Global Toolbar Actions and Counters */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Social Media Trends Indicator: Left of online counter */}
          <div className="relative group z-50">
            <button
              onClick={() => {
                setIsPulseOpen((prev) => !prev);
                primarySocket.refreshSocialTrends();
              }}
              className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-850 border border-gray-700/80 hover:border-indigo-500/60 px-2.5 py-1 rounded-md text-xs text-gray-200 transition-colors cursor-pointer"
              title="Public Discourse Trends (Click or hover to inspect X, Reddit, & Facebook trends)"
            >
              <span className="flex items-center gap-1">
                <XLogo className="w-3 h-3 text-gray-200" />
                <RedditLogo className="w-3 h-3 text-orange-500" />
                <FacebookLogo className="w-3 h-3 text-blue-500" />
              </span>
              <span className="text-xs font-medium hidden md:inline text-gray-200">
                Public Pulse
              </span>
            </button>

            {/* Popover showing X, Reddit, and Facebook field boxes with trends */}
            <div
              className={`absolute top-full left-0 sm:left-auto sm:right-0 mt-2 w-80 sm:w-96 max-h-[82vh] overflow-y-auto bg-gray-900 border border-gray-700/80 rounded-xl shadow-2xl p-4 z-50 transition-all duration-200 ${
                isPulseOpen
                  ? 'visible opacity-100 pointer-events-auto'
                  : 'invisible group-hover:visible opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'
              }`}
            >
              <div className="space-y-3 text-xs text-gray-200">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-indigo-400" />
                    <span className="font-bold text-gray-100 text-sm font-serif tracking-wide">
                      Agora Public Pulse
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      primarySocket.refreshSocialTrends();
                    }}
                    className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer bg-gray-800/80 hover:bg-gray-800 px-2 py-1 rounded border border-gray-700/70"
                    title="Refresh Live Social Trends"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Refresh</span>
                  </button>
                </div>

                {/* Last Updated Timestamp */}
                <div className="flex items-center justify-between text-xs bg-gray-950/90 px-3 py-1.5 rounded-lg border border-gray-800">
                  <div className="flex items-center gap-1.5 text-gray-400">
                    <Clock className="w-3.5 h-3.5 text-gray-500" />
                    <span>Last updated:</span>
                  </div>
                  <span className="font-mono text-gray-100 font-semibold">
                    {primarySocket.socialTrendsStatus?.lastFetchedAt
                      ? new Date(primarySocket.socialTrendsStatus.lastFetchedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      : 'Just now'}
                  </span>
                </div>

                {/* 1. X Field Box */}
                <div className="bg-black border border-neutral-800 rounded-lg p-3 space-y-2 shadow-md">
                  <div className="flex items-center gap-1.5 border-b border-neutral-800 pb-1.5">
                    <XLogo className="w-3.5 h-3.5 text-white" />
                    <span className="font-bold text-gray-100 text-xs font-serif tracking-wide">
                      X Trends
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(
                      primarySocket.socialTrendsStatus?.trends?.x || [
                        { title: 'Open-Weight AI Models vs Closed Systems', tag: '#AIAct' },
                        { title: 'Mandatory Remote Work Laws for Tech', tag: '#FutureOfWork' },
                        { title: 'Algorithmic Content Monetization Rights', tag: '#CreatorEconomy' },
                      ]
                    ).map((item, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-2 text-[12px] leading-snug">
                        <span className="text-gray-200 font-medium break-words flex-1">
                          {item.title}
                        </span>
                        {item.tag && (
                          <span className="px-2 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-gray-100 font-mono text-[11px] font-bold flex-shrink-0 shadow-sm">
                            {item.tag}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Reddit Field Box */}
                <div className="bg-[#29150c] border border-orange-900/60 rounded-lg p-3 space-y-2 shadow-md">
                  <div className="flex items-center gap-1.5 border-b border-orange-900/50 pb-1.5">
                    <RedditLogo className="w-3.5 h-3.5 text-orange-500" />
                    <span className="font-bold text-orange-200 text-xs font-serif tracking-wide">
                      Reddit Trends
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(
                      primarySocket.socialTrendsStatus?.trends?.reddit || [
                        { title: 'Reproducibility Crisis in Modern Science', tag: 'r/science' },
                        { title: 'Subscription Culture & Digital Ownership', tag: 'r/technology' },
                        { title: 'Universal Basic Income vs Welfare Systems', tag: 'r/economics' },
                      ]
                    ).map((item, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-2 text-[12px] leading-snug">
                        <span className="text-orange-100 font-medium break-words flex-1">
                          {item.title}
                        </span>
                        {item.tag && (
                          <span className="px-2 py-0.5 rounded bg-orange-950/90 border border-orange-800/80 text-orange-200 font-mono text-[11px] font-bold flex-shrink-0 shadow-sm">
                            {item.tag}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Facebook Field Box */}
                <div className="bg-[#251a0f] border border-amber-900/60 rounded-lg p-3 space-y-2 shadow-md">
                  <div className="flex items-center gap-1.5 border-b border-amber-900/50 pb-1.5">
                    <FacebookLogo className="w-3.5 h-3.5 text-blue-500" />
                    <span className="font-bold text-amber-200 text-xs font-serif tracking-wide">
                      Facebook Trends
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(
                      primarySocket.socialTrendsStatus?.trends?.facebook || [
                        { title: 'Cell Phones and Social Media Bans in K-12', tag: '#EducationFirst' },
                        { title: 'Four-Day Work Week Productivity Boost', tag: '#WorkLifeBalance' },
                        { title: 'Public Subsidies for Independent Local Media', tag: '#CivicDebate' },
                      ]
                    ).map((item, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-2 text-[12px] leading-snug">
                        <span className="text-amber-100 font-medium break-words flex-1">
                          {item.title}
                        </span>
                        {item.tag && (
                          <span className="px-2 py-0.5 rounded bg-amber-950/90 border border-amber-800/80 text-amber-200 font-mono text-[11px] font-bold flex-shrink-0 shadow-sm">
                            {item.tag}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Live Counters (Thinkers Online / Active Dialogues) */}
          <div
            className="flex items-center gap-1.5 bg-gray-900 border border-gray-700/80 px-2.5 py-1 rounded-md text-xs text-gray-300 font-mono"
            title="Thinkers present in the Agora / Ongoing Socratic dialogues"
          >
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
              {primarySocket.onlineCount}
            </span>
            <span className="text-gray-600">/</span>
            <span className="flex items-center gap-1 text-indigo-300">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              {primarySocket.activeDebatesCount}
            </span>
          </div>

          {/* Action 0: Dialogue Graph */}
          <button
            onClick={() => setIsDebugOpen(true)}
            className={`px-2.5 py-1 rounded-md border transition-all text-xs font-medium flex items-center gap-1.5 relative ${
              isDebugOpen
                ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500 ring-1 ring-indigo-500'
                : 'bg-gray-900 hover:bg-gray-800 border-gray-700/80 text-indigo-300 hover:text-indigo-200'
            }`}
            title={`Dialogue Graph (${primarySocket.debugNodes.length} active thinkers)`}
          >
            <Network className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Dialogue Graph</span>
            {primarySocket.debugPairs.some(
              (p) => p.closeness >= (p.threshold ?? primarySocket.matchThreshold)
            ) && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>}
          </button>

          {/* Action 1: New Window */}
          <button
            onClick={handleOpenNewVisitorWindow}
            className="px-2.5 py-1 rounded-md bg-gray-900 hover:bg-gray-800 border border-gray-700/80 text-gray-200 hover:text-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5"
            title="Open new interlocutor window (+)"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Chair</span>
          </button>

          {/* Action 2: Archive */}
          <button
            onClick={() => setIsArchiveOpen(true)}
            className="px-2.5 py-1 rounded-md bg-gray-900 hover:bg-gray-800 border border-gray-700/80 text-gray-200 hover:text-gray-50 transition-colors text-xs font-medium flex items-center gap-1.5 relative"
            title={`Scrolls & Archive (${primarySocket.archivedDebates.length})`}
          >
            <ArchiveLucide className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Archive</span>
            {primarySocket.archivedDebates.length > 0 && (
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400"></span>
            )}
          </button>
        </div>
      </header>

      {/* Main Container with Resizable Slider */}
      <main
        ref={mainContainerRef}
        className={`flex-1 flex flex-col overflow-hidden relative ${
          isResizing ? 'cursor-row-resize select-none pointer-events-none' : ''
        }`}
      >
        {/* UPPER HALF: Dynamic Topic Stream Pool */}
        <section
          style={{ height: `${upperHeightPercent}%` }}
          className="w-full flex-shrink-0 relative overflow-hidden bg-gray-950 pointer-events-auto"
        >
          <TopicStream
            topics={primarySocket.topics}
            carpoolStatus={primarySocket.carpoolStatus}
            currentVisitor={primarySocket.visitor}
            waitingTopicId={primarySocket.waitingTopic?.topicId || null}
            activeTopicId={primarySocket.activeRoom?.topicId || null}
            onTopicSelect={handleTopicSelectFromStream}
          />
        </section>

        {/* DRAGGABLE RESIZER SLIDER BAR */}
        <div
          onPointerDown={handleSliderPointerDown}
          className={`h-2 relative flex items-center justify-center cursor-row-resize transition-all select-none z-30 pointer-events-auto group ${
            isResizing
              ? 'bg-indigo-600 h-2.5'
              : 'bg-gray-850 hover:bg-indigo-600/60 border-y border-gray-700/80'
          }`}
          title="Drag up/down to adjust stream & dialogue chamber height"
        >
          <div
            className={`w-12 h-1 rounded-full transition-colors ${
              isResizing ? 'bg-gray-100' : 'bg-gray-600 group-hover:bg-indigo-300'
            }`}
          />
        </div>

        {/* LOWER HALF: Inline Symposium / Dialogue Chamber */}
        <section
          style={{ height: `${100 - upperHeightPercent}%` }}
          className="w-full flex-1 relative overflow-hidden bg-gray-900 pointer-events-auto"
        >
          <VisitorPane
            socket={primarySocket}
            paneLabel="You"
            isSplitView={false}
            onToggleArchive={() => setIsArchiveOpen(true)}
            onOpenDebugView={() => setIsDebugOpen(true)}
          />
        </section>
      </main>

      {/* Archive Modal Drawer */}
      <Archive
        isOpen={isArchiveOpen}
        onToggle={() => setIsArchiveOpen(!isArchiveOpen)}
        debates={primarySocket.archivedDebates}
      />

      {/* Socratic Alignment & Topic Closeness Graph Modal */}
      <DebugMatchView
        isOpen={isDebugOpen}
        onClose={() => setIsDebugOpen(false)}
        nodes={primarySocket.debugNodes}
        pairs={primarySocket.debugPairs}
        logs={primarySocket.debugLogs}
        matchThreshold={primarySocket.matchThreshold}
        activeEmbeddingModel={primarySocket.activeEmbeddingModel}
        onTriggerEvaluation={primarySocket.triggerDebugEvaluation}
        onSetMatchThreshold={primarySocket.setMatchThreshold}
      />

      {/* Direct link modal fallback */}
      {showCopyModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-sm w-full p-4 space-y-3 shadow-2xl text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-100 font-serif">Invite a Fellow Interlocutor</span>
              <button
                onClick={() => setShowCopyModal(false)}
                className="text-gray-400 hover:text-gray-100 p-1 rounded hover:bg-gray-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-1.5">
              <input
                type="text"
                readOnly
                value={`${window.location.origin}${window.location.pathname}?v=v_${Math.random().toString(36).substring(2, 7)}`}
                className="flex-1 bg-gray-950 border border-gray-800 rounded px-2.5 py-1.5 text-gray-200 text-xs truncate font-mono"
              />
              <button
                onClick={handleCopyLink}
                className="bg-indigo-600 hover:bg-indigo-500 text-gray-100 px-3 py-1.5 rounded text-xs font-semibold whitespace-nowrap transition-colors"
              >
                {copiedNotification ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
