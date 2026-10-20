import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  Visitor,
  TopicItem,
  TopicCarpoolStatus,
  DebateRoom,
  ChatMessage,
  ArchivedDebate,
  ArgumentTag,
  PracticeMessage,
  TopicNode,
  TopicPairCloseness,
  AiDebugLog,
  BridgeMatchPrompt,
  SocialTrendsStatus,
  ClientWsMessage,
  ServerWsMessage,
} from '../types';

export interface UseDebateSocketOptions {
  customVisitorId?: string;
  initialName?: string;
}

export function useDebateSocket(options?: UseDebateSocketOptions) {
  const [connected, setConnected] = useState(false);
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [carpoolStatus, setCarpoolStatus] = useState<Record<string, TopicCarpoolStatus>>({});
  const [activeRoom, setActiveRoom] = useState<DebateRoom | null>(null);
  const [waitingTopic, setWaitingTopic] = useState<{
    topicId: string;
    topicTitle: string;
    queuePosition: number;
  } | null>(null);
  const [onlineCount, setOnlineCount] = useState(1);
  const [activeDebatesCount, setActiveDebatesCount] = useState(0);
  const [archivedDebates, setArchivedDebates] = useState<ArchivedDebate[]>([]);
  const [opponentTyping, setOpponentTyping] = useState(false);
  const [concludedInfo, setConcludedInfo] = useState<{
    reason: string;
    archive: ArchivedDebate;
  } | null>(null);

  // AI Practice & Debug State
  const [practiceMessages, setPracticeMessages] = useState<PracticeMessage[]>([]);
  const [isAiPracticeActive, setIsAiPracticeActive] = useState(false);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [bridgePrompt, setBridgePrompt] = useState<BridgeMatchPrompt | null>(null);
  const [bridgeNotice, setBridgeNotice] = useState<{ message: string; timestamp: number } | null>(null);
  const [debugNodes, setDebugNodes] = useState<TopicNode[]>([]);
  const [debugPairs, setDebugPairs] = useState<TopicPairCloseness[]>([]);
  const [debugLogs, setDebugLogs] = useState<AiDebugLog[]>([]);
  const [matchThreshold, setMatchThresholdState] = useState<number>(70);
  const [activeEmbeddingModel, setActiveEmbeddingModel] = useState<string>('gemini-embedding-2-preview');
  const [socialTrendsStatus, setSocialTrendsStatus] = useState<SocialTrendsStatus | null>(null);
  const [waitingTopicsCountState, setWaitingTopicsCountState] = useState<number>(0);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const thresholdDebounceTimerRef = useRef<number | null>(null);

  // Derive waiting topics count dynamically from carpool status with fallback to server presence
  const waitingTopicsCount = useMemo(() => {
    const derived = Object.values(carpoolStatus).filter(
      (s) => (s.waitingCount ?? s.waitingUsers?.length ?? 0) > 0
    ).length;
    return Math.max(waitingTopicsCountState, derived);
  }, [carpoolStatus, waitingTopicsCountState]);

  // Compute or get isolated visitorId per tab (guaranteed persistent across page refreshes)
  const visitorIdRef = useRef<string>('');
  if (!visitorIdRef.current) {
    if (options?.customVisitorId) {
      visitorIdRef.current = options.customVisitorId;
    } else {
      const urlParams = new URLSearchParams(window.location.search);
      const urlVisitor = urlParams.get('v') || urlParams.get('visitorId');
      if (urlVisitor) {
        visitorIdRef.current = `v-${urlVisitor}`;
        try {
          sessionStorage.setItem('socratic_visitor_id', visitorIdRef.current);
        } catch (e) {
          // ignore
        }
      } else {
        let stored: string | null = null;
        try {
          stored =
            sessionStorage.getItem('socratic_visitor_id') ||
            localStorage.getItem('socratic_visitor_id');
        } catch (e) {
          // ignore
        }
        if (!stored) {
          stored = `v-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
          try {
            sessionStorage.setItem('socratic_visitor_id', stored);
            localStorage.setItem('socratic_visitor_id', stored);
          } catch (e) {
            // ignore
          }
        }
        visitorIdRef.current = stored;
      }
    }
  }

  const getEffectiveVisitorId = useCallback(() => {
    if (options?.customVisitorId) return options.customVisitorId;
    return visitorIdRef.current;
  }, [options?.customVisitorId]);

  const send = useCallback((msg: ClientWsMessage) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch (e) {
        // ignore
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const vId = getEffectiveVisitorId();
      send({
        type: 'visitor:init',
        payload: { visitorId: vId, name: options?.initialName },
      });

      // Smooth ping interval (every 15 seconds to prevent idle timeout reliably)
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 15000);
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 2000);
    };

    ws.onerror = (err) => {
      console.warn('WebSocket connection error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerWsMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'pong':
            break;

          case 'init:state': {
            setVisitor(msg.payload.visitor);
            setTopics(msg.payload.topics);
            setCarpoolStatus(msg.payload.carpoolStatus);
            setOnlineCount(msg.payload.onlineVisitorsCount);
            if (typeof msg.payload.waitingTopicsCount === 'number') {
              setWaitingTopicsCountState(msg.payload.waitingTopicsCount);
            }
            setActiveDebatesCount(msg.payload.activeRoomsCount);
            setArchivedDebates(msg.payload.archivedDebates || []);

            if (msg.payload.debugNodes) setDebugNodes(msg.payload.debugNodes);
            if (msg.payload.debugPairs) setDebugPairs(msg.payload.debugPairs);
            if (msg.payload.debugLogs) setDebugLogs(msg.payload.debugLogs);
            if (typeof msg.payload.matchThreshold === 'number') {
              setMatchThresholdState(msg.payload.matchThreshold);
            }
            if (msg.payload.activeEmbeddingModel) {
              setActiveEmbeddingModel(msg.payload.activeEmbeddingModel);
            }
            if (msg.payload.socialTrendsStatus) setSocialTrendsStatus(msg.payload.socialTrendsStatus);

            if (msg.payload.activeRoom) {
              setActiveRoom(msg.payload.activeRoom);
              setWaitingTopic(null);
            } else if (msg.payload.waitingTopicId) {
              const matchedTopic = msg.payload.topics.find((t) => t.id === msg.payload.waitingTopicId);
              setWaitingTopic({
                topicId: msg.payload.waitingTopicId,
                topicTitle: matchedTopic ? matchedTopic.title : 'Waiting Topic',
                queuePosition: 1,
              });
            }
            break;
          }

          case 'social:trends_update': {
            setSocialTrendsStatus(msg.payload.status);
            setTopics(msg.payload.topics);
            break;
          }

          case 'carpool:update': {
            setCarpoolStatus(msg.payload.carpoolStatus);
            break;
          }

          case 'debug:update': {
            setDebugNodes(msg.payload.nodes);
            setDebugPairs(msg.payload.pairs);
            setDebugLogs(msg.payload.logs);
            if (typeof msg.payload.matchThreshold === 'number') {
              setMatchThresholdState(msg.payload.matchThreshold);
            }
            if (msg.payload.activeEmbeddingModel) {
              setActiveEmbeddingModel(msg.payload.activeEmbeddingModel);
            }
            break;
          }

          case 'topic:added': {
            setTopics((prev) => {
              if (prev.some((t) => t.id === msg.payload.topic.id)) return prev;
              return [msg.payload.topic, ...prev];
            });
            setCarpoolStatus((prev) => ({
              ...prev,
              [msg.payload.topic.id]: msg.payload.carpoolStatus,
            }));
            break;
          }

          case 'topic:updated': {
            const updatedTopic = msg.payload.topic;
            setTopics((prev) =>
              prev.map((t) => (t.id === updatedTopic.id ? updatedTopic : t))
            );
            setWaitingTopic((prev) =>
              prev && prev.topicId === updatedTopic.id
                ? { ...prev, topicTitle: updatedTopic.title }
                : prev
            );
            break;
          }

          case 'match:waiting': {
            setWaitingTopic({
              topicId: msg.payload.topicId,
              topicTitle: msg.payload.topicTitle,
              queuePosition: msg.payload.queuePosition,
            });
            setActiveRoom(null);
            setConcludedInfo(null);
            setPracticeMessages([]);
            setBridgePrompt(null);
            break;
          }

          case 'match:found': {
            setActiveRoom(msg.payload.room);
            setWaitingTopic(null);
            setConcludedInfo(null);
            setBridgePrompt(null);
            setIsAiPracticeActive(false);
            break;
          }

          case 'debate:message': {
            const { message } = msg.payload;
            setActiveRoom((prev) => {
              if (!prev || prev.id !== msg.payload.roomId) return prev;
              const exists = prev.messages.some((m) => m.id === message.id);
              if (exists) {
                return {
                  ...prev,
                  messages: prev.messages.map((m) => (m.id === message.id ? message : m)),
                };
              }
              return {
                ...prev,
                messages: [...prev.messages, message],
              };
            });
            break;
          }

          case 'debate:typing': {
            setOpponentTyping(msg.payload.isTyping);
            if (msg.payload.isTyping) {
              if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
              typingTimeoutRef.current = window.setTimeout(() => {
                setOpponentTyping(false);
              }, 3000);
            }
            break;
          }

          case 'debate:concluded': {
            setActiveRoom((prev) => (prev ? { ...prev, status: 'concluded' } : null));
            setConcludedInfo({
              reason: msg.payload.reason,
              archive: msg.payload.archive,
            });
            setArchivedDebates((prev) => [msg.payload.archive, ...prev]);
            break;
          }

          case 'presence:update': {
            setOnlineCount(msg.payload.onlineCount);
            setActiveDebatesCount(msg.payload.activeDebatesCount);
            if (typeof msg.payload.waitingTopicsCount === 'number') {
              setWaitingTopicsCountState(msg.payload.waitingTopicsCount);
            }
            break;
          }

          case 'practice:response': {
            setPracticeMessages((prev) => [...prev, msg.payload.message]);
            setIsAiTyping(false);
            break;
          }

          case 'practice:typing': {
            setIsAiTyping(msg.payload.isTyping);
            break;
          }

          case 'bridge:prompt': {
            setBridgePrompt(msg.payload);
            setBridgeNotice(null);
            break;
          }

          case 'bridge:update': {
            setBridgePrompt((prev) => {
              if (!prev || prev.id !== msg.payload.bridgeId) return prev;
              return {
                ...prev,
                acceptedUsers: msg.payload.acceptedUsers,
                status: msg.payload.status,
              };
            });
            break;
          }

          case 'bridge:declined': {
            setBridgePrompt((prev) => (prev?.id === msg.payload.bridgeId ? null : prev));
            const myId = getEffectiveVisitorId();
            const isMe = msg.payload.declinedById === myId;
            const noticeText = isMe
              ? 'You opted to keep practicing in the lobby.'
              : `${msg.payload.declinedByName} preferred to keep practicing in the lobby.`;
            setBridgeNotice({ message: noticeText, timestamp: Date.now() });
            break;
          }

          case 'bridge:cancelled': {
            setBridgePrompt((prev) => (prev?.id === msg.payload.bridgeId ? null : prev));
            if (msg.payload.reason) {
              setBridgeNotice({ message: msg.payload.reason, timestamp: Date.now() });
            }
            break;
          }
        }
      } catch (err) {
        console.error('Error parsing WS event:', err);
      }
    };
  }, [getEffectiveVisitorId, options?.initialName, send]);

  useEffect(() => {
    connect();
    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connect]);

  // Public user actions
  const selectTopic = useCallback(
    (topicId: string, stance: 'pro' | 'con' | 'neutral' = 'neutral') => {
      send({
        type: 'topic:select',
        payload: { topicId, stance },
      });
    },
    [send]
  );

  const leaveWaitingTopic = useCallback(() => {
    if (waitingTopic) {
      send({
        type: 'topic:leave',
        payload: { topicId: waitingTopic.topicId },
      });
      setWaitingTopic(null);
      setIsAiPracticeActive(false);
      setPracticeMessages([]);
      setBridgePrompt(null);
    }
  }, [send, waitingTopic]);

  const createTopic = useCallback(
    (title: string, autoJoin = true, stance: 'pro' | 'con' | 'neutral' = 'neutral') => {
      send({
        type: 'topic:create',
        payload: { title, autoJoin, stance },
      });
    },
    [send]
  );

  const editTopic = useCallback(
    (topicId: string, title: string) => {
      const trimmed = title.trim();
      if (!topicId || !trimmed) return;
      // Optimistic local update
      setTopics((prev) =>
        prev.map((t) => (t.id === topicId ? { ...t, title: trimmed } : t))
      );
      setWaitingTopic((prev) =>
        prev && prev.topicId === topicId ? { ...prev, topicTitle: trimmed } : prev
      );
      send({
        type: 'topic:edit',
        payload: { topicId, title: trimmed },
      });
    },
    [send]
  );

  const sendMessage = useCallback(
    (text: string, tag?: ArgumentTag) => {
      if (!activeRoom || !text.trim()) return;
      send({
        type: 'debate:message',
        payload: { roomId: activeRoom.id, text, tag },
      });
    },
    [activeRoom, send]
  );

  const sendReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!activeRoom) return;
      send({
        type: 'debate:reaction',
        payload: { roomId: activeRoom.id, messageId, emoji },
      });
    },
    [activeRoom, send]
  );

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!activeRoom) return;
      send({
        type: 'debate:typing',
        payload: { roomId: activeRoom.id, isTyping },
      });
    },
    [activeRoom, send]
  );

  const leaveDebate = useCallback(() => {
    if (!activeRoom) return;
    send({
      type: 'debate:leave',
      payload: { roomId: activeRoom.id },
    });
    setActiveRoom(null);
  }, [activeRoom, send]);

  const updateProfile = useCallback(
    (name: string, color: string) => {
      send({
        type: 'visitor:update_profile',
        payload: { name, color },
      });
      setVisitor((prev) => (prev ? { ...prev, name, color } : null));
    },
    [send]
  );

  const dismissConcluded = useCallback(() => {
    setActiveRoom(null);
    setConcludedInfo(null);
  }, []);

  // AI Practice Actions
  const startPractice = useCallback(
    (topicId: string) => {
      setIsAiPracticeActive(true);
      send({
        type: 'practice:start',
        payload: { topicId },
      });
    },
    [send]
  );

  const sendPracticeMessage = useCallback(
    (topicId: string, text: string, skipAiReply = false) => {
      if (!text.trim()) return;
      const userMsg: PracticeMessage = {
        id: `p-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        sender: 'user',
        text: text.trim(),
        timestamp: Date.now(),
      };
      setPracticeMessages((prev) => [...prev, userMsg]);
      if (!skipAiReply) {
        setIsAiTyping(true);
      } else {
        setIsAiTyping(false);
      }

      send({
        type: 'practice:message',
        payload: { topicId, text: text.trim(), skipAiReply },
      });
    },
    [send]
  );

  const toggleAiResponse = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        setIsAiTyping(false);
      }
      send({
        type: 'practice:toggle_ai',
        payload: { enabled },
      });
    },
    [send]
  );

  useEffect(() => {
    if (bridgeNotice) {
      const timer = window.setTimeout(() => {
        setBridgeNotice(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [bridgeNotice]);

  const acceptBridgeMatch = useCallback(
    (bridgeId: string, opponentId: string, topic: string) => {
      const myId = getEffectiveVisitorId();
      // Optimistically update prompt to show that I accepted and am waiting for opponent
      setBridgePrompt((prev) => {
        if (!prev || prev.id !== bridgeId) return prev;
        const currentAccepted = prev.acceptedUsers || [];
        const newAccepted = currentAccepted.includes(myId)
          ? currentAccepted
          : [...currentAccepted, myId];
        return {
          ...prev,
          acceptedUsers: newAccepted,
          status: 'waiting_opponent',
        };
      });

      send({
        type: 'practice:accept_bridge',
        payload: { bridgeId, opponentId, topic },
      });
    },
    [getEffectiveVisitorId, send]
  );

  const declineBridgeMatch = useCallback(
    (bridgeId: string) => {
      send({
        type: 'practice:decline_bridge',
        payload: { bridgeId },
      });
      setBridgePrompt(null);
    },
    [send]
  );

  const dismissBridgeNotice = useCallback(() => {
    setBridgeNotice(null);
  }, []);

  const triggerDebugEvaluation = useCallback(() => {
    send({ type: 'debug:evaluate' });
  }, [send]);

  const setMatchThreshold = useCallback(
    (threshold: number) => {
      setMatchThresholdState(threshold);
      if (thresholdDebounceTimerRef.current) {
        window.clearTimeout(thresholdDebounceTimerRef.current);
      }
      thresholdDebounceTimerRef.current = window.setTimeout(() => {
        send({ type: 'debug:set_threshold', payload: { threshold } });
      }, 200);
    },
    [send]
  );

  return {
    connected,
    visitor,
    topics,
    carpoolStatus,
    activeRoom,
    waitingTopic,
    onlineCount,
    waitingTopicsCount,
    activeDebatesCount,
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
    debugNodes,
    debugPairs,
    debugLogs,
    matchThreshold,
    activeEmbeddingModel,
    setMatchThreshold,
    startPractice,
    sendPracticeMessage,
    toggleAiResponse,
    acceptBridgeMatch,
    declineBridgeMatch,
    triggerDebugEvaluation,
    setIsAiPracticeActive,
    // Social Trends
    socialTrendsStatus,
    refreshSocialTrends: () => send({ type: 'social:refresh_trends' }),
  };
}

export type DebateSocketHandle = ReturnType<typeof useDebateSocket>;
