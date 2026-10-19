import React from 'react';
import type { ArchivedDebate } from '../types';
import { BookOpen, X, Archive as ArchiveIcon } from 'lucide-react';

interface ArchiveProps {
  isOpen: boolean;
  onToggle: () => void;
  debates: ArchivedDebate[];
}

const Archive: React.FC<ArchiveProps> = ({ isOpen, onToggle, debates }) => {
  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 top-11 sm:top-12 bg-black/60 backdrop-blur-sm z-30 transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onToggle}
      />

      {/* Slideover Panel starting right below top header */}
      <div
        className={`fixed top-11 sm:top-12 right-0 z-40 h-[calc(100dvh-2.75rem)] sm:h-[calc(100dvh-3rem)] w-full max-w-md transform bg-gray-900 border-l border-gray-700 shadow-2xl transition-transform duration-300 flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-3.5 sm:p-5 border-b border-gray-800 flex items-center justify-between bg-gray-950 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <ArchiveIcon className="w-5 h-5 text-indigo-400 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-gray-100 font-serif tracking-wide truncate">
                Scrolls of the Agora
              </h2>
              <p className="text-xs text-gray-400 italic truncate">
                Inscribed Socratic dialogues &amp; past reflections
              </p>
            </div>
          </div>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md hover:bg-gray-800 text-gray-400 hover:text-gray-100 cursor-pointer flex-shrink-0 transition-colors"
            title="Close Archive"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3">
          {debates.length > 0 ? (
            debates.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-lg bg-gray-850/90 border border-gray-700/80 space-y-2 hover:border-indigo-500/50 transition-colors"
              >
                <div className="flex items-center justify-between text-[11px] text-gray-400">
                  <span className="font-semibold text-indigo-400 font-serif">
                    {item.messagesCount} {item.messagesCount === 1 ? 'exchange' : 'exchanges'}
                  </span>
                  <span>
                    {new Date(item.completedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <h3 className="font-bold text-gray-100 text-sm leading-snug font-serif">
                  {item.topicTitle}
                </h3>

                <div className="flex items-center gap-2 text-xs text-gray-300 pt-1">
                  <span className="flex items-center gap-1 font-medium">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: item.debater1.color }}
                    ></span>
                    {item.debater1.name}
                  </span>
                  <span className="text-indigo-400 font-serif italic">&amp;</span>
                  <span className="flex items-center gap-1 font-medium">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: item.debater2.color }}
                    ></span>
                    {item.debater2.name}
                  </span>
                </div>

                {item.preview && (
                  <p className="text-xs text-gray-300 italic bg-gray-900/70 p-2 rounded border border-gray-800 mt-2">
                    "{item.preview}"
                  </p>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
              <div className="w-12 h-12 rounded-full bg-gray-850 border border-gray-700 mx-auto flex items-center justify-center text-gray-400 mb-3">
                <BookOpen className="w-6 h-6 text-indigo-400" />
              </div>
              <p className="font-medium text-gray-200 font-serif">No inscribed dialogues yet</p>
              <p className="text-xs text-gray-500 mt-1 italic">
                Completed Socratic dialogues between companions will be preserved here.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Archive;