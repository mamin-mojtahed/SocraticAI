import { GoogleGenAI, Type } from '@google/genai';
import type {
  TopicNode,
  TopicPairCloseness,
  AiDebugLog,
  BridgeMatchPrompt,
} from '../types';
import { v4 as uuidv4 } from 'uuid';

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';

const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Ordered priority list of Gemini Embedding models (latest multilingual-capable models first, with fallback to lower models)
export const EMBEDDING_MODELS_PRIORITY = [
  'gemini-embedding-2-preview',
  'gemini-embedding-001',
  'text-embedding-004',
] as const;

export const DEFAULT_MATCH_THRESHOLD = 70;

export interface EmbeddingResult {
  vector: number[];
  model: string;
  dimensions: number;
  isFallback: boolean;
  timestamp: number;
}

export interface WaitingParticipant {
  visitorId: string;
  visitorName: string;
  visitorColor: string;
  topicId: string;
  topicTitle: string;
  currentStance: string;
  practiceHistory: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>;
  embedding?: number[];
  embeddingModel?: string;
  embeddingDimensions?: number;
  isFallbackEmbedding?: boolean;
  lastEmbeddedText?: string;
  lastEmbeddedAt?: number;
}

export class AiMatchmakerService {
  private iterationCounter = 0;
  private debugLogs: AiDebugLog[] = [];
  private pairEvaluations = new Map<string, TopicPairCloseness>();
  private matchThreshold: number = DEFAULT_MATCH_THRESHOLD;
  private activeEmbeddingModel: string = EMBEDDING_MODELS_PRIORITY[0];

  // Cache embeddings by text key to avoid redundant API calls for unchanged profiles
  private embeddingCache = new Map<string, EmbeddingResult>();
  // Cache synthesized bridge topics by semantic pair state
  private bridgeSynthesisCache = new Map<string, { bridgeTopic: string; commonGround: string }>();

  public getMatchThreshold(): number {
    return this.matchThreshold;
  }

  public setMatchThreshold(threshold: number): number {
    const clamped = Math.max(10, Math.min(98, Math.round(threshold)));
    this.matchThreshold = clamped;
    for (const [key, pair] of this.pairEvaluations.entries()) {
      pair.threshold = clamped;
      pair.isReady = pair.closeness >= clamped;
      this.pairEvaluations.set(key, pair);
    }
    return this.matchThreshold;
  }

  public getActiveEmbeddingModel(): string {
    return this.activeEmbeddingModel;
  }

  public updateVisitorNameInLogs(visitorId: string, newName: string, newColor?: string) {
    for (const log of this.debugLogs) {
      if (log.userAId === visitorId) {
        log.userAName = newName;
        if (newColor) log.userAColor = newColor;
        log.userA = `${newName} ("${log.topicA}")`;
      }
      if (log.userBId === visitorId) {
        log.userBName = newName;
        if (newColor) log.userBColor = newColor;
        log.userB = `${newName} ("${log.topicB}")`;
      }
    }
  }

  public getDebugState(participants: WaitingParticipant[]): {
    nodes: TopicNode[];
    pairs: TopicPairCloseness[];
    logs: AiDebugLog[];
    matchThreshold: number;
    activeEmbeddingModel: string;
  } {
    const participantIds = new Set(participants.map((p) => p.visitorId));

    // Prune stale pairs when participants disconnect or leave
    for (const [key, pair] of this.pairEvaluations.entries()) {
      if (!participantIds.has(pair.userA.id) || !participantIds.has(pair.userB.id)) {
        this.pairEvaluations.delete(key);
      }
    }

    const nodes: TopicNode[] = participants.map((p) => ({
      visitorId: p.visitorId,
      visitorName: p.visitorName,
      visitorColor: p.visitorColor,
      topicId: p.topicId,
      topicTitle: p.topicTitle,
      currentSummary: p.currentStance || p.topicTitle,
      embeddingModel: p.embeddingModel || this.activeEmbeddingModel,
      embeddingDimensions: p.embeddingDimensions,
      embeddingPreview: p.embedding
        ? p.embedding.slice(0, 8).map((v) => Number(v.toFixed(4)))
        : undefined,
      isFallbackEmbedding: p.isFallbackEmbedding,
      lastEmbeddedAt: p.lastEmbeddedAt,
    }));

    return {
      nodes,
      pairs: Array.from(this.pairEvaluations.values()),
      logs: this.debugLogs.slice(-80).reverse(),
      matchThreshold: this.matchThreshold,
      activeEmbeddingModel: this.activeEmbeddingModel,
    };
  }

