import { GoogleGenAI } from '@google/genai';
import type { TopicItem, SocialTrendsStatus, SocialPlatform } from '../types';

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';

const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export interface SocialTrendItem {
  platform: SocialPlatform;
  title: string;
  tag?: string;
  rank: number;
}

// Fallback high-engagement topics for X, Reddit, and Facebook
const FALLBACK_X_TRENDS: SocialTrendItem[] = [
  { platform: 'x', title: 'Open-Weight AI Models vs Closed Proprietary Systems', tag: '#AIAct', rank: 1 },
  { platform: 'x', title: 'Mandatory Remote Work Laws for Digital Knowledge Workers', tag: '#FutureOfWork', rank: 2 },
  { platform: 'x', title: 'Algorithmic Content Monetization vs Human Creative Rights', tag: '#CreatorEconomy', rank: 3 },
  { platform: 'x', title: 'Global Carbon Tariffs on Heavy Manufacturing', tag: '#ClimatePolicy', rank: 4 },
  { platform: 'x', title: 'Commercial Space Mining Jurisdiction and Treaties', tag: '#SpaceExploration', rank: 5 },
];

const FALLBACK_REDDIT_TRENDS: SocialTrendItem[] = [
  { platform: 'reddit', title: 'Is Modern Science Facing a Catastrophic Reproducibility Crisis?', tag: 'r/science', rank: 1 },
  { platform: 'reddit', title: 'Subscription Culture: Do Consumers Still Own Anything Today?', tag: 'r/technology', rank: 2 },
  { platform: 'reddit', title: 'Should Universal Basic Income Replace Traditional Social Welfare?', tag: 'r/economics', rank: 3 },
  { platform: 'reddit', title: 'Genetic Editing for Preventative Human Enhancement', tag: 'r/futurology', rank: 4 },
  { platform: 'reddit', title: 'The Ethical Line Between Virtual Reality Escapism and Real Living', tag: 'r/philosophy', rank: 5 },
];

const FALLBACK_FACEBOOK_TRENDS: SocialTrendItem[] = [
  { platform: 'facebook', title: 'Cell Phones and Social Media Bans in K-12 Classrooms', tag: '#EducationFirst', rank: 1 },
  { platform: 'facebook', title: 'Four-Day Work Week: Productivity Boost or Corporate Hazard?', tag: '#WorkLifeBalance', rank: 2 },
  { platform: 'facebook', title: 'Public Subsidies for Local Journalism and Independent Media', tag: '#CivicDebate', rank: 3 },
  { platform: 'facebook', title: 'Should College Degrees Still Be Required for Executive Careers?', tag: '#CareerPaths', rank: 4 },
  { platform: 'facebook', title: 'Age Limits on Youth Participation in Competitive Contact Sports', tag: '#YouthSports', rank: 5 },
];

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache duration

export class SocialTrendsService {
  private cachedStatus: SocialTrendsStatus | null = null;
  private cachedTopicItems: TopicItem[] = [];
  private fetchPromise: Promise<{ topics: TopicItem[]; status: SocialTrendsStatus }> | null = null;

  constructor() {
    // Initialize immediately with high-quality default trending topics
    this.initDefaultCache();
  }

  private initDefaultCache() {
    const now = Date.now();
    const xTrends = [...FALLBACK_X_TRENDS];
    const redditTrends = [...FALLBACK_REDDIT_TRENDS];
    const fbTrends = [...FALLBACK_FACEBOOK_TRENDS];

    const topTags = [
      '#AIAct',
      'r/technology',
      '#WorkLifeBalance',
      'r/science',
      '#CreatorEconomy',
      '#EducationFirst',
    ];

    this.cachedStatus = {
      lastFetchedAt: now,
      nextFetchDueAt: now + CACHE_TTL_MS,
      topTags,
      platformCounts: {
        x: xTrends.length,
        reddit: redditTrends.length,
        facebook: fbTrends.length,
      },
      trends: {
        x: xTrends,
        reddit: redditTrends,
        facebook: fbTrends,
      },
    };

    this.cachedTopicItems = this.buildTopicItems(xTrends, redditTrends, fbTrends);
  }

