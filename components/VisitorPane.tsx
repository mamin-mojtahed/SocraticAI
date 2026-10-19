import React from 'react';
import type { DebateSocketHandle } from '../services/useDebateSocket';
import WaitingLobby from './WaitingLobby';
import DebateChat from './DebateChat';
import TopicCreatorLobby from './TopicCreatorLobby';

interface VisitorPaneProps {
  socket: DebateSocketHandle;
  paneLabel?: string;
  isSplitView?: boolean;
  onToggleArchive: () => void;
  onOpenDebugView?: () => void;
}

export const VisitorPane: React.FC<VisitorPaneProps> = ({
  socket,
  paneLabel,
  isSplitView,
  onToggleArchive,
  onOpenDebugView,
}) => {
  const {
    connected,
    visitor,
    topics,
    carpoolStatus,
    activeRoom,
    waitingTopic,
    archivedDebates,
    opponentTyping,
    concludedInfo,
    selectTopic,
    leaveWaitingTopic,
    createTopic,
    editTopic,
    sendMessage,
    sendReaction,
    sendTyping,
    leaveDebate,
    updateProfile,
    dismissConcluded,
    // Practice & Matchmaking
    practiceMessages,
    isAiPracticeActive,
    isAiTyping,
    bridgePrompt,
    bridgeNotice,
    dismissBridgeNotice,
    startPractice,
    sendPracticeMessage,
    toggleAiResponse,
    acceptBridgeMatch,
    declineBridgeMatch,
    setIsAiPracticeActive,
  } = socket;

  return (
    <div className="flex flex-col h-full w-full bg-gray-900 overflow-hidden relative">
      {/* Pane header if in split view */}
      {isSplitView && (
        <div className="flex items-center justify-between px-3.5 py-1 bg-gray-950 border-b border-gray-800 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-indigo-400 uppercase tracking-wider text-xs font-serif">{paneLabel || 'Interlocutor'}</span>
            <span className="text-gray-500">•</span>
            <div className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: visitor?.color || '#c88a32' }}
              ></span>
              <span className="font-semibold text-gray-100 text-xs truncate max-w-[130px]">{visitor?.name || 'Entering Agora...'}</span>
            </div>
          </div>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
              connected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
            }`}
          >
            {connected ? '● Present' : '○ Away'}
          </span>
        </div>
      )}

      {/* Concluded notification overlay / banner */}
      {concludedInfo && (
        <div className="absolute top-2 left-2 right-2 z-30 p-3 rounded-lg bg-gray-850/95 border border-indigo-500/60 shadow-xl flex items-center justify-between backdrop-blur-md">
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-indigo-300 font-serif">Dialogue Concluded</p>
            <p className="text-xs text-gray-200">{concludedInfo.reason}</p>
          </div>
          <button
            onClick={dismissConcluded}
            className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-gray-100 text-xs font-semibold shadow-sm transition-colors"
          >
            Return to Agora
          </button>
        </div>
      )}

      {/* Main body */}
      <div className="flex-1 h-full overflow-hidden">
        {activeRoom ? (
          <DebateChat
            room={activeRoom}
            currentVisitor={visitor}
            opponentTyping={opponentTyping}
            onSendMessage={sendMessage}
            onSendReaction={sendReaction}
            onSendTyping={sendTyping}
            onLeaveDebate={leaveDebate}
            onToggleArchive={onToggleArchive}
          />
        ) : waitingTopic ? (
          <WaitingLobby
            topicId={waitingTopic.topicId}
            topicTitle={waitingTopic.topicTitle}
            currentVisitor={visitor}
            onCancel={leaveWaitingTopic}
            onEditTopic={editTopic}
            practiceMessages={practiceMessages}
            isAiPracticeActive={isAiPracticeActive}
            isAiTyping={isAiTyping}
            bridgePrompt={bridgePrompt}
            bridgeNotice={bridgeNotice}
            onDismissBridgeNotice={dismissBridgeNotice}
            onStartPractice={startPractice}
            onSendPracticeMessage={sendPracticeMessage}
            onToggleAiResponse={toggleAiResponse}
            onAcceptBridgeMatch={acceptBridgeMatch}
            onDeclineBridgeMatch={declineBridgeMatch}
            onToggleAiPractice={setIsAiPracticeActive}
            onOpenDebugView={onOpenDebugView}
          />
        ) : (
          <TopicCreatorLobby
            currentVisitor={visitor}
            topics={topics}
            carpoolStatus={carpoolStatus}
            archivedDebates={archivedDebates}
            onSelectTopic={(topicId) => selectTopic(topicId)}
            onCreateTopic={(title, autoJoin) => createTopic(title, autoJoin)}
            onEditTopic={editTopic}
            onUpdateProfile={updateProfile}
            onToggleArchive={onToggleArchive}
          />
        )}
      </div>
    </div>
  );
};

export default VisitorPane;
