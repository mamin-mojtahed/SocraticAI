import React, { useState, useRef, useEffect } from 'react';
import type { Visitor, PracticeMessage, BridgeMatchPrompt } from '../types';
import {
  Sparkles,
  MessagesSquare,
  MessageCircle,
  X,
  Send,
  Pencil,
  Check,
} from 'lucide-react';

interface WaitingLobbyProps {
  topicId: string;
  topicTitle: string;
  currentVisitor: Visitor | null;
  onCancel: () => void;
  onEditTopic: (topicId: string, title: string) => void;
  practiceMessages: PracticeMessage[];
  isAiPracticeActive: boolean;
  isAiTyping: boolean;
  bridgePrompt: BridgeMatchPrompt | null;
  bridgeNotice?: { message: string; timestamp: number } | null;
  onDismissBridgeNotice?: () => void;
  onStartPractice: (topicId: string) => void;
  onSendPracticeMessage: (topicId: string, text: string, skipAiReply?: boolean) => void;
  onToggleAiResponse?: (enabled: boolean) => void;
  onAcceptBridgeMatch: (bridgeId: string, opponentId: string, topic: string) => void;
  onDeclineBridgeMatch: (bridgeId: string) => void;
  onToggleAiPractice: (active: boolean) => void;
  onOpenDebugView?: () => void;
}