  private buildTopicItems(
    xTrends: SocialTrendItem[],
    redditTrends: SocialTrendItem[],
    fbTrends: SocialTrendItem[]
  ): TopicItem[] {
    const items: TopicItem[] = [];
    const all = [
      ...xTrends.map((t) => ({ ...t, platform: 'x' as SocialPlatform })),
      ...redditTrends.map((t) => ({ ...t, platform: 'reddit' as SocialPlatform })),
      ...fbTrends.map((t) => ({ ...t, platform: 'facebook' as SocialPlatform })),
    ];

    all.forEach((trend, idx) => {
      const id = `trend-${trend.platform}-${trend.rank}-${idx}`;
      items.push({
        id,
        title: trend.title,
        category: trend.platform.toUpperCase(),
        platform: trend.platform,
        trendTag: trend.tag,
        trendRank: trend.rank,
        createdAt: Date.now() - (15 - idx) * 60000,
        createdBy: `${trend.platform.toUpperCase()} Trending`,
        rowIndex: idx % 4, // Spread evenly across 4 topic stream lanes
      });
    });

    return items;
  }

  // Fetch real Reddit popular discussions
  private async fetchRealRedditTrends(): Promise<SocialTrendItem[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch('https://www.reddit.com/r/popular/hot.json?limit=25', {
        headers: {
          'User-Agent': 'SocraticAI-Dialectic/1.0 (Educational debate platform)',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Reddit HTTP error: ${res.status}`);
      }

      const json = await res.json();
      const children = json?.data?.children || [];

      const filtered: SocialTrendItem[] = [];
      const seenTitles = new Set<string>();

      for (const item of children) {
        const post = item.data;
        if (!post || post.over_18 || post.is_video || !post.title) continue;

        let title: string = post.title.trim();
        // Skip short memes or photo captions
        if (title.length < 25 || title.length > 120) continue;
        if (/^(TIL|ELI5|LPT|YSK|AskReddit|AITA):/i.test(title)) {
          title = title.replace(/^(TIL|ELI5|LPT|YSK|AskReddit|AITA):\s*/i, '');
        }

        const normalized = title.toLowerCase();
        if (seenTitles.has(normalized)) continue;
        seenTitles.add(normalized);

        const sub = `r/${post.subreddit || 'popular'}`;
        filtered.push({
          platform: 'reddit',
          title: title.charAt(0).toUpperCase() + title.slice(1),
          tag: sub,
          rank: filtered.length + 1,
        });

        if (filtered.length >= 5) break;
      }

      if (filtered.length >= 3) {
        return filtered;
      }
    } catch (err) {
      console.warn('Real Reddit fetch skipped (using fallback or AI):', (err as Error).message);
    }
    return FALLBACK_REDDIT_TRENDS;
  }

  // Fetch AI-curated trends for X, Reddit, and Facebook using Gemini
  private async fetchGeminiSocialTrends(): Promise<{
    x: SocialTrendItem[];
    reddit?: SocialTrendItem[];
    facebook: SocialTrendItem[];
    topTags: string[];
  }> {
    if (!apiKey) {
      return {
        x: FALLBACK_X_TRENDS,
        facebook: FALLBACK_FACEBOOK_TRENDS,
        topTags: ['#AIAct', 'r/technology', '#WorkLifeBalance', '#ClimatePolicy'],
      };
    }

    try {
      const prompt = `You are a social intelligence engine for an intellectual debate platform.
Identify the top 5 high-engagement debate topics/controversies trending on X (Twitter), and the top 5 viral discussion/debate topics trending on Facebook.
Ensure each title is phrased as a thought-provoking, balanced debate question or controversial motion suitable for two debaters.

Return STRICT JSON ONLY matching this format:
{
  "topTags": ["#Hashtag1", "#Hashtag2", "r/popular", "#Hashtag3"],
  "x": [
    { "title": "Topic title", "tag": "#Hashtag", "rank": 1 }
  ],
  "facebook": [
    { "title": "Topic title", "tag": "#Category", "rank": 1 }
  ]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.5,
        },
      });

      const raw = response.text || '{}';
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const data = JSON.parse(cleaned);

      const xTrends: SocialTrendItem[] = Array.isArray(data.x)
        ? data.x.slice(0, 5).map((item: any, i: number) => ({
            platform: 'x' as SocialPlatform,
            title: String(item.title || `Trending X Discussion #${i + 1}`).trim(),
            tag: item.tag ? String(item.tag).trim() : '#Trending',
            rank: i + 1,
          }))
        : FALLBACK_X_TRENDS;

      const fbTrends: SocialTrendItem[] = Array.isArray(data.facebook)
        ? data.facebook.slice(0, 5).map((item: any, i: number) => ({
            platform: 'facebook' as SocialPlatform,
            title: String(item.title || `Viral Facebook Debate #${i + 1}`).trim(),
            tag: item.tag ? String(item.tag).trim() : '#FacebookViral',
            rank: i + 1,
          }))
        : FALLBACK_FACEBOOK_TRENDS;

      const topTags: string[] = Array.isArray(data.topTags) && data.topTags.length > 0
        ? data.topTags.slice(0, 8)
        : ['#AI', '#TechEthics', 'r/popular', '#Workplace', '#SocialPolicy'];

      return {
        x: xTrends.length === 5 ? xTrends : FALLBACK_X_TRENDS,
        facebook: fbTrends.length === 5 ? fbTrends : FALLBACK_FACEBOOK_TRENDS,
        topTags,
      };
    } catch (err) {
      console.warn('Gemini social trends generation fallback:', (err as Error).message);
      return {
        x: FALLBACK_X_TRENDS,
        facebook: FALLBACK_FACEBOOK_TRENDS,
        topTags: ['#AIAct', 'r/technology', '#WorkLifeBalance', '#ClimatePolicy'],
      };
    }
  }

