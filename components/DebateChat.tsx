import React, { useState, useRef, useEffect } from 'react';
import type { DebateRoom, Visitor } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Check, 
  X,
  Send,
} from 'lucide-react';

interface DebateChatProps {
  room: DebateRoom;
  currentVisitor: Visitor | null;
  opponentTyping: boolean;
  onSendMessage: (text: string) => void;
  onSendTyping: (isTyping: boolean) => void;
  onLeaveDebate: () => void;
  onToggleArchive: () => void;
}

const DebateChat: React.FC<DebateChatProps> = ({
  room,
  currentVisitor,
  opponentTyping,
  onSendMessage,
  onSendTyping,
  onLeaveDebate,
}) => {
  const [inputText, setInputText] = useState('');
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

    onSendMessage(inputText.trim());
    setInputText('');
    onSendTyping(false);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border-t border-gray-800">
      {/* Header: Subject & Interlocutors Info */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-800 z-10">
        <div className="flex items-center gap-2 overflow-hidden">
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
                <div className="max-w-md text-center px-4 py-2 rounded-lg bg-gray-850/95 border border-gray-700 text-xs sm:text-sm text-gray-100 font-bold shadow-sm font-serif">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.text.includes('Dialogue')
                      ? '💬 **Socratic Dialogue Begun**'
                      : msg.text}
                  </ReactMarkdown>
                </div>
              </div>
            );
          }

          const isMe = msg.senderId === currentVisitor?.id;

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
                {/* Sender name */}
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  <span className="text-xs font-semibold text-gray-300 font-serif">
                    {isMe ? 'You' : msg.senderName}
                  </span>
                  <span className="text-[11px] text-gray-500">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Bubble */}
                <div
                  className={`rounded-lg px-4 py-2.5 text-sm sm:text-base leading-relaxed shadow-sm relative ${
                    isMe
                      ? 'bg-indigo-600 text-gray-100 rounded-tr-none border border-indigo-500/40'
                      : 'bg-gray-850 text-gray-100 border border-gray-700/90 rounded-tl-none'
                  }`}
                >
                  <div className="markdown-content break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                  </div>
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

      {/* Dialogue Chat Input Section */}
      <div className="p-3 bg-gray-950 border-t border-gray-800">
        {/* Message Input Bar */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            placeholder={`Converse with ${opponent?.name || 'your companion'}...`}
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
