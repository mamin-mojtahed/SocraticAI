export interface Visitor {
  id: string;
  name: string;
  color: string;
  avatarSeed?: string;
  isOnline?: boolean;
}

export type ArgumentTag = 'Point' | 'Counter' | 'Evidence' | 'Question' | 'Concession';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
  tag?: ArgumentTag;
  reactions?: Record<string, number>;
}

export type SocialPlatform = 'x' | 'reddit' | 'facebook';

export interface SocialTrendsStatus {
  lastFetchedAt: number;
  nextFetchDueAt: number;
  topTags: string[];
  platformCounts: {
    x: number;
    reddit: number;
    facebook: number;
  };
  trends: {
    x: Array<{ platform: SocialPlatform; title: string; tag?: string; rank: number }>;
    reddit: Array<{ platform: SocialPlatform; title: string; tag?: string; rank: number }>;
    facebook: Array<{ platform: SocialPlatform; title: string; tag?: string; rank: number }>;
  };
}

export interface TopicItem {
  id: string;
  title: string;
  category?: string;
  createdAt: number;
  createdBy: string;
  rowIndex: number;
  platform?: SocialPlatform;
  trendTag?: string;
  trendRank?: number;
}

export interface TopicCarpoolStatus {
  topicId: string;
  waitingCount: number;
  waitingUsers: Array<{
    id: string;
    name: string;
    color: string;
    stance?: 'pro' | 'con' | 'neutral';
    joinedAt: number;
  }>;
  activeDebatesCount: number;
}

export interface DebateRoom {
  id: string;
  topicId: string;
  topicTitle: string;
  status: 'active' | 'concluded';
  debater1: Visitor;
  debater2: Visitor;
  messages: ChatMessage[];
  createdAt: number;
  concludedAt?: number;
  concludedReason?: string;
  isBridgeMatch?: boolean;
  closeness?: number;
  rationale?: string;
  debater1OriginalTopic?: string;
  debater2OriginalTopic?: string;
}

export interface ArchivedDebate {
  id: string;
  topicTitle: string;
  debater1: Visitor;
  debater2: Visitor;
  messagesCount: number;
  completedAt: number;
  preview: string;
}

// AI Practice in Waiting Lobby
export interface PracticeMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  nudgeFocus?: string;
  isMatchProfile?: boolean;
}

// AI Matchmaking & Debug Comparison Structures
export interface TopicNode {
  visitorId: string;
  visitorName: string;
  visitorColor: string;
  topicId: string;
  topicTitle: string;
  currentSummary: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingPreview?: number[];
  isFallbackEmbedding?: boolean;
  lastEmbeddedAt?: number;
}

export interface TopicPairCloseness {
  pairKey: string;
  userA: { id: string; name: string; topic: string; stance?: string; color: string };
  userB: { id: string; name: string; topic: string; stance?: string; color: string };
  closeness: number; // 0 to 100 (% calibrated semantic closeness / harmony)
  cosineSimilarity: number; // 0.0000 to 1.0000 (raw mathematical vector cosine similarity)
  threshold: number; // Match threshold (0 to 100)
  embeddingModel: string; // e.g. 'gemini-embedding-2-preview' | 'gemini-embedding-001' | 'text-embedding-004'
  isFallbackModel?: boolean;
  vectorDimensions?: number;
  bridgeTopic: string;
  commonGround: string;
  isReady: boolean; // closeness >= threshold
  lastEvaluatedAt: number;
}

export interface AiDebugLog {
  id: string;
  timestamp: number;
  iteration: number;
  pairKey: string; // Canonical person-pair key: [userAId, userBId].sort().join('::')
  userAId: string;
  userBId: string;
  userAName: string;
  userBName: string;
  userAColor?: string;
  userBColor?: string;
  topicA: string;
  topicB: string;
  stanceA?: string;
  stanceB?: string;
  userA: string; // Formatted display string: Name ("Topic")
  userB: string; // Formatted display string: Name ("Topic")
  score: number; // 0 to 100
  cosineSimilarity: number; // 0.0000 to 1.0000
  threshold: number; // Match threshold at evaluation time
  embeddingModel: string;
  isFallbackModel?: boolean;
  vectorDimensions?: number;
  notes: string;
  proposedTopic: string;
}

export interface BridgeMatchPrompt {
  id: string;
  opponentId: string;
  opponentName: string;
  opponentColor: string;
  myOriginalTopic: string;
  theirOriginalTopic: string;
  proposedBridgeTopic: string;
  closeness: number;
  cosineSimilarity?: number;
  threshold?: number;
  embeddingModel?: string;
  isFallbackModel?: boolean;
  rationale: string;
  userAId?: string;
  userBId?: string;
  acceptedUsers?: string[];
  status?: 'offered' | 'waiting_opponent' | 'accepted' | 'declined';
}