const WaitingLobby: React.FC<WaitingLobbyProps> = ({
  topicId,
  topicTitle,
  currentVisitor,
  onCancel,
  onEditTopic,
  practiceMessages,
  isAiPracticeActive,
  isAiTyping,
  bridgePrompt,
  bridgeNotice,
  onDismissBridgeNotice,
  onStartPractice,
  onSendPracticeMessage,
  onToggleAiResponse,
  onAcceptBridgeMatch,
  onDeclineBridgeMatch,
  onToggleAiPractice,
}) => {
  const [practiceInput, setPracticeInput] = useState('');
  const [aiResponseEnabled, setAiResponseEnabled] = useState(true);
  const [isEditingTopic, setIsEditingTopic] = useState(false);
  const [editedTopicTitle, setEditedTopicTitle] = useState(topicTitle);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEditedTopicTitle(topicTitle);
  }, [topicTitle]);

  useEffect(() => {
    if (isAiPracticeActive) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [practiceMessages, isAiTyping, isAiPracticeActive]);

  const handleToggleSlide = () => {
    const nextState = !aiResponseEnabled;
    setAiResponseEnabled(nextState);
    if (onToggleAiResponse) {
      onToggleAiResponse(nextState);
    }
  };

  const handleStartPracticeClick = () => {
    onToggleAiPractice(true);
    if (aiResponseEnabled) {
      onStartPractice(topicId);
    }
  };

  const handleSendPractice = (e: React.FormEvent) => {
    e.preventDefault();
    if (practiceInput.trim()) {
      onSendPracticeMessage(topicId, practiceInput.trim(), !aiResponseEnabled);
      setPracticeInput('');
    }
  };

  const handleSaveTopicTitle = () => {
    if (editedTopicTitle.trim() && editedTopicTitle.trim() !== topicTitle) {
      onEditTopic(topicId, editedTopicTitle.trim());
    }
    setIsEditingTopic(false);
  };

  const hasMeAccepted = Boolean(
    currentVisitor?.id && bridgePrompt?.acceptedUsers?.includes(currentVisitor.id)
  );
  const hasOpponentAccepted = Boolean(
    bridgePrompt?.opponentId && bridgePrompt?.acceptedUsers?.includes(bridgePrompt.opponentId)
  );

  return (
    <div className="flex flex-col h-full bg-gray-900 border-t border-gray-800 p-2.5 sm:p-4 overflow-hidden relative">
      {/* SYNCHRONIZED NOTICE BANNER */}
      {bridgeNotice && (
        <div className="absolute top-2 left-2 right-2 z-50 p-2 sm:p-2.5 rounded-lg bg-gray-850/95 border border-indigo-500/50 shadow-xl flex items-center justify-between text-xs animate-fade-in backdrop-blur-md">
          <div className="flex items-center gap-2 truncate">
            <MessageCircle className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <span className="text-gray-200 truncate">{bridgeNotice.message}</span>
          </div>
          {onDismissBridgeNotice && (
            <button
              onClick={onDismissBridgeNotice}
              className="text-gray-400 hover:text-gray-100 p-1 rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* SYNTHESIZED BRIDGE DIALOGUE PROMPT BANNER */}
      {bridgePrompt && (
        <div
          className={`absolute top-2 left-2 right-2 z-40 max-h-[calc(100%-1rem)] overflow-y-auto p-3 sm:p-4 rounded-xl bg-gradient-to-r ${
            hasOpponentAccepted && !hasMeAccepted
              ? 'from-gray-950 via-indigo-950 to-gray-900 border-2 border-emerald-500 ring-2 ring-emerald-500/40 animate-pulse'
              : hasMeAccepted
              ? 'from-gray-950 via-gray-900 to-indigo-950 border-2 border-indigo-500/80'
              : 'from-gray-950 via-indigo-950 to-purple-950 border-2 border-indigo-400 shadow-2xl animate-fade-in'
          } text-gray-100 space-y-2.5 sm:space-y-3 shadow-2xl`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`p-1.5 rounded-md flex-shrink-0 ${
                  hasOpponentAccepted
                    ? 'bg-emerald-500/30 text-emerald-300'
                    : 'bg-indigo-500/30 text-indigo-300'
                }`}
              >
                <Sparkles className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <span className="font-bold text-xs sm:text-sm text-indigo-300 tracking-wide uppercase font-serif">
                    {hasOpponentAccepted && !hasMeAccepted
                      ? `${bridgePrompt.opponentName} Welcomes Dialogue with You!`
                      : hasMeAccepted
                      ? 'Awaiting Companion Assent...'
                      : 'Kindred Inquiry Discovered!'}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-black/40 border border-indigo-500/30 font-mono text-[10px] text-emerald-300">
                    {bridgePrompt.closeness}% Harmony
                  </span>
                </div>
                <p className="text-[11px] sm:text-xs text-gray-200 mt-0.5">
                  {hasMeAccepted && !hasOpponentAccepted ? (
                    <>
                      You have assented. Awaiting{' '}
                      <span className="font-bold text-gray-100">{bridgePrompt.opponentName}</span>{' '}
                      (1/2 joined)...
                    </>
                  ) : hasOpponentAccepted && !hasMeAccepted ? (
                    <>
                      <span className="font-bold text-emerald-300">
                        {bridgePrompt.opponentName}
                      </span>{' '}
                      is ready to converse! Accept to enter the Socratic dialogue immediately.
                    </>
                  ) : (
                    <>
                      <span className="font-bold text-gray-100">{bridgePrompt.opponentName}</span> is
                      exploring a closely related philosophical inquiry!
                    </>
                  )}
                </p>
              </div>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono flex-shrink-0 ${
                hasOpponentAccepted || hasMeAccepted
                  ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                  : 'bg-emerald-500/20 text-emerald-300'
              }`}
            >
              {hasOpponentAccepted && hasMeAccepted
                ? 'CONVENING...'
                : hasOpponentAccepted || hasMeAccepted
                ? '1/2 ASSENTED'
                : 'DIALOGUE READY'}
            </span>
          </div>

          {/* Bridge Topic Box */}
          <div className="p-2 sm:p-2.5 rounded-lg bg-gray-900/90 border border-indigo-500/40 space-y-1">
            <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400">
              <span className="uppercase font-bold font-serif flex-shrink-0">Shared Inquiry:</span>
              <span className="font-mono text-indigo-300 truncate max-w-[180px] sm:max-w-[260px]">
                "{bridgePrompt.myOriginalTopic}" ⟷ "{bridgePrompt.theirOriginalTopic}"
              </span>
            </div>
            <p className="font-bold text-gray-100 text-xs sm:text-sm leading-snug font-serif">
              "{bridgePrompt.proposedBridgeTopic}"
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
            <button
              onClick={() => onDeclineBridgeMatch(bridgePrompt.id)}
              className="px-2.5 sm:px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              {hasMeAccepted ? 'Withdraw' : 'Continue Contemplating'}
            </button>
            <button
              disabled={hasMeAccepted}
              onClick={() =>
                onAcceptBridgeMatch(
                  bridgePrompt.id,
                  bridgePrompt.opponentId,
                  bridgePrompt.proposedBridgeTopic
                )
              }
              className={`px-3 sm:px-4 py-1.5 rounded text-gray-100 text-xs font-bold shadow-md transition-all flex items-center gap-1.5 cursor-pointer ${
                hasMeAccepted
                  ? 'bg-indigo-900/60 border border-indigo-700/60 text-indigo-300 cursor-not-allowed opacity-90'
                  : hasOpponentAccepted
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 ring-2 ring-emerald-400/50 scale-105'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500'
              }`}
            >
              <MessagesSquare className="w-3.5 h-3.5" />
              <span>
                {hasMeAccepted
                  ? `✓ Assented (${bridgePrompt.opponentName} pending)`
                  : hasOpponentAccepted
                  ? 'Join Socratic Dialogue (1/2)'
                  : 'Enter Socratic Dialogue'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden max-w-2xl mx-auto w-full min-h-0">
        {/* Top Waiting Info Strip with Inline Topic Edit */}
        <div className="flex items-center justify-between pb-1.5 sm:pb-2 mb-1.5 sm:mb-2 border-b border-gray-800 flex-shrink-0 text-xs gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping flex-shrink-0"></span>
            <span className="hidden sm:inline text-gray-400 text-[11px] uppercase font-semibold font-serif flex-shrink-0">
              Contemplating:
            </span>

            {isEditingTopic ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  type="text"
                  value={editedTopicTitle}
                  onChange={(e) => setEditedTopicTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTopicTitle();
                    if (e.key === 'Escape') {
                      setIsEditingTopic(false);
                      setEditedTopicTitle(topicTitle);
                    }
                  }}
                  autoFocus
                  className="flex-1 min-w-0 bg-gray-950 border border-indigo-500 rounded px-2 py-1 text-xs sm:text-sm text-gray-100 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveTopicTitle}
                  className="p-1 rounded bg-indigo-600 hover:bg-indigo-500 text-gray-100 cursor-pointer flex-shrink-0"
                  title="Save edited inquiry"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingTopic(false);
                    setEditedTopicTitle(topicTitle);
                  }}
                  className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 cursor-pointer flex-shrink-0"
                  title="Cancel edit"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="font-bold text-gray-100 text-xs sm:text-sm truncate">
                  "{topicTitle}"
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEditedTopicTitle(topicTitle);
                    setIsEditingTopic(true);
                  }}
                  className="p-1 rounded text-gray-400 hover:text-indigo-300 hover:bg-gray-800 transition-colors cursor-pointer flex-shrink-0"
                  title="Edit topic title"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={onCancel}
              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors py-1 px-2 rounded hover:bg-red-950/40 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Depart</span>
            </button>
          </div>
        </div>

        {/* 2-Seat Symposium Visualization */}
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5 py-0.5 sm:py-1 flex-shrink-0">
          {/* Seat 1: User */}
          <div className="flex items-center gap-2 sm:gap-2.5 p-2 sm:p-2.5 rounded-lg bg-gray-850/90 border border-indigo-500/50 min-w-0">
            <div
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-gray-100 text-xs font-bold flex-shrink-0 shadow border border-white/15 font-serif"
              style={{ backgroundColor: currentVisitor?.color || '#c88a32' }}
            >
              {currentVisitor?.name?.charAt(0) || 'S'}
            </div>
            <div className="truncate min-w-0">
              <p className="font-semibold text-xs sm:text-sm text-gray-100 truncate font-serif">
                {currentVisitor?.name || 'You'}
              </p>
              <span className="text-[10px] sm:text-[11px] text-indigo-400 font-medium truncate block">
                Present (First Chair)
              </span>
            </div>
          </div>

          {/* Seat 2: Waiting/Searching */}
          <div className="flex items-center gap-2 sm:gap-2.5 p-2 sm:p-2.5 rounded-lg bg-gray-850/40 border border-dashed border-amber-500/40 min-w-0">
            <div className="relative w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center flex-shrink-0">
              <div className="absolute inset-0 rounded-full border border-amber-400 animate-ping opacity-40"></div>
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-300 text-xs font-bold">
                ?
              </div>
            </div>
            <div className="truncate min-w-0">
              <p className="font-semibold text-xs sm:text-sm text-gray-300 truncate font-serif">
                Awaiting Companion...
              </p>
              <span className="text-[10px] sm:text-[11px] text-amber-400 font-medium animate-pulse truncate block">
                Seeking Interlocutor (Second Chair)
              </span>
            </div>
          </div>
        </div>

        {/* Socratic Prelude / Reflection Area */}
        <div className="flex-1 flex flex-col mt-1.5 sm:mt-2 rounded-lg bg-gray-950/80 border border-gray-800 overflow-hidden min-h-0">
          {!isAiPracticeActive ? (
            <div className="flex-1 flex flex-col items-center justify-center p-2.5 sm:p-4 text-center space-y-2 sm:space-y-3 my-auto overflow-y-auto">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 flex-shrink-0">
                <MessagesSquare className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <h3 className="font-bold text-gray-100 text-xs sm:text-sm font-serif tracking-wide">
                  Socratic Prelude &amp; Reflection
                </h3>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 pt-0.5">
                <button
                  onClick={handleStartPracticeClick}
                  className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-gray-100 font-semibold text-xs sm:text-sm shadow-md transition-all cursor-pointer"
                >
                  <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span>Begin Socratic Reflection</span>
                </button>

                {/* Sliding Switch for AI Response on initial card */}
                <div className="flex items-center gap-2 text-xs text-gray-300">
                  <span className="text-xs text-gray-300">Socratic Guide</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={aiResponseEnabled}
                    onClick={handleToggleSlide}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      aiResponseEnabled ? 'bg-indigo-600' : 'bg-gray-700'
                    }`}
                    title={
                      aiResponseEnabled
                        ? 'Slide to turn off Socratic Guide replies'
                        : 'Slide to turn on Socratic Guide replies'
                    }
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-gray-100 shadow ring-0 transition duration-200 ease-in-out ${
                        aiResponseEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {/* Warmup Header with Sliding Toggle Button */}
              <div className="flex items-center justify-between px-3 sm:px-3.5 py-1.5 sm:py-2 bg-gray-900 border-b border-gray-800 text-xs flex-shrink-0">
                <div className="flex items-center gap-1.5 text-indigo-300 font-semibold font-serif truncate">
                  <MessageCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">Socratic Reflection Chat</span>
                </div>

                {/* Sliding Toggle Switch for AI Response */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={`text-xs font-medium transition-colors ${
                      aiResponseEnabled ? 'text-indigo-300' : 'text-gray-500'
                    }`}
                  >
                    Socratic Guide {aiResponseEnabled ? 'On' : 'Off'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={aiResponseEnabled}
                    onClick={handleToggleSlide}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      aiResponseEnabled ? 'bg-indigo-600' : 'bg-gray-700'
                    }`}
                    title={
                      aiResponseEnabled
                        ? 'Slide to pause Socratic Guide replies (you can still record notes)'
                        : 'Slide to enable Socratic Guide replies'
                    }
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-gray-100 shadow ring-0 transition duration-200 ease-in-out ${
                        aiResponseEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Practice Messages Feed */}
              <div className="flex-1 overflow-y-auto p-2.5 sm:p-3.5 space-y-2.5 sm:space-y-3 text-xs sm:text-sm min-h-0">
                {practiceMessages.length === 0 && (
                  <p className="text-center text-gray-400 text-xs py-3 sm:py-4 italic">
                    {aiResponseEnabled
                      ? 'Offer a thought or question below at any moment.'
                      : 'Socratic Guide replies are paused. Inscribe your reflections below to align with a fellow thinker.'}
                  </p>
                )}

                {practiceMessages.map((msg) => {
                  const isUser = msg.sender === 'user';
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5 text-[11px] text-gray-400 font-serif">
                        <span>{isUser ? 'You' : 'Socratic Guide'}</span>
                      </div>
                      <div
                        className={`rounded-lg px-3 sm:px-3.5 py-1.5 sm:py-2 max-w-[88%] sm:max-w-[85%] leading-relaxed ${
                          isUser
                            ? 'bg-indigo-600 text-gray-100 rounded-tr-none'
                            : 'bg-gray-850 text-gray-100 border border-gray-700/80 rounded-tl-none'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  );
                })}

                {isAiTyping && aiResponseEnabled && (
                  <div className="flex items-center gap-1.5 text-xs text-indigo-300 italic py-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce"></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]"></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]"></span>
                    <span className="text-xs text-gray-400">
                      Socratic Guide is pondering...
                    </span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Practice Chat Input Bar (Uses Lucide Send icon) */}
              <form
                onSubmit={handleSendPractice}
                className="flex items-center gap-2 p-2 sm:p-2.5 bg-gray-900 border-t border-gray-800 flex-shrink-0"
              >
                <input
                  type="text"
                  value={practiceInput}
                  onChange={(e) => setPracticeInput(e.target.value)}
                  placeholder={
                    aiResponseEnabled
                      ? 'Reply to Socratic Guide...'
                      : 'Record a reflection (Guide off)...'
                  }
                  className="flex-1 min-w-0 rounded-full bg-gray-950 px-3.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm text-gray-100 placeholder-gray-500 border border-gray-700/80 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!practiceInput.trim()}
                  className="p-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-gray-100 transition-colors disabled:bg-gray-800 disabled:text-gray-600 cursor-pointer flex-shrink-0"
                  title="Send reflection message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WaitingLobby;
