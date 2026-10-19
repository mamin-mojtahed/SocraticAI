import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { INITIAL_PREDEFINED_TOPICS, VISITOR_ADJECTIVES, VISITOR_NOUNS, VISITOR_COLORS } from './constants';
import type {
  TopicItem,
  TopicCarpoolStatus,
  DebateRoom,
  ChatMessage,
  Visitor,
  ArchivedDebate,
  ClientWsMessage,
  ServerWsMessage,
  PracticeMessage,
  BridgeMatchPrompt,
} from './types';
import { AiMatchmakerService, WaitingParticipant } from './services/aiMatchmaker';
import { socialTrendsService } from './services/socialTrendsService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

// In-Memory Authoritative Server State
const topics: TopicItem[] = [];
const carpoolStatus = new Map<string, TopicCarpoolStatus>();
const visitors = new Map<string, Visitor>();
const activeRooms = new Map<string, DebateRoom>();
const archivedDebates: ArchivedDebate[] = [];

// Sockets Map: visitorId -> Set<WebSocket>
const visitorSockets = new Map<string, Set<WebSocket>>();
const socketToVisitor = new Map<WebSocket, string>();

// Disconnect grace timers: visitorId -> NodeJS.Timeout
const disconnectTimers = new Map<string, NodeJS.Timeout>();

// AI Matchmaker Service & Waiting Participants
const aiMatchmaker = new AiMatchmakerService();
const waitingParticipants = new Map<string, WaitingParticipant>();

// Pending Bridge Match Proposals: bridgeId -> { id, userAId, userBId, topic, acceptedUsers, createdAt, closeness, rationale }
const pendingBridgeMatches = new Map<
  string,
  {
    id: string;
    userAId: string;
    userBId: string;
    topic: string;
    acceptedUsers: Set<string>;
    createdAt: number;
    closeness: number;
    cosineSimilarity?: number;
    threshold?: number;
    embeddingModel?: string;
    isFallbackModel?: boolean;
    rationale: string;
  }
>();

// Cooldown map: pairKey -> timestamp until which auto-match prompting is suppressed after a decline
const pairDeclineCooldowns = new Map<string, number>();

// Track active AI practice generation sequence per visitor so rapid user messages never collide
const visitorPracticeSeq = new Map<string, number>();

// Initialize predefined topics
let topicCounter = 1;
INITIAL_PREDEFINED_TOPICS.forEach((row, rowIndex) => {
  row.forEach((title) => {
    const id = `top-${topicCounter++}`;
    const topic: TopicItem = {
      id,
      title,
      createdAt: Date.now() - (100 - topicCounter) * 10000,
      createdBy: 'System',
      rowIndex,
    };
    topics.push(topic);
    carpoolStatus.set(id, {
      topicId: id,
      waitingCount: 0,
      waitingUsers: [],
      activeDebatesCount: 0,
    });
  });
});

// Seed initial social media trending topics from X, Reddit, and Facebook
socialTrendsService.getCachedTopics().forEach((trendTopic) => {
  if (!topics.some((t) => t.id === trendTopic.id)) {
    topics.push(trendTopic);
    carpoolStatus.set(trendTopic.id, {
      topicId: trendTopic.id,
      waitingCount: 0,
      waitingUsers: [],
      activeDebatesCount: 0,
    });
  }
});

// Robust background sync for social media trends (1-hour cache interval)
async function syncSocialTrends(force = false) {
  try {
    const { topics: trendTopics, status } = await socialTrendsService.getTrends(force);
    trendTopics.forEach((trendTopic) => {
      const idx = topics.findIndex((t) => t.id === trendTopic.id);
      if (idx >= 0) {
        topics[idx] = trendTopic;
      } else {
        topics.push(trendTopic);
      }
      if (!carpoolStatus.has(trendTopic.id)) {
        carpoolStatus.set(trendTopic.id, {
          topicId: trendTopic.id,
          waitingCount: 0,
          waitingUsers: [],
          activeDebatesCount: 0,
        });
      }
    });

    broadcast({
      type: 'social:trends_update',
      payload: { status, topics },
    });
  } catch (err) {
    console.warn('Background social trends sync error:', err);
  }
}

// Background sync on boot (refreshes real Reddit and Gemini if API available)
syncSocialTrends(false);

// Scheduled 1-hour recurring refresh
setInterval(() => {
  syncSocialTrends(true);
}, 60 * 60 * 1000);

// Helper to get or generate visitor
function getOrCreateVisitor(visitorId: string, customName?: string): Visitor {
  let visitor = visitors.get(visitorId);
  if (!visitor) {
    const adj = VISITOR_ADJECTIVES[Math.floor(Math.random() * VISITOR_ADJECTIVES.length)];
    const noun = VISITOR_NOUNS[Math.floor(Math.random() * VISITOR_NOUNS.length)];
    const num = Math.floor(100 + Math.random() * 900);
    const color = VISITOR_COLORS[Math.floor(Math.random() * VISITOR_COLORS.length)];

    visitor = {
      id: visitorId,
      name: customName?.trim() || `${adj} ${noun} #${num}`,
      color,
      isOnline: true,
    };
    visitors.set(visitorId, visitor);
  } else if (customName && customName.trim()) {
    visitor.name = customName.trim();
  }
  visitor.isOnline = true;
  return visitor;
}

