import React, { useState } from 'react';
import type { Visitor, TopicItem, TopicCarpoolStatus, ArchivedDebate } from '../types';
import { VISITOR_COLORS } from '../constants';
import {
  Edit2,
  PlusSquare,
  ScrollText,
} from 'lucide-react';

interface TopicCreatorLobbyProps {
  currentVisitor: Visitor | null;
  topics: TopicItem[];
  carpoolStatus: Record<string, TopicCarpoolStatus>;
  archivedDebates: ArchivedDebate[];
  onSelectTopic: (topicId: string) => void;
  onCreateTopic: (title: string, autoJoin: boolean) => void;
  onEditTopic: (topicId: string, title: string) => void;
  onUpdateProfile: (name: string, color: string) => void;
  onToggleArchive: () => void;
}

const TopicCreatorLobby: React.FC<TopicCreatorLobbyProps> = ({
  currentVisitor,
  onCreateTopic,
  onUpdateProfile,
}) => {
  const [topicInput, setTopicInput] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [nameInput, setNameInput] = useState(currentVisitor?.name || '');
  const [selectedColor, setSelectedColor] = useState(currentVisitor?.color || '#c88a32');

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (topicInput.trim()) {
      onCreateTopic(topicInput.trim(), true);
      setTopicInput('');
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim()) {
      onUpdateProfile(nameInput.trim(), selectedColor);
      setIsEditingProfile(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border-t border-gray-800 overflow-y-auto">
      {/* Top Profile Strip */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-800 text-xs text-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-gray-100 shadow-sm flex-shrink-0 border border-white/20 font-serif"
            style={{ backgroundColor: currentVisitor?.color || '#c88a32' }}
          >
            {currentVisitor?.name?.charAt(0) || 'S'}
          </div>
          <span className="font-bold text-gray-100 text-xs sm:text-sm truncate max-w-[200px] font-serif tracking-wide">
            {currentVisitor?.name || 'Interlocutor'}
          </span>
          <button
            onClick={() => {
              setNameInput(currentVisitor?.name || '');
              setSelectedColor(currentVisitor?.color || '#c88a32');
              setIsEditingProfile(!isEditingProfile);
            }}
            className="p-1 text-gray-400 hover:text-indigo-300 rounded hover:bg-gray-800 transition-colors cursor-pointer"
            title="Edit philosophical title & emblem color"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Profile Edit Drawer */}
      {isEditingProfile && (
        <form
          onSubmit={handleSaveProfile}
          className="p-3 bg-gray-950/95 border-b border-gray-800 flex flex-wrap items-center gap-3 text-xs flex-shrink-0"
        >
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            className="rounded bg-gray-900 border border-gray-700 px-3 py-1.5 text-gray-100 text-xs sm:text-sm focus:ring-1 focus:ring-indigo-500 w-44"
            placeholder="Name or Title"
          />

          <div className="flex items-center gap-1.5">
            {VISITOR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setSelectedColor(color)}
                className={`w-4 h-4 rounded-full border transition-transform cursor-pointer ${
                  selectedColor === color ? 'scale-125 border-gray-100 ring-1 ring-indigo-400' : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          <button
            type="submit"
            className="rounded bg-indigo-600 px-3.5 py-1.5 text-gray-100 text-xs font-semibold hover:bg-indigo-500 transition-colors cursor-pointer"
          >
            Save Title
          </button>
        </form>
      )}

      {/* Main Chamber Body: Topic Inscription Area */}
      <div className="flex-1 p-4 sm:p-5 max-w-4xl mx-auto w-full flex flex-col justify-center">
        <div className="rounded-xl bg-gray-950/90 border border-indigo-500/40 p-5 sm:p-6 shadow-xl space-y-4">
          {/* Main Prompt Banner with Larger Font Size */}
          <div className="text-center font-serif space-y-1.5 py-3 px-4 bg-gray-900/80 rounded-lg border border-indigo-500/30 shadow-md">
            <div className="text-sm sm:text-base font-semibold tracking-wide text-gray-100">
              Select an inquiry from the Stoa above
            </div>
            <div className="font-sans font-black text-xs sm:text-sm text-indigo-400 tracking-widest my-0.5">
              OR
            </div>
            <div className="text-sm sm:text-base font-semibold tracking-wide text-gray-200">
              inscribe a new subject below
            </div>
          </div>

          <form onSubmit={handleCreateSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1 flex items-center">
              <ScrollText className="w-4.5 h-4.5 text-indigo-400/80 absolute left-3.5 pointer-events-none" />
              <input
                type="text"
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                placeholder="Write a new topic or question for Socratic contemplation..."
                className="w-full rounded-lg bg-gray-900 pl-10 pr-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-500 border border-gray-700 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <button
              type="submit"
              disabled={!topicInput.trim()}
              className="inline-flex items-center justify-center p-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-gray-100 transition-colors disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed cursor-pointer shadow-sm flex-shrink-0"
              title="Add new subject"
            >
              <PlusSquare className="w-5 h-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default TopicCreatorLobby;