  /**
   * Retrieve existing ready matches without re-triggering embedding evaluation or creating logs
   */
  public getExistingReadyMatches(participants: WaitingParticipant[]): BridgeMatchPrompt[] {
    const readyMatches: BridgeMatchPrompt[] = [];
    const pMap = new Map(participants.map((p) => [p.visitorId, p]));

    for (const pair of this.pairEvaluations.values()) {
      if (pair.isReady) {
        const userA = pMap.get(pair.userA.id);
        const userB = pMap.get(pair.userB.id);
        if (userA && userB) {
          readyMatches.push({
            id: uuidv4(),
            opponentId: userB.visitorId,
            opponentName: userB.visitorName,
            opponentColor: userB.visitorColor,
            myOriginalTopic: userA.topicTitle,
            theirOriginalTopic: userB.topicTitle,
            proposedBridgeTopic: pair.bridgeTopic,
            closeness: pair.closeness,
            cosineSimilarity: pair.cosineSimilarity,
            threshold: pair.threshold,
            embeddingModel: pair.embeddingModel,
            isFallbackModel: pair.isFallbackModel,
            rationale: pair.commonGround,
            userAId: userA.visitorId,
            userBId: userB.visitorId,
            acceptedUsers: [],
            status: 'offered',
          });
        }
      }
    }
    return readyMatches;
  }

  /**
   * Build the backend semantic text for embedding comparison.
   * Uses the backend diagnostic profile (currentStance) when available so the embedding
   * captures unpacked values, axioms, and trade-offs.
   */
  public buildParticipantSemanticText(p: WaitingParticipant): string {
    const cleanTitle = p.topicTitle.trim();
    const cleanStance = (p.currentStance || '')
      .replace(/\(neutral\)/gi, '')
      .trim();

    if (cleanStance && cleanStance.toLowerCase() !== cleanTitle.toLowerCase()) {
      return `${cleanTitle} — ${cleanStance}`;
    }

    const recentUserStatements = p.practiceHistory
      .filter((h) => h.role === 'user')
      .slice(-4)
      .map((h) => h.text.trim())
      .filter(Boolean);

    if (recentUserStatements.length > 0) {
      return `${cleanTitle} — ${recentUserStatements.join('. ')}`;
    }

    return cleanTitle;
  }

  /**
   * Normalize a numeric vector to unit L2 length.
   */
  private normalizeVector(vec: number[]): number[] {
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) {
      sumSq += vec[i] * vec[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm < 1e-12) return vec;
    const out = new Array<number>(vec.length);
    for (let i = 0; i < vec.length; i++) {
      out[i] = vec[i] / norm;
    }
    return out;
  }

  /**
   * Compute raw Cosine Similarity between two vectors in [0, 1].
   */
  public computeRawCosineSimilarity(vecA: number[], vecB: number[]): number {
    const len = Math.min(vecA.length, vecB.length);
    if (len === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      const a = vecA[i];
      const b = vecB[i];
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom < 1e-12) return 0;
    const rawCosine = dot / denom;
    return Math.max(0, Math.min(1, rawCosine));
  }