  // Authoritative getTrends method with 1-hour in-memory caching
  public async getTrends(forceRefresh = false): Promise<{
    topics: TopicItem[];
    status: SocialTrendsStatus;
  }> {
    const now = Date.now();

    // Check if valid cache exists and is within 1 hour TTL
    if (
      !forceRefresh &&
      this.cachedStatus &&
      this.cachedTopicItems.length > 0 &&
      now - this.cachedStatus.lastFetchedAt < CACHE_TTL_MS
    ) {
      return {
        topics: this.cachedTopicItems,
        status: this.cachedStatus,
      };
    }

    // Coalesce concurrent calls into a single fetch execution
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = (async () => {
      try {
        // Fetch Reddit trends and Gemini trends in parallel
        const [redditTrends, geminiTrends] = await Promise.all([
          this.fetchRealRedditTrends(),
          this.fetchGeminiSocialTrends(),
        ]);

        const xTrends = geminiTrends.x && geminiTrends.x.length > 0 ? geminiTrends.x : FALLBACK_X_TRENDS;
        const fbTrends = geminiTrends.facebook && geminiTrends.facebook.length > 0 ? geminiTrends.facebook : FALLBACK_FACEBOOK_TRENDS;
        const finalReddit = redditTrends.length > 0 ? redditTrends : FALLBACK_REDDIT_TRENDS;

        const combinedTags = Array.from(
          new Set([
            ...geminiTrends.topTags,
            ...finalReddit.map((r) => r.tag || 'r/popular'),
            ...xTrends.map((x) => x.tag || '#X'),
            ...fbTrends.map((f) => f.tag || '#Facebook'),
          ])
        ).slice(0, 8);

        const newStatus: SocialTrendsStatus = {
          lastFetchedAt: Date.now(),
          nextFetchDueAt: Date.now() + CACHE_TTL_MS,
          topTags: combinedTags,
          platformCounts: {
            x: xTrends.length,
            reddit: finalReddit.length,
            facebook: fbTrends.length,
          },
          trends: {
            x: xTrends,
            reddit: finalReddit,
            facebook: fbTrends,
          },
        };

        const newTopics = this.buildTopicItems(xTrends, finalReddit, fbTrends);

        this.cachedStatus = newStatus;
        this.cachedTopicItems = newTopics;

        return {
          topics: newTopics,
          status: newStatus,
        };
      } catch (err) {
        console.error('Error fetching social trends:', err);
        // Fall back gracefully to existing cache
        if (!this.cachedStatus) {
          this.initDefaultCache();
        }
        return {
          topics: this.cachedTopicItems,
          status: this.cachedStatus!,
        };
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  public getCachedStatus(): SocialTrendsStatus | null {
    return this.cachedStatus;
  }

  public getCachedTopics(): TopicItem[] {
    return this.cachedTopicItems;
  }
}

export const socialTrendsService = new SocialTrendsService();