// Convert Map of carpools to Record for JSON transmission
function getCarpoolRecord(): Record<string, TopicCarpoolStatus> {
  const record: Record<string, TopicCarpoolStatus> = {};
  for (const [key, value] of carpoolStatus.entries()) {
    record[key] = {
      topicId: value.topicId,
      waitingCount: value.waitingUsers.length,
      waitingUsers: value.waitingUsers,
      activeDebatesCount: value.activeDebatesCount,
    };
  }
  return record;
}

// Count online unique visitors
function getOnlineVisitorCount(): number {
  let count = 0;
  for (const [_, v] of visitors.entries()) {
    if (v.isOnline) count++;
  }
  return Math.max(1, count);
}

// Broadcast helper to all connected sockets
function broadcast(msg: ServerWsMessage) {
  const data = JSON.stringify(msg);
  for (const [_, sockets] of visitorSockets.entries()) {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}

// Send to specific visitor (all their open sockets)
function sendToVisitor(visitorId: string, msg: ServerWsMessage) {
  const sockets = visitorSockets.get(visitorId);
  if (!sockets) return;
  const data = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// Broadcast carpool update to all clients
function broadcastCarpoolUpdate() {
  broadcast({
    type: 'carpool:update',
    payload: { carpoolStatus: getCarpoolRecord() },
  });
}

// Broadcast AI Debug Matrix to all clients
function broadcastDebugUpdate() {
  const debugState = aiMatchmaker.getDebugState(Array.from(waitingParticipants.values()));
  broadcast({
    type: 'debug:update',
    payload: debugState,
  });
}

// Broadcast presence stats
function broadcastPresence() {
  broadcast({
    type: 'presence:update',
    payload: {
      onlineCount: getOnlineVisitorCount(),
      activeDebatesCount: activeRooms.size,
    },
  });
}

function removeVisitorFromAllWaitingQueues(visitorId: string): boolean {
  let changed = false;
  for (const carpool of carpoolStatus.values()) {
    const idx = carpool.waitingUsers.findIndex((u) => u.id === visitorId);
    if (idx !== -1) {
      carpool.waitingUsers.splice(idx, 1);
      carpool.waitingCount = carpool.waitingUsers.length;
      changed = true;
    }
  }

  if (waitingParticipants.has(visitorId)) {
    waitingParticipants.delete(visitorId);
    changed = true;
  }

  // Cancel any pending bridge match proposals involving this visitor
  for (const [bridgeId, prop] of pendingBridgeMatches.entries()) {
    if (prop.userAId === visitorId || prop.userBId === visitorId) {
      const otherId = prop.userAId === visitorId ? prop.userBId : prop.userAId;
      sendToVisitor(otherId, { type: 'bridge:cancelled', payload: { bridgeId } });
      pendingBridgeMatches.delete(bridgeId);
    }
  }

  return changed;
}

// Helper to trigger pairwise evaluation and broadcast bridge prompts as soon as at least one user is suitable
async function evaluateAndNotifyMatches() {
  const participants = Array.from(waitingParticipants.values());
  const { readyMatches } = await aiMatchmaker.evaluatePairwiseCloseness(participants);

  broadcastDebugUpdate();

  const now = Date.now();

  // Prune stale pending matches older than 90 seconds
  for (const [bId, prop] of pendingBridgeMatches.entries()) {
    if (now - prop.createdAt > 90000) {
      pendingBridgeMatches.delete(bId);
    }
  }

  for (const match of readyMatches) {
    const userAId = match.userAId;
    const userBId = match.userBId || match.opponentId;
    if (!userAId || !userBId || userAId === userBId) continue;

    const userA = participants.find((p) => p.visitorId === userAId);
    const userB = participants.find((p) => p.visitorId === userBId);
    if (!userA || !userB) continue;

    const pairKey = [userA.visitorId, userB.visitorId].sort().join('::');

    // Check if on decline cooldown
    const cooldownUntil = pairDeclineCooldowns.get(pairKey) || 0;
    if (now < cooldownUntil) {
      continue;
    }

    // Check if either user already has an active pending match offer
    let userAlreadyOffered = false;
    for (const prop of pendingBridgeMatches.values()) {
      if (
        prop.userAId === userA.visitorId ||
        prop.userBId === userA.visitorId ||
        prop.userAId === userB.visitorId ||
        prop.userBId === userB.visitorId
      ) {
        userAlreadyOffered = true;
        break;
      }
    }
    if (userAlreadyOffered) continue;

    const bridgeId = `bridge-${uuidv4().substring(0, 8)}`;
    pendingBridgeMatches.set(bridgeId, {
      id: bridgeId,
      userAId: userA.visitorId,
      userBId: userB.visitorId,
      topic: match.proposedBridgeTopic,
      acceptedUsers: new Set(),
      createdAt: now,
      closeness: match.closeness,
      cosineSimilarity: match.cosineSimilarity,
      threshold: match.threshold,
      embeddingModel: match.embeddingModel,
      isFallbackModel: match.isFallbackModel,
      rationale: match.rationale,
    });

    // Send prompt to User A
    const promptForA: BridgeMatchPrompt = {
      id: bridgeId,
      opponentId: userB.visitorId,
      opponentName: userB.visitorName,
      opponentColor: userB.visitorColor,
      myOriginalTopic: userA.topicTitle,
      theirOriginalTopic: userB.topicTitle,
      proposedBridgeTopic: match.proposedBridgeTopic,
      closeness: match.closeness,
      cosineSimilarity: match.cosineSimilarity,
      threshold: match.threshold,
      embeddingModel: match.embeddingModel,
      isFallbackModel: match.isFallbackModel,
      rationale: match.rationale,
      userAId: userA.visitorId,
      userBId: userB.visitorId,
      acceptedUsers: [],
      status: 'offered',
    };
    sendToVisitor(userA.visitorId, { type: 'bridge:prompt', payload: promptForA });

    // Send prompt to User B
    const promptForB: BridgeMatchPrompt = {
      id: bridgeId,
      opponentId: userA.visitorId,
      opponentName: userA.visitorName,
      opponentColor: userA.visitorColor,
      myOriginalTopic: userB.topicTitle,
      theirOriginalTopic: userA.topicTitle,
      proposedBridgeTopic: match.proposedBridgeTopic,
      closeness: match.closeness,
      cosineSimilarity: match.cosineSimilarity,
      threshold: match.threshold,
      embeddingModel: match.embeddingModel,
      isFallbackModel: match.isFallbackModel,
      rationale: match.rationale,
      userAId: userB.visitorId,
      userBId: userA.visitorId,
      acceptedUsers: [],
      status: 'offered',
    };
    sendToVisitor(userB.visitorId, { type: 'bridge:prompt', payload: promptForB });
  }
}

async function start() {
  const app = express();
  app.use(express.json());

  const server = createServer(app);

  // Setup WebSocket Server with noServer
  const wss = new WebSocketServer({ noServer: true });

  // Native ping-pong keepalive interval (every 10 seconds)
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const socket = ws as any;
      if (socket.isAlive === false) {
        return socket.terminate();
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch (e) {
        // ignore
      }
    });
  }, 10000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    const socket = ws as any;
    socket.isAlive = true;

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    let currentVisitorId: string | null = null;

    ws.on('message', async (raw) => {
      try {
        const msg: ClientWsMessage = JSON.parse(raw.toString());

        // Heartbeat response
        if (msg.type === 'ping') {
          socket.isAlive = true;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
          return;
        }

        switch (msg.type) {
          case 'visitor:init': {
            const { visitorId, name } = msg.payload;
            currentVisitorId = visitorId;
            const visitor = getOrCreateVisitor(visitorId, name);

            // Cancel any pending disconnect timer for this visitor
            if (disconnectTimers.has(visitorId)) {
              clearTimeout(disconnectTimers.get(visitorId)!);
              disconnectTimers.delete(visitorId);
            }

            if (!visitorSockets.has(visitorId)) {
              visitorSockets.set(visitorId, new Set());
            }
            visitorSockets.get(visitorId)!.add(ws);
            socketToVisitor.set(ws, visitorId);

            // Check if visitor is in an active room
            let activeRoom: DebateRoom | null = null;
            for (const room of activeRooms.values()) {
              if (
                room.status === 'active' &&
                (room.debater1.id === visitorId || room.debater2.id === visitorId)
              ) {
                activeRoom = room;
                break;
              }
            }

            // Check if visitor is currently waiting in any carpool
            let waitingTopicId: string | null = null;
            for (const [tId, status] of carpoolStatus.entries()) {
              if (status.waitingUsers.some((u) => u.id === visitorId)) {
                waitingTopicId = tId;
                break;
              }
            }

            const debugState = aiMatchmaker.getDebugState(Array.from(waitingParticipants.values()));

            const initState: ServerWsMessage = {
              type: 'init:state',
              payload: {
                visitor,
                topics,
                carpoolStatus: getCarpoolRecord(),
                activeRoomsCount: activeRooms.size,
                onlineVisitorsCount: getOnlineVisitorCount(),
                activeRoom,
                waitingTopicId,
                archivedDebates: archivedDebates.slice(-20).reverse(),
                debugNodes: debugState.nodes,
                debugPairs: debugState.pairs,
                debugLogs: debugState.logs,
                matchThreshold: debugState.matchThreshold,
                activeEmbeddingModel: debugState.activeEmbeddingModel,
                socialTrendsStatus: socialTrendsService.getCachedStatus() || undefined,
              },
            };
            ws.send(JSON.stringify(initState));
            broadcastPresence();
            break;
          }

          case 'visitor:update_profile': {
            if (!currentVisitorId) return;
            const visitor = visitors.get(currentVisitorId);
            if (visitor) {
              visitor.name = msg.payload.name || visitor.name;
              visitor.color = msg.payload.color || visitor.color;

              // update in waiting queues
              for (const status of carpoolStatus.values()) {
                const item = status.waitingUsers.find((u) => u.id === currentVisitorId);
                if (item) {
                  item.name = visitor.name;
                  item.color = visitor.color;
                }
              }

              if (waitingParticipants.has(currentVisitorId)) {
                const wp = waitingParticipants.get(currentVisitorId)!;
                wp.visitorName = visitor.name;
                wp.visitorColor = visitor.color;
              }

              aiMatchmaker.updateVisitorNameInLogs(currentVisitorId, visitor.name, visitor.color);

              broadcastCarpoolUpdate();
              broadcastDebugUpdate();
            }
            break;
          }

          case 'topic:create': {
            if (!currentVisitorId) return;
            const visitor = visitors.get(currentVisitorId);
            const title = msg.payload.title?.trim();
            if (!title) return;

            let existingTopic = topics.find((t) => t.title.toLowerCase() === title.toLowerCase());
            let topicToAdd: TopicItem;

            if (existingTopic) {
              topicToAdd = existingTopic;
            } else {
              const newTopic: TopicItem = {
                id: `topic-${uuidv4().substring(0, 8)}`,
                title,
                createdAt: Date.now(),
                createdBy: visitor ? visitor.name : 'Visitor',
                rowIndex: Math.floor(Math.random() * 4),
              };
              topics.unshift((topicToAdd = newTopic));
              carpoolStatus.set(newTopic.id, {
                topicId: newTopic.id,
                waitingCount: 0,
                waitingUsers: [],
                activeDebatesCount: 0,
              });

              broadcast({
                type: 'topic:added',
                payload: {
                  topic: newTopic,
                  carpoolStatus: carpoolStatus.get(newTopic.id)!,
                },
              });
            }

            // Auto-join if requested
            if (msg.payload.autoJoin) {
              handleTopicSelect(currentVisitorId, topicToAdd.id, msg.payload.stance || 'neutral');
            }
            break;
          }

          case 'topic:edit': {
            if (!currentVisitorId) return;
            const { topicId, title } = msg.payload;
            const trimmedTitle = title?.trim();
            if (!topicId || !trimmedTitle) return;

            const existingTopic = topics.find((t) => t.id === topicId);
            if (!existingTopic) return;

            const isPredefined =
              existingTopic.createdBy === 'System' ||
              existingTopic.id.startsWith('top-') ||
              Boolean(existingTopic.platform);

            if (isPredefined) {
              // Predefined topic: preserve original in the pool, create a new custom topic for the editing user
              const newTopicId = `custom-${uuidv4().substring(0, 8)}`;
              const newTopic: TopicItem = {
                id: newTopicId,
                title: trimmedTitle,
                createdAt: Date.now(),
                createdBy: currentVisitorId,
                rowIndex: 0,
              };
              topics.unshift(newTopic);
              carpoolStatus.set(newTopicId, {
                topicId: newTopicId,
                waitingCount: 0,
                waitingUsers: [],
                activeDebatesCount: 0,
              });

              // Broadcast the new topic addition to all users
              broadcast({
                type: 'topic:added',
                payload: {
                  topic: newTopic,
                  carpoolStatus: carpoolStatus.get(newTopicId)!,
                },
              });

              // Switch visitor to the new custom topic
              handleTopicSelect(currentVisitorId, newTopicId, 'neutral');
            } else {
              // Custom topic: update in place
              const oldTitle = existingTopic.title;
              existingTopic.title = trimmedTitle;

              for (const wp of waitingParticipants.values()) {
                if (wp.topicId === topicId) {
                  wp.topicTitle = trimmedTitle;
                  if (wp.currentStance.startsWith(oldTitle)) {
                    wp.currentStance =
                      trimmedTitle + wp.currentStance.slice(oldTitle.length);
                  } else {
                    wp.currentStance = `${trimmedTitle}. ${wp.currentStance}`;
                  }
                }
              }

              broadcast({
                type: 'topic:updated',
                payload: { topic: existingTopic },
              });

              pairDeclineCooldowns.clear();
              evaluateAndNotifyMatches().catch((err) =>
                console.error('Error evaluating matches after topic:edit:', err)
              );
            }
            break;
          }

          case 'topic:select': {
            if (!currentVisitorId) return;
            handleTopicSelect(currentVisitorId, msg.payload.topicId, msg.payload.stance || 'neutral');
            break;
          }

          case 'topic:leave': {
            if (!currentVisitorId) return;
            removeVisitorFromAllWaitingQueues(currentVisitorId);
            broadcastCarpoolUpdate();
            broadcastDebugUpdate();
            break;
          }

          // AI Practice Sessions in Waiting Lobby
          case 'practice:start': {
            if (!currentVisitorId) return;
            const visitor = visitors.get(currentVisitorId);
            const topic = topics.find((t) => t.id === msg.payload.topicId);
            if (!visitor || !topic) return;

            const participant = waitingParticipants.get(currentVisitorId);
            if (participant && participant.practiceHistory.length === 0) {
              const openingMsg: PracticeMessage = {
                id: uuidv4(),
                sender: 'ai',
                text: `Greetings, friend. While we await a fellow interlocutor in the Agora, what is your initial reflection on "${topic.title}"?`,
                timestamp: Date.now(),
              };
              participant.practiceHistory.push({
                role: 'assistant',
                text: openingMsg.text,
                timestamp: openingMsg.timestamp,
              });
              sendToVisitor(currentVisitorId, {
                type: 'practice:response',
                payload: { message: openingMsg, topicId: topic.id },
              });
            }
            break;
          }

          case 'practice:toggle_ai': {
            if (!currentVisitorId) return;
            const enabled = Boolean(msg.payload?.enabled);
            if (!enabled) {
              // Increment sequence to cancel any in-flight AI reply immediately
              const nextSeq = (visitorPracticeSeq.get(currentVisitorId) || 0) + 1;
              visitorPracticeSeq.set(currentVisitorId, nextSeq);
              sendToVisitor(currentVisitorId, {
                type: 'practice:typing',
                payload: { isTyping: false },
              });
            }
            break;
          }

          case 'practice:message': {
            if (!currentVisitorId) return;
            const visitor = visitors.get(currentVisitorId);
            const topic = topics.find((t) => t.id === msg.payload.topicId);
            if (!visitor || !topic) return;

            const skipAiReply = Boolean(msg.payload.skipAiReply);
            const userText = msg.payload.text.trim();
            if (!userText) return;

            let participant = waitingParticipants.get(currentVisitorId);
            if (!participant) {
              participant = {
                visitorId: visitor.id,
                visitorName: visitor.name,
                visitorColor: visitor.color,
                topicId: topic.id,
                topicTitle: topic.title,
                currentStance: `${topic.title}. ${userText}`,
                practiceHistory: [],
              };
              waitingParticipants.set(currentVisitorId, participant);
            }

            // Append user message immediately (supports out-of-turn messages at any time)
            participant.practiceHistory.push({
              role: 'user',
              text: userText,
              timestamp: Date.now(),
            });

            // Immediately update participant stance from user's own statements so matchmaking updates right away
            const recentUserTexts = participant.practiceHistory
              .filter((h) => h.role === 'user')
              .slice(-4)
              .map((h) => h.text)
              .join('. ');
            participant.currentStance = `${topic.title}. ${recentUserTexts}`;

            // Clear decline cooldown for this visitor since stance evolved
            for (const [key] of pairDeclineCooldowns.entries()) {
              if (key.includes(currentVisitorId)) {
                pairDeclineCooldowns.delete(key);
              }
            }

            const seq = (visitorPracticeSeq.get(currentVisitorId) || 0) + 1;
            visitorPracticeSeq.set(currentVisitorId, seq);

            // Trigger immediate matchmaking evaluation on user's new message
            evaluateAndNotifyMatches().catch((err) =>
              console.error('Error evaluating matches after user practice message:', err)
            );

            if (skipAiReply) {
              sendToVisitor(currentVisitorId, {
                type: 'practice:typing',
                payload: { isTyping: false },
              });
              break;
            }

            // Indicate typing to client while AI formulates reply
            sendToVisitor(currentVisitorId, {
              type: 'practice:typing',
              payload: { isTyping: true },
            });

            const targetVisitorId = currentVisitorId;
            try {
              const otherParticipants = Array.from(waitingParticipants.values()).filter(
                (p) => p.visitorId !== targetVisitorId
              );

              const { reply, evolvedStance } =
                await aiMatchmaker.generatePracticeReply(
                  participant,
                  userText,
                  otherParticipants
                );

              // Only apply AI reply if visitor is still waiting and hasn't sent a newer out-of-turn message or disabled AI
              const latestSeq = visitorPracticeSeq.get(targetVisitorId) || 0;
              if (waitingParticipants.has(targetVisitorId) && latestSeq === seq) {
                participant.currentStance = evolvedStance;
                const aiMsg: PracticeMessage = {
                  id: uuidv4(),
                  sender: 'ai',
                  text: reply,
                  timestamp: Date.now(),
                };

                participant.practiceHistory.push({
                  role: 'assistant',
                  text: reply,
                  timestamp: aiMsg.timestamp,
                });

                sendToVisitor(targetVisitorId, {
                  type: 'practice:typing',
                  payload: { isTyping: false },
                });

                sendToVisitor(targetVisitorId, {
                  type: 'practice:response',
                  payload: { message: aiMsg, topicId: topic.id },
                });

                await evaluateAndNotifyMatches();
              }
            } catch (err) {
              console.error('Error during practice message:', err);
              if ((visitorPracticeSeq.get(targetVisitorId) || 0) === seq) {
                sendToVisitor(targetVisitorId, {
                  type: 'practice:typing',
                  payload: { isTyping: false },
                });
              }
            }
            break;
          }

          case 'practice:accept_bridge': {
            if (!currentVisitorId) return;
            const { bridgeId, topic } = msg.payload;
            const prop = pendingBridgeMatches.get(bridgeId);

            if (prop) {
              prop.acceptedUsers.add(currentVisitorId);

              const userA = visitors.get(prop.userAId);
              const userB = visitors.get(prop.userBId);

              if (userA && userB) {
                // Check if BOTH users have accepted
                const bothAccepted =
                  prop.acceptedUsers.has(userA.id) && prop.acceptedUsers.has(userB.id);

                if (bothAccepted) {
                  // Both accepted! Conclude match finding and launch debate room
                  pendingBridgeMatches.delete(bridgeId);
                  removeVisitorFromAllWaitingQueues(userA.id);
                  removeVisitorFromAllWaitingQueues(userB.id);

                  const debateTopic = topic || prop.topic;
                  const newRoomId = `room-${uuidv4()}`;
                  const systemWelcomeMessage: ChatMessage = {
                    id: uuidv4(),
                    senderId: 'system',
                    senderName: 'Socratic Symposium',
                    senderColor: '#c88a32',
                    text: `💬 **Socratic Dialogue Begun**`,
                    timestamp: Date.now(),
                    isSystem: true,
                  };

                  const newRoom: DebateRoom = {
                    id: newRoomId,
                    topicId: `bridge-${uuidv4().substring(0, 6)}`,
                    topicTitle: debateTopic,
                    status: 'active',
                    debater1: userA,
                    debater2: userB,
                    messages: [systemWelcomeMessage],
                    createdAt: Date.now(),
                  };

                  activeRooms.set(newRoomId, newRoom);

                  const matchMsg: ServerWsMessage = {
                    type: 'match:found',
                    payload: { room: newRoom },
                  };
                  sendToVisitor(userA.id, matchMsg);
                  sendToVisitor(userB.id, matchMsg);

                  broadcastCarpoolUpdate();
                  broadcastDebugUpdate();
                  broadcastPresence();
                } else {
                  // One user accepted so far: sync state across BOTH parties!
                  const updateMsg: ServerWsMessage = {
                    type: 'bridge:update',
                    payload: {
                      bridgeId: prop.id,
                      acceptedUsers: Array.from(prop.acceptedUsers),
                      status: 'waiting_opponent',
                    },
                  };
                  sendToVisitor(userA.id, updateMsg);
                  sendToVisitor(userB.id, updateMsg);
                }
              }
            }
            break;
          }

          case 'practice:decline_bridge': {
            if (!currentVisitorId) return;
            const { bridgeId } = msg.payload;
            const prop = pendingBridgeMatches.get(bridgeId);

            if (prop) {
              const userAId = prop.userAId;
              const userBId = prop.userBId;
              const decliner = visitors.get(currentVisitorId);
              const declinerName = decliner ? decliner.name : 'Debater';

              pendingBridgeMatches.delete(bridgeId);

              // Set a cooldown (20 seconds) for this pair so they aren't immediately re-prompted,
              // but will be offered again when discussion continues or cooldown expires!
              const pairKey = [userAId, userBId].sort().join('::');
              pairDeclineCooldowns.set(pairKey, Date.now() + 20000);

              // Synchronously notify BOTH parties that the offer was declined
              const declinedMsg: ServerWsMessage = {
                type: 'bridge:declined',
                payload: {
                  bridgeId,
                  declinedById: currentVisitorId,
                  declinedByName: declinerName,
                },
              };
              sendToVisitor(userAId, declinedMsg);
              sendToVisitor(userBId, declinedMsg);
            }
            break;
          }

          case 'debug:evaluate': {
            // Clear decline cooldowns so evaluation immediately recalculates and offers if ready
            pairDeclineCooldowns.clear();
            evaluateAndNotifyMatches().catch((err) =>
              console.error('Error on debug:evaluate:', err)
            );
            break;
          }

          case 'debug:set_threshold': {
            const newThresh = msg.payload?.threshold;
            if (typeof newThresh === 'number') {
              aiMatchmaker.setMatchThreshold(newThresh);
              pairDeclineCooldowns.clear();
              evaluateAndNotifyMatches().catch((err) =>
                console.error('Error on debug:set_threshold:', err)
              );
            }
            break;
          }

          case 'social:refresh_trends': {
            syncSocialTrends(true).catch((err) =>
              console.error('Error on social:refresh_trends:', err)
            );
            break;
          }

          case 'debate:message': {
            if (!currentVisitorId) return;
            const { roomId, text, tag } = msg.payload;
            const room = activeRooms.get(roomId);
            if (!room || room.status !== 'active') return;

            const isDebater1 = room.debater1.id === currentVisitorId;
            const isDebater2 = room.debater2.id === currentVisitorId;
            if (!isDebater1 && !isDebater2) return;

            const sender = isDebater1 ? room.debater1 : room.debater2;
            const chatMsg: ChatMessage = {
              id: uuidv4(),
              senderId: sender.id,
              senderName: sender.name,
              senderColor: sender.color,
              text: text.trim(),
              timestamp: Date.now(),
              tag,
            };

            room.messages.push(chatMsg);

            const outgoing: ServerWsMessage = {
              type: 'debate:message',
              payload: { roomId, message: chatMsg },
            };
            sendToVisitor(room.debater1.id, outgoing);
            sendToVisitor(room.debater2.id, outgoing);
            break;
          }

          case 'debate:reaction': {
            if (!currentVisitorId) return;
            const { roomId, messageId, emoji } = msg.payload;
            const room = activeRooms.get(roomId);
            if (!room) return;
            const targetMsg = room.messages.find((m) => m.id === messageId);
            if (targetMsg) {
              if (!targetMsg.reactions) targetMsg.reactions = {};
              targetMsg.reactions[emoji] = (targetMsg.reactions[emoji] || 0) + 1;
              const outgoing: ServerWsMessage = {
                type: 'debate:message',
                payload: { roomId, message: targetMsg },
              };
              sendToVisitor(room.debater1.id, outgoing);
              sendToVisitor(room.debater2.id, outgoing);
            }
            break;
          }

          case 'debate:typing': {
            if (!currentVisitorId) return;
            const { roomId, isTyping } = msg.payload;
            const room = activeRooms.get(roomId);
            if (!room || room.status !== 'active') return;

            const opponentId =
              room.debater1.id === currentVisitorId ? room.debater2.id : room.debater1.id;
            sendToVisitor(opponentId, {
              type: 'debate:typing',
              payload: { visitorId: currentVisitorId, isTyping },
            });
            break;
          }

          case 'debate:leave': {
            if (!currentVisitorId) return;
            const { roomId } = msg.payload;
            concludeDebate(roomId, currentVisitorId);
            break;
          }
        }
      } catch (err) {
        console.error('Error handling WS message:', err);
      }
    });

    ws.on('close', () => {
      if (currentVisitorId) {
        const vId = currentVisitorId;
        const sockets = visitorSockets.get(vId);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) {
            visitorSockets.delete(vId);
            const visitor = visitors.get(vId);
            if (visitor) visitor.isOnline = false;

            // GRACE PERIOD: 45 seconds before purging from carpool queue
            if (disconnectTimers.has(vId)) {
              clearTimeout(disconnectTimers.get(vId)!);
            }

            const timer = setTimeout(() => {
              const changed = removeVisitorFromAllWaitingQueues(vId);
              if (changed) {
                broadcastCarpoolUpdate();
                broadcastDebugUpdate();
              }
              broadcastPresence();
              disconnectTimers.delete(vId);
            }, 45000);

            disconnectTimers.set(vId, timer);
            broadcastPresence();
          }
        }
        socketToVisitor.delete(ws);
      }
    });
  });

  // Handle Carpooling Matchmaking logic
  function handleTopicSelect(
    visitorId: string,
    topicId: string,
    stance: 'pro' | 'con' | 'neutral'
  ) {
    const visitor = visitors.get(visitorId);
    const topic = topics.find((t) => t.id === topicId);
    if (!visitor || !topic) return;

    if (disconnectTimers.has(visitorId)) {
      clearTimeout(disconnectTimers.get(visitorId)!);
      disconnectTimers.delete(visitorId);
    }

    // Remove from other waiting queues first
    removeVisitorFromAllWaitingQueues(visitorId);

    // Clear decline cooldowns for this visitor since they selected a new topic
    for (const [key] of pairDeclineCooldowns.entries()) {
      if (key.includes(visitorId)) {
        pairDeclineCooldowns.delete(key);
      }
    }

    const carpool = carpoolStatus.get(topicId) || {
      topicId,
      waitingCount: 0,
      waitingUsers: [],
      activeDebatesCount: 0,
    };
    carpoolStatus.set(topicId, carpool);

    // Look for exact topic waiting opponent
    const opponentIndex = carpool.waitingUsers.findIndex((u) => u.id !== visitorId);

    if (opponentIndex !== -1) {
      // Direct Match on identical topic
      const [waitingOpponent] = carpool.waitingUsers.splice(opponentIndex, 1);
      carpool.waitingCount = carpool.waitingUsers.length;
      carpool.activeDebatesCount += 1;

      waitingParticipants.delete(waitingOpponent.id);
      waitingParticipants.delete(visitorId);

      const opponentVisitor = visitors.get(waitingOpponent.id) || {
        id: waitingOpponent.id,
        name: waitingOpponent.name,
        color: waitingOpponent.color,
      };

      const newRoomId = `room-${uuidv4()}`;
      const systemWelcomeMessage: ChatMessage = {
        id: uuidv4(),
        senderId: 'system',
        senderName: 'Agora of Dialogue',
        senderColor: '#6b8e4e',
        text: `💬 **Socratic Dialogue Begun**`,
        timestamp: Date.now(),
        isSystem: true,
      };

      const newRoom: DebateRoom = {
        id: newRoomId,
        topicId: topic.id,
        topicTitle: topic.title,
        status: 'active',
        debater1: opponentVisitor,
        debater2: visitor,
        messages: [systemWelcomeMessage],
        createdAt: Date.now(),
      };

      activeRooms.set(newRoomId, newRoom);

      const matchMsg: ServerWsMessage = {
        type: 'match:found',
        payload: { room: newRoom },
      };
      sendToVisitor(opponentVisitor.id, matchMsg);
      sendToVisitor(visitor.id, matchMsg);

      broadcastCarpoolUpdate();
      broadcastDebugUpdate();
      broadcastPresence();
    } else {
      // 1st visitor waiting in carpool for this topic
      carpool.waitingUsers.push({
        id: visitor.id,
        name: visitor.name,
        color: visitor.color,
        stance,
        joinedAt: Date.now(),
      });
      carpool.waitingCount = carpool.waitingUsers.length;

      // Register for AI matchmaking and practice
      waitingParticipants.set(visitorId, {
        visitorId: visitor.id,
        visitorName: visitor.name,
        visitorColor: visitor.color,
        topicId: topic.id,
        topicTitle: topic.title,
        currentStance: stance === 'neutral' ? topic.title : `${topic.title} (${stance})`,
        practiceHistory: [],
      });

      sendToVisitor(visitorId, {
        type: 'match:waiting',
        payload: {
          topicId,
          topicTitle: topic.title,
          queuePosition: carpool.waitingUsers.length,
        },
      });

      broadcastCarpoolUpdate();

      // Trigger pairwise evaluation for the debug view and potential cross-topic bridge
      evaluateAndNotifyMatches().catch((err) =>
        console.error('Error evaluating matches on select:', err)
      );
    }
  }

  function concludeDebate(roomId: string, leaverId?: string) {
    const room = activeRooms.get(roomId);
    if (!room) return;

    room.status = 'concluded';
    room.concludedAt = Date.now();
    const leaver = leaverId ? visitors.get(leaverId) : null;
    const reason = leaver
      ? `${leaver.name} concluded the dialogue.`
      : 'The dialogue has concluded.';
    room.concludedReason = reason;

    const carpool = carpoolStatus.get(room.topicId);
    if (carpool && carpool.activeDebatesCount > 0) {
      carpool.activeDebatesCount -= 1;
    }

    const firstMeaningfulMsg = room.messages.find((m) => !m.isSystem);
    const archiveItem: ArchivedDebate = {
      id: room.id,
      topicTitle: room.topicTitle,
      debater1: room.debater1,
      debater2: room.debater2,
      messagesCount: room.messages.length,
      completedAt: Date.now(),
      preview: firstMeaningfulMsg
        ? firstMeaningfulMsg.text.slice(0, 90) + '...'
        : 'A constructive dialogue concluded.',
    };
    archivedDebates.push(archiveItem);

    const concludeMsg: ServerWsMessage = {
      type: 'debate:concluded',
      payload: { roomId, reason, archive: archiveItem },
    };
    sendToVisitor(room.debater1.id, concludeMsg);
    sendToVisitor(room.debater2.id, concludeMsg);

    activeRooms.delete(roomId);

    broadcastCarpoolUpdate();
    broadcastDebugUpdate();
    broadcastPresence();
  }

  // API endpoint for health and debug overview
  app.get('/api/status', (req, res) => {
    res.json({
      onlineVisitors: getOnlineVisitorCount(),
      activeDebates: activeRooms.size,
      totalTopics: topics.length,
      archivedDebatesCount: archivedDebates.length,
      waitingParticipantsCount: waitingParticipants.size,
      carpools: getCarpoolRecord(),
      debug: aiMatchmaker.getDebugState(Array.from(waitingParticipants.values())),
    });
  });

  // Vite integration in development or static serving in production
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Dialectic Debate Arena running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Fatal server boot error:', err);
  process.exit(1);
});