  /**
   * Calibrate and bound raw embedding cosine similarity to correct for high-dimensional
   * embedding anisotropy (especially for short unrelated words/phrases that sit around ~0.65-0.72 raw cosine).
   */
  public normalizeEmbeddingSimilarity(
    rawCosine: number,
    textA: string,
    textB: string,
    isFallback: boolean
  ): number {
    const cleanA = textA.trim().toLowerCase();
    const cleanB = textB.trim().toLowerCase();
    if (cleanA && cleanA === cleanB) {
      return 1.0;
    }

    if (isFallback) {
      return Math.max(0, Math.min(1, Number(Math.pow(rawCosine, 0.9).toFixed(4))));
    }

    // Tokenize to check word count and lexical overlap
    const stopWords = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
      'have', 'has', 'had', 'not', 'but', 'what', 'when', 'where', 'who', 'why',
      'how', 'all', 'any', 'both', 'each', 'more', 'most', 'other', 'some', 'such',
      'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'into', 'over',
      'about', 'their', 'there', 'they', 'them', 'then', 'these', 'those', 'your',
      'core', 'stance', 'values', 'axiom', 'axioms', 'trade', 'offs', 'boundary',
    ]);

    const tokensA = cleanA
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2 && !stopWords.has(t));
    const tokensB = cleanB
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2 && !stopWords.has(t));

    const setB = new Set(tokensB);
    let sharedCount = 0;
    for (const tA of tokensA) {
      if (setB.has(tA)) {
        sharedCount++;
      } else {
        // Check 4-char prefix stem match
        for (const tB of setB) {
          if (tA.length >= 4 && tB.length >= 4 && tA.slice(0, 4) === tB.slice(0, 4)) {
            sharedCount += 0.7;
            break;
          }
        }
      }
    }

    const minTokens = Math.max(1, Math.min(tokensA.length, tokensB.length));
    const overlapRatio = Math.min(1, sharedCount / minTokens);
    const isShortInput = tokensA.length <= 5 && tokensB.length <= 5;

    // Short unrelated words/phrases have a higher anisotropic cone floor (~0.68) in Gemini Embedding models
    const BASELINE_FLOOR = isShortInput && overlapRatio === 0 ? 0.68 : 0.60;
    const SATURATION_CEILING = 0.89;

    let calibrated: number;
    if (rawCosine <= BASELINE_FLOOR) {
      const floorRatio = Math.max(0, (rawCosine - 0.40) / Math.max(0.05, BASELINE_FLOOR - 0.40));
      calibrated = 0.04 + 0.16 * Math.pow(floorRatio, 1.3);
    } else if (rawCosine >= SATURATION_CEILING) {
      const topRatio = Math.min(1, (rawCosine - SATURATION_CEILING) / (1.0 - SATURATION_CEILING));
      calibrated = 0.94 + 0.06 * topRatio;
    } else {
      const t = (rawCosine - BASELINE_FLOOR) / (SATURATION_CEILING - BASELINE_FLOOR);
      calibrated = 0.20 + 0.74 * Math.pow(t, 1.25);
    }

    // Extra guard for completely disjoint very short phrases
    if (isShortInput && overlapRatio === 0 && rawCosine < 0.76) {
      calibrated = Math.min(calibrated, 0.34);
    }

    return Math.max(0, Math.min(1, Number(calibrated.toFixed(4))));
  }

  /**
   * Local deterministic vector fallback used only if all Gemini Embedding API models are unreachable.
   */
  private computeFallbackEmbedding(text: string): EmbeddingResult {
    const DIM = 256;
    const vec = new Array<number>(DIM).fill(0);
    const normalized = text.normalize('NFKC').toLowerCase().trim();

    // Word token hashing (dimensions 0..159)
    const tokens = normalized.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
    for (const token of tokens) {
      let h = 2166136261;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx1 = Math.abs(h) % 160;
      const idx2 = Math.abs(h >> 7) % 160;
      vec[idx1] += 1.4;
      vec[idx2] += 0.8;
    }

    // Character 3-gram hashing (dimensions 160..255)
    const cleanChars = normalized.replace(/\s+/g, ' ');
    for (let i = 0; i <= cleanChars.length - 3; i++) {
      const trigram = cleanChars.slice(i, i + 3);
      let h = 5381;
      for (let c = 0; c < 3; c++) {
        h = ((h << 5) + h) ^ trigram.charCodeAt(c);
      }
      const idx = 160 + (Math.abs(h) % 96);
      vec[idx] += 0.35;
    }

    return {
      vector: this.normalizeVector(vec),
      model: 'local-embedding-fallback',
      dimensions: DIM,
      isFallback: true,
      timestamp: Date.now(),
    };
  }

  /**
   * Embed text using the latest Gemini Embedding model ('gemini-embedding-2-preview')
   * with automatic fallback to lower embedding models ('gemini-embedding-001', 'text-embedding-004').
   */
  public async embedTextWithFallback(
    text: string,
    preferredModel?: string
  ): Promise<EmbeddingResult> {
    const cleanText = text.trim() || 'debate topic';
    const cacheKey = `${preferredModel || 'auto'}::${cleanText}`;
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    if (apiKey) {
      const modelsToTry: string[] = preferredModel
        ? [preferredModel, ...EMBEDDING_MODELS_PRIORITY.filter((m) => m !== preferredModel)]
        : [...EMBEDDING_MODELS_PRIORITY];

      for (let i = 0; i < modelsToTry.length; i++) {
        const modelName = modelsToTry[i];
        const isFallback = modelName !== EMBEDDING_MODELS_PRIORITY[0];

        try {
          const response = await ai.models.embedContent({
            model: modelName,
            contents: cleanText,
          });

          const rawValues =
            response.embeddings?.[0]?.values ||
            (response as unknown as { embedding?: { values?: number[] } }).embedding?.values;

          if (Array.isArray(rawValues) && rawValues.length > 0) {
            const normalizedVec = this.normalizeVector(rawValues);
            const result: EmbeddingResult = {
              vector: normalizedVec,
              model: modelName,
              dimensions: normalizedVec.length,
              isFallback,
              timestamp: Date.now(),
            };

            this.activeEmbeddingModel = modelName;
            this.embeddingCache.set(cacheKey, result);
            this.embeddingCache.set(`${modelName}::${cleanText}`, result);

            if (this.embeddingCache.size > 300) {
              const firstKey = this.embeddingCache.keys().next().value;
              if (firstKey) this.embeddingCache.delete(firstKey);
            }

            return result;
          }
        } catch (err) {
          console.warn(
            `[AiMatchmaker] Embedding model "${modelName}" failed, falling back to next model:`,
            (err as Error).message
          );
        }
      }
    }

    const fallbackResult = this.computeFallbackEmbedding(cleanText);
    this.activeEmbeddingModel = fallbackResult.model;
    this.embeddingCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }

  /**
   * Ensure a WaitingParticipant has an up-to-date embedding vector for their current topic & stance.
   */
  public async ensureParticipantEmbedding(
    participant: WaitingParticipant,
    forceModel?: string
  ): Promise<EmbeddingResult> {
    const semanticText = this.buildParticipantSemanticText(participant);

    if (
      !forceModel &&
      participant.embedding &&
      participant.embedding.length > 0 &&
      participant.lastEmbeddedText === semanticText &&
      participant.embeddingModel
    ) {
      return {
        vector: participant.embedding,
        model: participant.embeddingModel,
        dimensions: participant.embeddingDimensions || participant.embedding.length,
        isFallback: Boolean(participant.isFallbackEmbedding),
        timestamp: participant.lastEmbeddedAt || Date.now(),
      };
    }

    const emb = await this.embedTextWithFallback(semanticText, forceModel);
    participant.embedding = emb.vector;
    participant.embeddingModel = emb.model;
    participant.embeddingDimensions = emb.dimensions;
    participant.isFallbackEmbedding = emb.isFallback;
    participant.lastEmbeddedText = semanticText;
    participant.lastEmbeddedAt = emb.timestamp;
    return emb;
  }

  /**
   * Generate a natural, conversational reply for the user while keeping all diagnostic
   * stance/axiom/boundary synthesis strictly for the backend matchmaker and Match Graph.
   */
  public async generatePracticeReply(
    user: WaitingParticipant,
    userMessage: string,
    otherParticipants: WaitingParticipant[]
  ): Promise<{ reply: string; evolvedStance: string }> {
    this.iterationCounter++;

    const userTurnsCount = user.practiceHistory.filter((h) => h.role === 'user').length;
    const otherWaiting = otherParticipants.filter((p) => p.visitorId !== user.visitorId);

    const implicitThemesContext =
      otherWaiting.length > 0
        ? `Other waiting people in the lobby (NEVER mention them or their topics in "reply", but use this to guide your subtle conversational question and to enrich "evolvedStance" when their underlying values/themes align):
${otherWaiting
  .map((p) => `- Waiting participant on "${p.topicTitle}" (Diagnostic profile: "${p.currentStance || p.topicTitle}")`)
  .join('\n')}`
        : 'No other participants are waiting right now.';

    const systemPrompt = `You are a warm, curious, and natural conversational partner helping someone explore their thoughts on "${user.topicTitle}" while they wait for a live partner.
Current user message count: ${userTurnsCount}.
${implicitThemesContext}

### Strict Separation of Outputs
You produce two completely distinct fields in JSON:
1. **"reply" (Shown to the user in chat)**:
   - Must feel 100% natural, warm, relaxed, and human—like chatting with a thoughtful friend.
   - NEVER sound clinical, diagnostic, academic, or analytical in "reply". Do NOT use terms like "axiom", "boundary condition", "trade-off matrix", "match profile", or "intake".
   - Ask at most ONE simple, conversational follow-up question (under 55 words) that naturally gets them talking about what matters to them or where they'd draw the line in real life.
   - Never debate them or tell them they're wrong; just reflect their thought naturally and ask a curious question.
   - Never explicitly mention another participant's topic.
   - After 3–5 user turns (when their view is clear), wrap up warmly and naturally in 1–2 casual sentences without asking another question—and NEVER dump a diagnostic profile into "reply".

2. **"evolvedStance" (Backend-only diagnostic profile for the Matchmaker & Match Graph — NEVER shown in chat)**:
   - Write a rich, diagnostic synthesis (2–3 sentences) of the user's Core Stance, Driving Values/Axioms (e.g., individual liberty vs. collective safety, fairness vs. utility), and Practical Boundaries.
   - If any other waiting participant in the lobby shares overlapping or complementary values/themes with the user's statements, explicitly articulate those shared philosophical dimensions in "evolvedStance" so the backend embedding matchmaker can immediately recognize their suitability and suggest a match.`;

    const userPrompt = `Conversation so far:
${user.practiceHistory.map((h) => `${h.role === 'user' ? 'User' : 'Partner'}: ${h.text}`).join('\n')}

User's latest message:
"${userMessage}"

Generate the natural conversational "reply" (for the user) and the backend-only diagnostic "evolvedStance" (for the matchmaker and graph).`;

    try {
      if (apiKey) {
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                reply: {
                  type: Type.STRING,
                  description:
                    'Warm, casual, natural conversational response shown to the user (under 55 words, zero diagnostic jargon).',
                },
                evolvedStance: {
                  type: Type.STRING,
                  description:
                    'Backend-only diagnostic profile summarizing Core Stance, Axioms/Values, Boundaries, and shared conceptual bridges for the matchmaker and graph.',
                },
              },
              required: ['reply', 'evolvedStance'],
            },
          },
        });

        const raw = response.text || '{}';
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed.reply && parsed.evolvedStance) {
          return {
            reply: String(parsed.reply).trim(),
            evolvedStance: String(parsed.evolvedStance).trim(),
          };
        }
      }
    } catch (err) {
      console.warn('Gemini Lite practice call error, falling back to conversational heuristic:', err);
    }

    // Conversational, non-diagnostic fallback for user chat
    let fallbackReply: string;
    if (userTurnsCount <= 1) {
      fallbackReply = `I can definitely see where you're coming from on that. What do you think is the biggest real-world benefit if more people approached it that way?`;
    } else if (userTurnsCount === 2) {
      fallbackReply = `That makes a lot of sense. Is there a situation where taking that idea too far could backfire, or where you'd personally draw the line?`;
    } else if (userTurnsCount === 3) {
      fallbackReply = `That's a really grounded way to look at it. When someone disagrees with you on this, what do you think they usually miss?`;
    } else {
      fallbackReply = `Got it—that gives a really clear picture of how you think about this. Let's see who in the lobby lines up well with your perspective!`;
    }

    // Backend-only diagnostic synthesis for matchmaker & graph
    const userPoints = user.practiceHistory
      .filter((h) => h.role === 'user')
      .slice(-4)
      .map((h) => h.text.trim())
      .join('; ');
    const sharedHint =
      otherWaiting.length > 0
        ? ` Connects with broader trade-offs around ${otherWaiting[0].currentStance || otherWaiting[0].topicTitle}.`
        : '';
    const evolvedStance = `Core Stance on ${user.topicTitle}: ${userPoints}.${sharedHint}`;

    return {
      reply: fallbackReply,
      evolvedStance,
    };
  }

  /**
   * Evaluate pairwise closeness across all waiting participants using Gemini Embeddings.
   */
  public async evaluatePairwiseCloseness(
    participants: WaitingParticipant[]
  ): Promise<{ pairs: TopicPairCloseness[]; readyMatches: BridgeMatchPrompt[] }> {
    if (participants.length === 1) {
      await this.ensureParticipantEmbedding(participants[0]);
      this.pairEvaluations.clear();
      return { pairs: [], readyMatches: [] };
    }

    if (participants.length < 2) {
      this.pairEvaluations.clear();
      return { pairs: [], readyMatches: [] };
    }

    const currentVisitorIds = new Set(participants.map((p) => p.visitorId));
    this.iterationCounter++;

    for (const [key, pair] of this.pairEvaluations.entries()) {
      if (!currentVisitorIds.has(pair.userA.id) || !currentVisitorIds.has(pair.userB.id)) {
        this.pairEvaluations.delete(key);
      }
    }

    // 1. Compute / refresh Gemini Embeddings for all waiting participants
    await Promise.all(participants.map((p) => this.ensureParticipantEmbedding(p)));

    // Build canonical pairs (sorted by visitorId so each pair of persons has a stable identity over time)
    const pairsToEvaluate: [WaitingParticipant, WaitingParticipant][] = [];
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        const [canonA, canonB] = [participants[i], participants[j]].sort((a, b) =>
          a.visitorId.localeCompare(b.visitorId)
        );
        pairsToEvaluate.push([canonA, canonB]);
      }
    }

    const readyMatches: BridgeMatchPrompt[] = [];
    const batchTimestamp = Date.now();

    // 2. Compare each pair's embeddings and check against threshold
    for (const [userA, userB] of pairsToEvaluate) {
      const pairKey = `${userA.visitorId}::${userB.visitorId}`;
      const evalResult = await this.evaluateSinglePairByEmbedding(userA, userB, batchTimestamp);

      this.pairEvaluations.set(pairKey, evalResult);

      this.debugLogs.push({
        id: uuidv4(),
        timestamp: batchTimestamp,
        iteration: this.iterationCounter,
        pairKey,
        userAId: userA.visitorId,
        userBId: userB.visitorId,
        userAName: userA.visitorName,
        userBName: userB.visitorName,
        userAColor: userA.visitorColor,
        userBColor: userB.visitorColor,
        topicA: userA.topicTitle,
        topicB: userB.topicTitle,
        stanceA: userA.currentStance || userA.topicTitle,
        stanceB: userB.currentStance || userB.topicTitle,
        userA: `${userA.visitorName} ("${userA.topicTitle}")`,
        userB: `${userB.visitorName} ("${userB.topicTitle}")`,
        score: evalResult.closeness,
        cosineSimilarity: evalResult.cosineSimilarity,
        threshold: evalResult.threshold,
        embeddingModel: evalResult.embeddingModel,
        isFallbackModel: evalResult.isFallbackModel,
        vectorDimensions: evalResult.vectorDimensions,
        notes: evalResult.commonGround,
        proposedTopic: evalResult.bridgeTopic,
      });

      if (this.debugLogs.length > 80) {
        this.debugLogs = this.debugLogs.slice(-80);
      }

      if (evalResult.isReady) {
        readyMatches.push({
          id: uuidv4(),
          opponentId: userB.visitorId,
          opponentName: userB.visitorName,
          opponentColor: userB.visitorColor,
          myOriginalTopic: userA.topicTitle,
          theirOriginalTopic: userB.topicTitle,
          proposedBridgeTopic: evalResult.bridgeTopic,
          closeness: evalResult.closeness,
          cosineSimilarity: evalResult.cosineSimilarity,
          threshold: evalResult.threshold,
          embeddingModel: evalResult.embeddingModel,
          isFallbackModel: evalResult.isFallbackModel,
          rationale: evalResult.commonGround,
          userAId: userA.visitorId,
          userBId: userB.visitorId,
        });
      }
    }

    // Sort readyMatches by highest closeness so the most suitable pair is suggested first
    readyMatches.sort((a, b) => b.closeness - a.closeness);

    return {
      pairs: Array.from(this.pairEvaluations.values()),
      readyMatches,
    };
  }

  /**
   * Compare two participants using their normalized Gemini Embedding vectors and threshold.
   */
  private async evaluateSinglePairByEmbedding(
    userA: WaitingParticipant,
    userB: WaitingParticipant,
    evaluatedAt: number
  ): Promise<TopicPairCloseness> {
    const pairKey = `${userA.visitorId}::${userB.visitorId}`;

    let embA = await this.ensureParticipantEmbedding(userA);
    let embB = await this.ensureParticipantEmbedding(userB);

    if (embA.model !== embB.model || embA.dimensions !== embB.dimensions) {
      const targetModel = embA.isFallback ? embA.model : embB.model;
      if (embA.model !== targetModel) {
        embA = await this.ensureParticipantEmbedding(userA, targetModel);
      }
      if (embB.model !== targetModel) {
        embB = await this.ensureParticipantEmbedding(userB, targetModel);
      }
    }

    const textA = this.buildParticipantSemanticText(userA);
    const textB = this.buildParticipantSemanticText(userB);
    const rawCosine = this.computeRawCosineSimilarity(embA.vector, embB.vector);
    const isFallback = Boolean(embA.isFallback || embB.isFallback);

    // Accurate calibrated similarity matching: corrects for high-dimensional embedding
    // anisotropy so that thematic resonance is measured accurately as before
    const calibratedSimilarity = this.normalizeEmbeddingSimilarity(
      rawCosine,
      textA,
      textB,
      isFallback
    );

    const closeness = Math.max(0, Math.min(100, Math.round(calibratedSimilarity * 100)));
    const isReady = closeness >= this.matchThreshold;

    // Actual mathematical cosine similarity of the vectors (0.0000 - 1.0000 cos)
    const cosineSimilarity = Math.max(0, Math.min(1, Number(rawCosine.toFixed(4))));

    const { bridgeTopic, commonGround } = await this.synthesizeBridgeTopic(
      userA,
      userB,
      closeness
    );

    return {
      pairKey,
      userA: {
        id: userA.visitorId,
        name: userA.visitorName,
        topic: userA.topicTitle,
        stance: userA.currentStance || userA.topicTitle,
        color: userA.visitorColor,
      },
      userB: {
        id: userB.visitorId,
        name: userB.visitorName,
        topic: userB.topicTitle,
        stance: userB.currentStance || userB.topicTitle,
        color: userB.visitorColor,
      },
      closeness,
      cosineSimilarity,
      threshold: this.matchThreshold,
      embeddingModel: embA.model,
      isFallbackModel: isFallback,
      vectorDimensions: embA.dimensions,
      bridgeTopic,
      commonGround,
      isReady,
      lastEvaluatedAt: evaluatedAt,
    };
  }

  /**
   * Synthesize an organic bridge debate question and diagnostic rationale
   * using the Lite model ('gemini-3.1-flash-lite').
   */
  private async synthesizeBridgeTopic(
    userA: WaitingParticipant,
    userB: WaitingParticipant,
    closeness: number
  ): Promise<{ bridgeTopic: string; commonGround: string }> {
    const synthesisKey = `${userA.topicTitle}::${userA.currentStance}::${userB.topicTitle}::${userB.currentStance}`;
    const cached = this.bridgeSynthesisCache.get(synthesisKey);
    if (cached) {
      return cached;
    }

    if (apiKey) {
      try {
        const prompt = `Two participants are being evaluated for a debate match (${closeness}% alignment).

Participant 1 (${userA.visitorName}):
- Topic: "${userA.topicTitle}"
- Diagnostic Profile: "${userA.currentStance || userA.topicTitle}"

Participant 2 (${userB.visitorName}):
- Topic: "${userB.topicTitle}"
- Diagnostic Profile: "${userB.currentStance || userB.topicTitle}"

Task:
1. Formulate a natural, engaging "bridgeTopic" phrased as a single cohesive debate question or resolution that captures the core tension connecting both perspectives—do NOT just concatenate the two topic titles with "vs." or "&".
2. Write a concise 1-sentence diagnostic "commonGround" explaining the shared underlying value, axiom, or trade-off connecting their stances.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                bridgeTopic: {
                  type: Type.STRING,
                  description:
                    'A cohesive debate resolution or question capturing the shared tension.',
                },
                commonGround: {
                  type: Type.STRING,
                  description:
                    '1-sentence diagnostic note on the shared value, axiom, or trade-off.',
                },
              },
              required: ['bridgeTopic', 'commonGround'],
            },
          },
        });

        const raw = response.text || '{}';
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        const data = JSON.parse(cleaned);
        if (data.bridgeTopic && data.commonGround) {
          const result = {
            bridgeTopic: String(data.bridgeTopic).trim(),
            commonGround: String(data.commonGround).trim(),
          };
          this.bridgeSynthesisCache.set(synthesisKey, result);
          return result;
        }
      } catch (err) {
        console.warn('Bridge topic synthesis fallback:', (err as Error).message);
      }
    }

    const sameTopic = userA.topicTitle.toLowerCase() === userB.topicTitle.toLowerCase();
    const fallbackBridge = sameTopic
      ? userA.topicTitle
      : `Where should we draw the line when competing priorities around ${userA.topicTitle.toLowerCase()} and broader societal trade-offs collide?`;

    const fallbackResult = {
      bridgeTopic: fallbackBridge,
      commonGround:
        'Diagnostic alignment: Both stances hinge on balancing individual agency against collective outcomes.',
    };
    this.bridgeSynthesisCache.set(synthesisKey, fallbackResult);
    return fallbackResult;
  }
}