// WebSocket Event Payloads
export type ClientWsMessage =
  | { type: 'visitor:init'; payload: { visitorId: string; name?: string } }
  | { type: 'topic:create'; payload: { title: string; autoJoin?: boolean; stance?: 'pro' | 'con' | 'neutral' } }
  | { type: 'topic:edit'; payload: { topicId: string; title: string } }
  | { type: 'topic:select'; payload: { topicId: string; stance?: 'pro' | 'con' | 'neutral' } }
  | { type: 'topic:leave'; payload: { topicId: string } }
  | { type: 'debate:message'; payload: { roomId: string; text: string; tag?: ArgumentTag } }
  | { type: 'debate:reaction'; payload: { roomId: string; messageId: string; emoji: string } }
  | { type: 'debate:typing'; payload: { roomId: string; isTyping: boolean } }
  | { type: 'debate:leave'; payload: { roomId: string } }
  | { type: 'visitor:update_profile'; payload: { name: string; color: string } }
  | { type: 'practice:start'; payload: { topicId: string } }
  | { type: 'practice:message'; payload: { topicId: string; text: string; skipAiReply?: boolean } }
  | { type: 'practice:toggle_ai'; payload: { enabled: boolean } }
  | { type: 'practice:accept_bridge'; payload: { bridgeId: string; opponentId: string; topic: string } }
  | { type: 'practice:decline_bridge'; payload: { bridgeId: string } }
  | { type: 'debug:evaluate' }
  | { type: 'debug:set_threshold'; payload: { threshold: number } }
  | { type: 'social:refresh_trends' }
  | { type: 'ping' };

export type ServerWsMessage =
  | {
      type: 'init:state';
      payload: {
        visitor: Visitor;
        topics: TopicItem[];
        carpoolStatus: Record<string, TopicCarpoolStatus>;
        activeRoomsCount: number;
        onlineVisitorsCount: number;
        waitingTopicsCount?: number;
        activeRoom?: DebateRoom | null;
        waitingTopicId?: string | null;
        archivedDebates: ArchivedDebate[];
        debugNodes?: TopicNode[];
        debugPairs?: TopicPairCloseness[];
        debugLogs?: AiDebugLog[];
        matchThreshold?: number;
        activeEmbeddingModel?: string;
        socialTrendsStatus?: SocialTrendsStatus;
      };
    }
  | { type: 'social:trends_update'; payload: { status: SocialTrendsStatus; topics: TopicItem[] } }
  | { type: 'carpool:update'; payload: { carpoolStatus: Record<string, TopicCarpoolStatus> } }
  | { type: 'topic:added'; payload: { topic: TopicItem; carpoolStatus: TopicCarpoolStatus } }
  | { type: 'topic:updated'; payload: { topic: TopicItem } }
  | { type: 'match:waiting'; payload: { topicId: string; topicTitle: string; queuePosition: number } }
  | { type: 'match:found'; payload: { room: DebateRoom } }
  | { type: 'debate:message'; payload: { roomId: string; message: ChatMessage } }
  | { type: 'debate:typing'; payload: { visitorId: string; isTyping: boolean } }
  | { type: 'debate:concluded'; payload: { roomId: string; reason: string; archive: ArchivedDebate } }
  | { type: 'presence:update'; payload: { onlineCount: number; activeDebatesCount: number; waitingTopicsCount?: number } }
  | { type: 'practice:response'; payload: { message: PracticeMessage; topicId: string } }
  | { type: 'practice:typing'; payload: { isTyping: boolean } }
  | { type: 'bridge:prompt'; payload: BridgeMatchPrompt }
  | {
      type: 'bridge:update';
      payload: {
        bridgeId: string;
        acceptedUsers: string[];
        status: 'waiting_opponent' | 'accepted';
      };
    }
  | {
      type: 'bridge:declined';
      payload: {
        bridgeId: string;
        declinedById: string;
        declinedByName: string;
      };
    }
  | { type: 'bridge:cancelled'; payload: { bridgeId: string; reason?: string } }
  | {
      type: 'debug:update';
      payload: {
        nodes: TopicNode[];
        pairs: TopicPairCloseness[];
        logs: AiDebugLog[];
        matchThreshold: number;
        activeEmbeddingModel: string;
      };
    }
  | { type: 'pong' };
