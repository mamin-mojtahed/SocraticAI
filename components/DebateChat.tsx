import React, { useState, useRef, useEffect } from 'react';
import type { DebateRoom, Visitor, ArgumentTag } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  ThumbsUp, 
  Lightbulb, 
  Target, 
  Sparkles, 
  HelpCircle, 
  Check, 
  X,
  MessagesSquare,
  Send,
} from 'lucide-react';

interface DebateChatProps {
  room: DebateRoom;
  currentVisitor: Visitor | null;
  opponentTyping: boolean;
  onSendMessage: (text: string, tag?: ArgumentTag) => void;
  onSendReaction: (messageId: string, emoji: string) => void;
  onSendTyping: (isTyping: boolean) => void;
  onLeaveDebate: () => void;
  onToggleArchive: () => void;
}

const TAG_OPTIONS: { label: string; tag: ArgumentTag; color: string }[] = [
  { label: 'Reflection', tag: 'Point', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
  { label: 'Inquiry', tag: 'Question', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { label: 'Observation', tag: 'Evidence', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  { label: 'Counterpoint', tag: 'Counter', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  { label: 'Synthesis', tag: 'Concession', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
];

const REACTION_OPTIONS = [
  { id: 'agree', icon: ThumbsUp, label: 'Harmonious' },
  { id: 'insight', icon: Lightbulb, label: 'Illuminating' },
  { id: 'precise', icon: Target, label: 'Lucid' },
  { id: 'brilliant', icon: Sparkles, label: 'Wise' },
  { id: 'query', icon: HelpCircle, label: 'Pondering' },
];

const DebateChat: React.FC<DebateChatProps> = ({
  room,
  currentVisitor,
  opponentTyping,
  onSendMessage,
  onSendReaction,
  onSendTyping,
  onLeaveDebate,
}) => {
  const [inputText, setInputText] = useState('');
  const [selectedTag, setSelectedTag] = useState<ArgumentTag | undefined>(undefined);
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);

  const opponent = room.debater1.id === currentVisitor?.id ? room.debater2 : room.debater1;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room.messages, opponentTyping]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    onSendTyping(true);

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      onSendTyping(false);
    }, 1500);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    onSendMessage(inputText.trim(), selectedTag);
    setInputText('');
    setSelectedTag(undefined);
    onSendTyping(false);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border-t border-gray-800">
      {/* Header: Subject & Interlocutors Info */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-800 z-10">
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="flex items-center gap-1.5 font-mono text-xs text-indigo-400 font-bold flex-shrink-0">
            <MessagesSquare className="w-4 h-4 text-indigo-400" />
            <span>Symposium</span>
          </span>

          <span className="text-gray-600">•</span>

          <span className="text-xs sm:text-sm font-bold text-gray-100 truncate max-w-[200px] sm:max-w-md font-serif">
            {room.topicTitle}
          </span>
        </div>

        {/* Interlocutor info & Conclude */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-gray-300">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ backgroundColor: opponent?.color || '#6b8e4e' }}
            ></span>
            <span className="truncate max-w-[120px] text-gray-200 font-serif">{opponent?.name || 'Companion'}</span>
          </div>

          {showConfirmLeave ? (
            <div className="flex items-center gap-1.5 bg-red-950 border border-red-800 px-2.5 py-0.5 rounded text-xs">
              <span className="text-red-300 font-medium">Conclude?</span>
              <button
                onClick={onLeaveDebate}
                className="bg-red-700 hover:bg-red-600 text-gray-100 font-bold p-1 rounded transition-colors cursor-pointer"
                title="Confirm concluding dialogue"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowConfirmLeave(false)}
                className="text-gray-400 hover:text-gray-100 p-1 transition-colors cursor-pointer"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirmLeave(true)}
              className="text-gray-400 hover:text-red-300 hover:bg-red-950/50 p-1 rounded transition-colors cursor-pointer"
              title="Conclude Socratic dialogue"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {room.messages.map((msg) => {
          if (msg.isSystem) {
            return (
              <div key={msg.id} className="flex justify-center my-3">
                <div className="max-w-xl text-center px-4 py-3 rounded-lg bg-gray-850/95 border border-gray-700 text-xs sm:text-sm text-gray-100 shadow-sm markdown-content font-serif">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                </div>
              </div>
            );
          }

          const isMe = msg.senderId === currentVisitor?.id;
          const matchedTag = TAG_OPTIONS.find((t) => t.tag === msg.tag);

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-2.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* Avatar circle */}
              <div
                className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-gray-100 shadow-sm border border-white/15 font-serif"
                style={{ backgroundColor: msg.senderColor || '#c88a32' }}
              >
                {msg.senderName?.charAt(0) || 'S'}
              </div>

              {/* Message Bubble Box */}
              <div className={`flex flex-col max-w-[80%] sm:max-w-md ${isMe ? 'items-end' : 'items-start'}`}>
                {/* Sender name and tag */}
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  <span className="text-xs font-semibold text-gray-300 font-serif">
                    {isMe ? 'You' : msg.senderName}
                  </span>
                  {msg.tag && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                        matchedTag?.color || 'bg-gray-800 text-gray-300 border-gray-700'
                      }`}
                    >
                      {matchedTag?.label || msg.tag}
                    </span>
                  )}
                  <span className="text-[11px] text-gray-500">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Bubble */}
                <div
                  className={`rounded-lg px-4 py-2.5 text-sm sm:text-base leading-relaxed shadow-sm group relative ${
                    isMe
                      ? 'bg-indigo-600 text-gray-100 rounded-tr-none border border-indigo-500/40'
                      : 'bg-gray-850 text-gray-100 border border-gray-700/90 rounded-tl-none'
                  }`}
                >
                  <div className="markdown-content break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                  </div>

                  {/* Reaction Toolbar on hover/mobile */}
                  <div
                    className={`absolute -bottom-3 ${
                      isMe ? 'right-2' : 'left-2'
                    } flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-md px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow`}
                  >
                    {REACTION_OPTIONS.map(({ id, icon: Icon, label }) => (
                      <button
                        key={id}
                        onClick={() => onSendReaction(msg.id, id)}
                        title={label}
                        className="hover:scale-125 transition-transform text-gray-400 hover:text-indigo-400 p-1 cursor-pointer"
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </button>
                    ))}
                  </div>

                  {/* Render Existing Reactions */}
                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5 pt-1 border-t border-white/10">
                      {Object.entries(msg.reactions).map(([reactionKey, count]) => {
                        const matchedOpt = REACTION_OPTIONS.find((r) => r.id === reactionKey);
                        const Icon = matchedOpt?.icon;
                        return (
                          <button
                            key={reactionKey}
                            onClick={() => onSendReaction(msg.id, reactionKey)}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/30 text-xs text-gray-100 hover:bg-black/50 cursor-pointer"
                          >
                            {Icon ? (
                              <Icon className="w-3 h-3 text-indigo-300" />
                            ) : (
                              <span className="text-[10px]">{reactionKey}</span>
                            )}
                            <span className="font-semibold text-[11px]">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {opponentTyping && (
          <div className="flex items-center gap-2 text-xs text-gray-400 italic py-1 px-2">
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce"></span>
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]"></span>
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]"></span>
            </div>
            <span>{opponent?.name || 'Your companion'} is composing a reflection...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Dialogue Chat Input Section (Rounded pill input + Send Lucide icon to distinguish from Topic Creation) */}
      <div className="p-3 bg-gray-950 border-t border-gray-800 space-y-2">
        {/* Optional Mode of Discourse Selector */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-[11px] text-gray-400 uppercase font-bold mr-1 flex-shrink-0 font-serif">
            Mode of Discourse:
          </span>
          {TAG_OPTIONS.map(({ label, tag, color }) => {
            const isSelected = selectedTag === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTag(isSelected ? undefined : tag)}
                className={`rounded-md px-2.5 py-0.5 text-xs font-semibold border transition-all flex-shrink-0 cursor-pointer ${
                  isSelected
                    ? `${color} ring-1 ring-indigo-400 scale-105`
                    : 'bg-gray-850 text-gray-300 border-gray-700 hover:text-gray-100'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Message Input Bar */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            placeholder={
              selectedTag
                ? `Offer your ${TAG_OPTIONS.find((t) => t.tag === selectedTag)?.label.toLowerCase() || 'thought'}...`
                : `Converse with ${opponent?.name || 'your companion'}...`
            }
            className="flex-1 rounded-full bg-gray-850 px-5 py-2.5 text-sm text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 border border-gray-700/80"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="flex-shrink-0 rounded-full bg-indigo-600 p-2.5 text-gray-100 transition-colors hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed shadow-sm cursor-pointer"
            title="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default DebateChat;
