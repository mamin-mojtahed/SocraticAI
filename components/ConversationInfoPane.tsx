import React, { useState, useEffect } from 'react';
import type { DebateRoom, TopicItem, Visitor } from '../types';
import {
  MessagesSquare,
  Sparkles,
  MessageSquareText,
  Check,
  X,
} from 'lucide-react';
import { XLogo, RedditLogo, FacebookLogo } from './icons/SocialLogos';

interface ConversationInfoPaneProps {
  room: DebateRoom;
  currentVisitor: Visitor | null;
  topics: TopicItem[];
  opponentTyping: boolean;
  onLeaveDebate: () => void;
}

const ConversationInfoPane: React.FC<ConversationInfoPaneProps> = ({
  room,
  currentVisitor,
  topics,
  opponentTyping,
  onLeaveDebate,
}) => {
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - room.createdAt) / 1000))
  );

  useEffect(() => {
    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - room.createdAt) / 1000)));
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - room.createdAt) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [room.createdAt]);

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')}`;
  };

  const me =
    room.debater1.id === currentVisitor?.id ? room.debater1 : room.debater2;
  const opponent =
    room.debater1.id === currentVisitor?.id ? room.debater2 : room.debater1;

  const matchedTopic = topics.find((t) => t.id === room.topicId);
  const exchangeCount = room.messages.filter((m) => !m.isSystem).length;

  return (
    <div className="flex flex-col h-full w-full bg-gray-950 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-2 px-2.5 sm:px-4 py-1.5 bg-gray-950 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] sm:text-xs uppercase tracking-wider font-bold text-emerald-400 font-serif whitespace-nowrap">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <span>Active Dialogue</span>
          </span>

          <span className="text-gray-700">•</span>

          {/* Elapsed Timer */}
          <span
            className="flex items-center gap-1 text-[11px] font-mono text-gray-300 whitespace-nowrap"
            title="Dialogue duration"
          >
            <span>{formatDuration(elapsedSeconds)}</span>
          </span>

          {/* Exchange Counter */}
          <span
            className="hidden xs:flex sm:flex items-center gap-1 text-[11px] font-mono text-gray-400 whitespace-nowrap border-l border-gray-800 pl-2"
            title="Messages exchanged"
          >
            <MessageSquareText className="w-3 h-3 text-emerald-400 flex-shrink-0" />
            <span>
              {exchangeCount} {exchangeCount === 1 ? 'exchange' : 'exchanges'}
            </span>
          </span>
        </div>

        {/* Conclude Dialogue Action */}
        <div className="flex items-center flex-shrink-0">
          {showConfirmLeave ? (
            <div className="flex items-center gap-1 bg-red-950/90 border border-red-700 px-2 py-0.5 rounded text-xs">
              <span className="text-red-200 font-medium text-[11px]">Conclude?</span>
              <button
                type="button"
                onClick={onLeaveDebate}
                className="bg-red-700 hover:bg-red-600 text-gray-100 font-bold p-1 rounded transition-colors cursor-pointer"
                title="Confirm concluding dialogue"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmLeave(false)}
                className="text-gray-300 hover:text-gray-100 p-1 transition-colors cursor-pointer"
                title="Cancel"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowConfirmLeave(true)}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded bg-gray-900 hover:bg-red-950/60 border border-gray-700/80 hover:border-red-700/70 text-gray-300 hover:text-red-200 text-[11px] sm:text-xs font-medium transition-colors cursor-pointer"
              title="Conclude Socratic dialogue"
            >
              <X className="w-3.5 h-3.5" />
              <span>Conclude</span>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Conversation Details Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 sm:p-3.5 flex flex-col justify-between gap-2 sm:gap-3">
        {/* 1. Subject of Inquiry Banner */}
        <div
          className={`rounded-xl border p-2.5 sm:p-3.5 shadow-md ${
            matchedTopic?.platform === 'x'
              ? 'bg-black border-neutral-800'
              : matchedTopic?.platform === 'reddit'
              ? 'bg-[#29150c] border-orange-900/60'
              : matchedTopic?.platform === 'facebook'
              ? 'bg-[#251a0f] border-amber-900/60'
              : 'bg-gray-900/90 border-gray-800'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-widest font-bold text-indigo-400 font-serif">
                Subject of Inquiry
              </span>
              {room.isBridgeMatch && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-950/90 border border-indigo-500/40 text-[10px] font-mono font-bold text-emerald-300">
                  <Sparkles className="w-2.5 h-2.5 text-indigo-400" />
                  {room.closeness ? `${room.closeness}% Harmony` : 'Synthesized Bridge'}
                </span>
              )}
            </div>

            {matchedTopic?.platform && (
              <div className="flex items-center gap-1.5">
                {matchedTopic.platform === 'x' && (
                  <XLogo className="w-3 h-3 text-gray-200" />
                )}
                {matchedTopic.platform === 'reddit' && (
                  <RedditLogo className="w-3 h-3 text-orange-500" />
                )}
                {matchedTopic.platform === 'facebook' && (
                  <FacebookLogo className="w-3 h-3 text-blue-500" />
                )}
                {matchedTopic.trendTag && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/80 text-indigo-200 font-bold border border-gray-600/80">
                    {matchedTopic.trendTag}
                  </span>
                )}
              </div>
            )}
          </div>

          <h2 className="font-serif font-bold text-xs sm:text-base md:text-lg text-gray-100 leading-snug break-words">
            {room.topicTitle}
          </h2>

          {room.isBridgeMatch &&
            (room.debater1OriginalTopic || room.debater2OriginalTopic) && (
              <div className="mt-1.5 pt-1.5 border-t border-gray-800/80 flex flex-wrap items-center gap-1.5 text-[10px] sm:text-[11px] text-gray-400 font-mono">
                <span className="text-gray-500 font-sans font-semibold">Bridged from:</span>
                {room.debater1OriginalTopic && (
                  <span className="text-indigo-300 truncate max-w-[220px] sm:max-w-[300px]">
                    "{room.debater1OriginalTopic}"
                  </span>
                )}
                {room.debater1OriginalTopic && room.debater2OriginalTopic && (
                  <span className="text-gray-600">⟷</span>
                )}
                {room.debater2OriginalTopic && (
                  <span className="text-indigo-300 truncate max-w-[220px] sm:max-w-[300px]">
                    "{room.debater2OriginalTopic}"
                  </span>
                )}
              </div>
            )}
        </div>

        {/* 2. Seated Interlocutors (2-Seat Symposium Info) */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 sm:gap-3">
          {/* Seat 1: You */}
          <div className="flex items-center gap-2 p-2 sm:p-2.5 rounded-lg bg-gray-900/90 border border-indigo-500/40 min-w-0">
            <div
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold text-gray-100 shadow-sm border border-white/20 flex-shrink-0 font-serif"
              style={{ backgroundColor: me?.color || '#c88a32' }}
            >
              {me?.name?.charAt(0) || 'Y'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="font-bold text-gray-100 text-xs truncate font-serif">
                  {me?.name || 'You'}
                </span>
                <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-semibold flex-shrink-0">
                  You
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="truncate">Seated</span>
              </div>
            </div>
          </div>

          {/* Center Dialectical Emblem */}
          <div className="flex flex-col items-center justify-center px-1 text-indigo-400">
            <div className="p-1.5 rounded-full bg-indigo-950/70 border border-indigo-700/50">
              <MessagesSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>

          {/* Seat 2: Companion / Opponent */}
          <div className="flex items-center gap-2 p-2 sm:p-2.5 rounded-lg bg-gray-900/90 border border-emerald-500/40 min-w-0">
            <div
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold text-gray-100 shadow-sm border border-white/20 flex-shrink-0 font-serif"
              style={{ backgroundColor: opponent?.color || '#6b8e4e' }}
            >
              {opponent?.name?.charAt(0) || 'C'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="font-bold text-gray-100 text-xs truncate font-serif">
                  {opponent?.name || 'Companion'}
                </span>
                <span className="hidden sm:inline text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-semibold flex-shrink-0">
                  Partner
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                {opponentTyping ? (
                  <span className="text-indigo-300 italic truncate animate-pulse">
                    Composing...
                  </span>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                    <span className="text-emerald-400 truncate">Seated</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConversationInfoPane;
