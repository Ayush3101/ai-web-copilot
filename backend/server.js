import express from "express";
import cors from "cors";
import OpenAI from "openai";
import axios from "axios";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5001;
const MODEL = "llama-3.1-8b-instant";
const CACHE_TTL_MS = 5 * 60 * 1000;
const requestCache = new Map();
const priceTimeline = new Map();

const PROVIDER_CONFIG = {
  pricesApi: {
    key: process.env.PRICESAPI_KEY || "",
    baseUrl: process.env.PRICESAPI_BASE_URL || "https://api.pricesapi.io/api/v1",
    country: (process.env.PRICESAPI_COUNTRY || "in").toLowerCase(),
    timeoutMs: Number(process.env.PRICESAPI_TIMEOUT_MS || 14000),
  },
  couponFeed: {
    key: process.env.COUPONAPI_KEY || "",
    endpoint: process.env.COUPONAPI_ENDPOINT || "",
    authHeader: process.env.COUPONAPI_AUTH_HEADER || "x-api-key",
    timeoutMs: Number(process.env.COUPONAPI_TIMEOUT_MS || 12000),
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCacheKey(pageData) {
  return JSON.stringify({
    url: pageData?.canonicalUrl || pageData?.url || "",
    title: pageData?.title || "",
    price: pageData?.price || null,
  });
}

function readCache(cacheKey) {
  const hit = requestCache.get(cacheKey);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    requestCache.delete(cacheKey);
    return null;
  }
  return hit.value;
}

function writeCache(cacheKey, value) {
  requestCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function normalizeText(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function detectProductType(pageData) {
  const source = `${pageData?.title || ""} ${pageData?.breadcrumbs?.join(" ") || ""} ${pageData?.productTypeHint || ""}`.toLowerCase();
  const map = [
    { label: "laptop", keywords: ["laptop", "notebook", "ultrabook"] },
    { label: "apparel", keywords: ["shirt", "t-shirt", "hoodie", "dress", "jeans", "jacket"] },
    { label: "phone", keywords: ["phone", "smartphone", "iphone", "android"] },
    { label: "audio", keywords: ["headphone", "earbud", "speaker"] },
    { label: "display", keywords: ["monitor", "tv", "television"] },
    { label: "furniture", keywords: ["chair", "table", "sofa", "bed"] },
  ];
  for (const item of map) {
    if (item.keywords.some((keyword) => source.includes(keyword))) {
      return item.label;
    }
  }
  return "general";
}

function getProductIdentity(pageData = {}) {
  const title = normalizeText(pageData.title);
  const brand = normalizeText(pageData.brand);
  const breadcrumbs = Array.isArray(pageData.breadcrumbs)
    ? pageData.breadcrumbs.map(normalizeText).filter(Boolean)
    : [];
  const query = [brand, title, breadcrumbs[breadcrumbs.length - 1]]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    title,
    brand,
    query: query || title || "product",
    canonicalUrl: normalizeText(pageData.canonicalUrl || pageData.url),
    domain: normalizeText(pageData.domain),
    currency: normalizeText(pageData.currency),
    currentPrice: Number(pageData.price || 0) || null,
  };
}

function computeReviewFeatures(reviews = []) {
  const validReviews = reviews.filter((r) => normalizeText(r?.text).length > 0);
  if (!validReviews.length) {
    return {
      reviewCount: 0,
      repetitiveRatio: 0,
      veryShortRatio: 1,
      extremeOnlyRatio: 0,
      suspiciousScore: 0.55,
      duplicatePhraseSignals: [],
    };
  }

  const normalizedBodies = validReviews.map((r) =>
    normalizeText(r.text).toLowerCase(),
  );
  const duplicates = new Set();
  const snippetCounts = {};
  for (const body of normalizedBodies) {
    const snippet = body.slice(0, 90);
    if (!snippet) continue;
    snippetCounts[snippet] = (snippetCounts[snippet] || 0) + 1;
    if (snippetCounts[snippet] > 1) duplicates.add(snippet);
  }

  let veryShortCount = 0;
  let extremeOnlyCount = 0;
  for (const r of validReviews) {
    const text = normalizeText(r.text).toLowerCase();
    if (text.length < 45) veryShortCount += 1;
    const rating = Number(r.rating || 0);
    const hasDetailSignal =
      /because|however|but|quality|build|battery|material|size|delivery|performance|value/i.test(
        text,
      );
    if ((rating >= 5 || rating <= 1) && !hasDetailSignal) extremeOnlyCount += 1;
  }

  const repetitiveRatio = duplicates.size / validReviews.length;
  const veryShortRatio = veryShortCount / validReviews.length;
  const extremeOnlyRatio = extremeOnlyCount / validReviews.length;
  const suspiciousScore = clamp(
    0.2 + repetitiveRatio * 0.45 + veryShortRatio * 0.2 + extremeOnlyRatio * 0.3,
    0,
    1,
  );

  return {
    reviewCount: validReviews.length,
    repetitiveRatio: Number(repetitiveRatio.toFixed(2)),
    veryShortRatio: Number(veryShortRatio.toFixed(2)),
    extremeOnlyRatio: Number(extremeOnlyRatio.toFixed(2)),
    suspiciousScore: Number(suspiciousScore.toFixed(2)),
    duplicatePhraseSignals: Array.from(duplicates).slice(0, 3),
  };
}

async function withTimeout(promise, timeoutMs, message) {
  return await Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs),
    ),
  ]);
}

async function withRetries(task, retries = 1) {
  let lastError;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function similarityScore(a, b) {
  const aTokens = new Set(
    normalizeText(a)
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length > 2),
  );
  const bTokens = new Set(
    normalizeText(b)
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length > 2),
  );
  if (!aTokens.size || !bTokens.size) return 0;
  let matches = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) matches += 1;
  }
  return matches / Math.max(aTokens.size, bTokens.size);
}

function recordPricePoint(cacheKey, currentPrice) {
  if (!(typeof currentPrice === "number" && currentPrice > 0)) return;
  const existing = priceTimeline.get(cacheKey) || [];
  const next = [...existing, { ts: Date.now(), price: currentPrice }].slice(-20);
  priceTimeline.set(cacheKey, next);
}

function buildTrendSignal(cacheKey) {
  const history = priceTimeline.get(cacheKey) || [];
  if (history.length < 3) {
    return {
      state: "insufficient_data",
      confidence: 0.25,
      message: "Not enough historical observations yet for this page.",
    };
  }

  const first = history[0]?.price || 0;
  const last = history[history.length - 1]?.price || 0;
  if (!(first > 0 && last > 0)) {
    return {
      state: "insufficient_data",
      confidence: 0.25,
      message: "Historical price points are incomplete.",
    };
  }

  const deltaPct = ((last - first) / first) * 100;
  if (deltaPct <= -3) {
    return {
      state: "likely_drop_soon",
      confidence: clamp(history.length / 12, 0.35, 0.78),
      message: "Observed local trend indicates recent downward movement.",
    };
  }
  if (deltaPct >= 3) {
    return {
      state: "likely_rise",
      confidence: clamp(history.length / 12, 0.35, 0.78),
      message: "Observed local trend indicates recent upward movement.",
    };
  }
  return {
    state: "stable",
    confidence: clamp(history.length / 12, 0.35, 0.78),
    message: "Observed local trend appears relatively stable.",
  };
}

async function fetchPricesApiData(identity) {
  if (!PROVIDER_CONFIG.pricesApi.key) {
    return {
      platformPrices: [],
      trendSignal: {
        state: "insufficient_data",
        confidence: 0.2,
        message: "PricesAPI key not configured.",
      },
      coupons: [],
      sourceNotes: ["PricesAPI integration disabled (missing PRICESAPI_KEY)."],
    };
  }

  try {
    const searchResponse = await withTimeout(
      axios.get(`${PROVIDER_CONFIG.pricesApi.baseUrl}/products/search`, {
        params: {
          q: identity.query,
          limit: 5,
        },
        headers: {
          "x-api-key": PROVIDER_CONFIG.pricesApi.key,
        },
        timeout: PROVIDER_CONFIG.pricesApi.timeoutMs,
      }),
      PROVIDER_CONFIG.pricesApi.timeoutMs + 500,
      "PricesAPI search timed out.",
    );

    const results = searchResponse?.data?.data?.results || [];
    if (!Array.isArray(results) || !results.length) {
      return {
        platformPrices: [],
        trendSignal: {
          state: "insufficient_data",
          confidence: 0.25,
          message: "PricesAPI returned no matching products.",
        },
        coupons: [],
        sourceNotes: ["No matching product found in PricesAPI search."],
      };
    }

    const ranked = results
      .map((item) => ({
        ...item,
        score: similarityScore(identity.title, item?.title || ""),
      }))
      .sort((a, b) => b.score - a.score);
    const winner = ranked[0];
    if (!winner?.id) {
      return {
        platformPrices: [],
        trendSignal: {
          state: "insufficient_data",
          confidence: 0.25,
          message: "Could not identify a reliable product ID from PricesAPI.",
        },
        coupons: [],
        sourceNotes: ["PricesAPI result had no usable product ID."],
      };
    }

    const offersResponse = await withTimeout(
      axios.get(`${PROVIDER_CONFIG.pricesApi.baseUrl}/products/${winner.id}/offers`, {
        params: {
          country: PROVIDER_CONFIG.pricesApi.country,
        },
        headers: {
          "x-api-key": PROVIDER_CONFIG.pricesApi.key,
        },
        timeout: PROVIDER_CONFIG.pricesApi.timeoutMs,
      }),
      PROVIDER_CONFIG.pricesApi.timeoutMs + 500,
      "PricesAPI offers request timed out.",
    );

    const offers = offersResponse?.data?.data?.offers || [];
    const platformPrices = Array.isArray(offers)
      ? offers
          .filter((offer) => typeof offer?.price === "number" && offer.price > 0)
          .map((offer) => ({
            platform: normalizeText(offer?.seller || "Unknown seller"),
            price: Number(offer.price),
            currency: normalizeText(offer?.currency || identity.currency || "USD"),
            productUrl: normalizeText(offer?.url || offer?.seller_url || ""),
            confidence: clamp(0.58 + similarityScore(identity.title, offer?.productTitle || "") * 0.35, 0.45, 0.95),
            source: "api",
          }))
          .slice(0, 10)
      : [];

    return {
      platformPrices,
      trendSignal: {
        state: "insufficient_data",
        confidence: 0.3,
        message: "External trend unavailable from PricesAPI; using local observations.",
      },
      coupons: [],
      sourceNotes: [
        `PricesAPI matched product "${normalizeText(winner.title)}" (score ${winner.score.toFixed(2)}).`,
      ],
    };
  } catch (error) {
    const message =
      error?.response?.data?.error?.message || error?.message || "Unknown PricesAPI error";
    return {
      platformPrices: [],
      trendSignal: {
        state: "insufficient_data",
        confidence: 0.2,
        message: "PricesAPI request failed.",
      },
      coupons: [],
      sourceNotes: [`PricesAPI error: ${message}`],
    };
  }
}

function mapCouponRecord(record, currentPrice) {
  const code = normalizeText(record?.code || record?.coupon || record?.coupon_code);
  if (!code) return null;
  const title = normalizeText(record?.title || record?.description);
  const savingsType = normalizeText(record?.type || record?.discount_type || "deal").toLowerCase();
  const numericValue =
    Number(record?.value || record?.discount || record?.discount_value || 0) || 0;

  const estimatedSavings =
    savingsType.includes("percent") && currentPrice
      ? Number((currentPrice * (numericValue / 100)).toFixed(2))
      : numericValue;

  return {
    code,
    savingsType,
    value: numericValue,
    estimatedSavings: estimatedSavings > 0 ? estimatedSavings : 0,
    confidence: clamp(
      (record?.status === "new" ? 0.68 : 0.55) + (record?.end_date ? 0.08 : 0),
      0.35,
      0.9,
    ),
    terms:
      normalizeText(record?.terms || record?.description) ||
      title ||
      "Verify terms at checkout.",
    source: "api",
  };
}

async function fetchCouponApiData(identity) {
  if (!PROVIDER_CONFIG.couponFeed.endpoint) {
    return {
      platformPrices: [],
      coupons: [],
      scrapeNote: "Coupon feed endpoint is not configured.",
    };
  }

  const headers = {};
  if (PROVIDER_CONFIG.couponFeed.key) {
    headers[PROVIDER_CONFIG.couponFeed.authHeader] = PROVIDER_CONFIG.couponFeed.key;
  }

  try {
    const response = await withTimeout(
      axios.get(PROVIDER_CONFIG.couponFeed.endpoint, {
        params: {
          q: identity.query,
          store: identity.domain,
          title: identity.title,
        },
        headers,
        timeout: PROVIDER_CONFIG.couponFeed.timeoutMs,
      }),
      PROVIDER_CONFIG.couponFeed.timeoutMs + 500,
      "Coupon feed request timed out.",
    );

    const payload = response?.data;
    const records = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.offers)
          ? payload.offers
          : [];

    const coupons = records
      .map((record) => mapCouponRecord(record, identity.currentPrice))
      .filter(Boolean)
      .slice(0, 10);

    return {
      platformPrices: [],
      coupons,
      scrapeNote: coupons.length
        ? "Coupons fetched from configured coupon feed endpoint."
        : "Coupon feed returned no matching coupons.",
    };
  } catch (error) {
    const message =
      error?.response?.data?.error?.message || error?.message || "Unknown coupon API error";
    return {
      platformPrices: [],
      coupons: [],
      scrapeNote: `Coupon provider error: ${message}`,
    };
  }
}

function buildStructuredPrompt({ query, pageData, productType, reviewFeatures }) {
  const reviewSample = (pageData?.reviews || []).slice(0, 8).map((r, idx) => ({
    index: idx + 1,
    rating: r.rating ?? null,
    title: r.title || "",
    text: r.text || "",
    date: r.date || "",
  }));

  return `
You are a shopping intelligence assistant. Output only valid JSON.

Required JSON schema:
{
  "productType": "string",
  "topPros": ["string"],
  "topCons": ["string"],
  "credibilitySummary": {
    "genuineLikely": "number from 0 to 1",
    "suspiciousLikely": "number from 0 to 1",
    "confidence": "number from 0 to 1",
    "reasons": ["string"]
  },
  "recommendation": {
    "decision": "buy|wait|avoid",
    "rationale": "string"
  }
}

Rules:
- If evidence is weak, lower confidence and mention uncertainty.
- Keep pros/cons concise and concrete.
- Never invent review facts not implied by given data.
- recommendation.decision must be one of buy, wait, avoid.

User question/context: ${normalizeText(query) || "Analyze this product page."}
Detected type hint: ${productType}
Page title: ${normalizeText(pageData?.title)}
Price text: ${normalizeText(pageData?.priceText)}
Brand: ${normalizeText(pageData?.brand)}
Seller: ${normalizeText(pageData?.seller)}
Availability: ${normalizeText(pageData?.availability)}
Rating: ${pageData?.rating ?? "unknown"}
Rating count: ${pageData?.ratingCount ?? "unknown"}
Review heuristics: ${JSON.stringify(reviewFeatures)}
Review sample: ${JSON.stringify(reviewSample)}
Body text sample: ${normalizeText(pageData?.content).slice(0, 2800)}
  `;
}

function safeParseJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

function sanitizeAnalysis(raw, fallbackType, reviewFeatures) {
  const credibility = raw?.credibilitySummary || {};
  const suspiciousLikely = clamp(
    Number(credibility.suspiciousLikely ?? reviewFeatures.suspiciousScore ?? 0.5),
    0,
    1,
  );
  const genuineLikely = clamp(
    Number(credibility.genuineLikely ?? 1 - suspiciousLikely),
    0,
    1,
  );
  const confidence = clamp(Number(credibility.confidence ?? 0.55), 0.1, 1);
  const decisionRaw = String(raw?.recommendation?.decision || "wait").toLowerCase();
  const decision = ["buy", "wait", "avoid"].includes(decisionRaw)
    ? decisionRaw
    : "wait";

  return {
    productType: String(raw?.productType || fallbackType || "general"),
    topPros: Array.isArray(raw?.topPros) ? raw.topPros.slice(0, 5) : [],
    topCons: Array.isArray(raw?.topCons) ? raw.topCons.slice(0, 5) : [],
    credibilitySummary: {
      genuineLikely: Number(genuineLikely.toFixed(2)),
      suspiciousLikely: Number(suspiciousLikely.toFixed(2)),
      confidence: Number(confidence.toFixed(2)),
      reasons: Array.isArray(credibility.reasons) ? credibility.reasons.slice(0, 5) : [],
      heuristicSignals: reviewFeatures,
    },
    recommendation: {
      decision,
      rationale:
        normalizeText(raw?.recommendation?.rationale) ||
        "Evidence is mixed. Consider your budget and return policy before purchasing.",
    },
  };
}

async function callAiStructured(client, params) {
  const prompt = buildStructuredPrompt(params);
  const completion = await withRetries(
    () =>
      withTimeout(
        client.chat.completions.create({
          model: MODEL,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: "You are strict about returning valid JSON only.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
        16000,
        "Timed out while requesting AI analysis.",
      ),
    1,
  );

  const content = completion.choices?.[0]?.message?.content || "";
  return safeParseJson(content);
}

function mergePriceAndCoupons(apiData, scrapeData, currentPrice) {
  const prices = [...(apiData.platformPrices || []), ...(scrapeData.platformPrices || [])]
    .filter((item) => typeof item.price === "number" && item.price > 0)
    .sort((a, b) => a.price - b.price)
    .slice(0, 6);
  const coupons = [...(apiData.coupons || []), ...(scrapeData.coupons || [])]
    .sort((a, b) => (b.estimatedSavings || 0) - (a.estimatedSavings || 0))
    .slice(0, 6);

  const bestExternal = prices[0] || null;
  const hasCurrentPrice = typeof currentPrice === "number" && currentPrice > 0;
  const lowerElsewhere = hasCurrentPrice && bestExternal
    ? bestExternal.price < currentPrice
    : false;

  const trendState = apiData.trendSignal?.state;
  const bestActionNow = lowerElsewhere
    ? "buy_now_elsewhere"
    : trendState === "likely_drop_soon"
      ? "wait"
      : "buy_now";
  const reason = lowerElsewhere
    ? `A lower observed price was found on ${bestExternal.platform}.`
    : bestActionNow === "wait"
      ? "Price trend signal suggests potential short-term discount."
      : "No meaningfully cheaper reliable offer detected.";

  return {
    alternativePlatformPrices: prices,
    currentSitePriceTrendSignal: apiData.trendSignal || {
      state: "insufficient_data",
      confidence: 0.3,
      message: "Trend unavailable.",
    },
    bestActionNow: {
      action: bestActionNow,
      reason,
    },
    coupons: coupons.filter((coupon) => (coupon.confidence || 0) >= 0.5),
    sourceNotes: [...(apiData.sourceNotes || []), scrapeData.scrapeNote].filter(Boolean),
  };
}

app.post("/analyze", async (req, res) => {
  const { query, pageData = {} } = req.body;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Backend is missing GROQ_API_KEY.",
    });
  }

  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });

  try {
    const cacheKey = getCacheKey(pageData);
    recordPricePoint(cacheKey, Number(pageData?.price || 0));
    const cacheHit = readCache(cacheKey);
    if (cacheHit) {
      return res.json({ ...cacheHit, cache: "hit" });
    }

    const productType = detectProductType(pageData);
    const reviewFeatures = computeReviewFeatures(pageData?.reviews || []);
    const aiJson = await callAiStructured(client, {
      query,
      pageData,
      productType,
      reviewFeatures,
    });
    const analysis = sanitizeAnalysis(aiJson, productType, reviewFeatures);
    const identity = getProductIdentity(pageData);
    const [apiData, couponData] = await Promise.all([
      fetchPricesApiData(identity),
      fetchCouponApiData(identity),
    ]);
    const scrapeData = {
      platformPrices: couponData.platformPrices || [],
      coupons: couponData.coupons || [],
      scrapeNote: couponData.scrapeNote || "",
    };
    apiData.trendSignal =
      apiData.trendSignal?.state === "insufficient_data"
        ? buildTrendSignal(cacheKey)
        : apiData.trendSignal;
    const market = mergePriceAndCoupons(apiData, scrapeData, Number(pageData?.price));
    const payload = {
      status: "ok",
      analyzedAt: new Date().toISOString(),
      productSnapshot: {
        title: normalizeText(pageData?.title),
        url: normalizeText(pageData?.url),
        canonicalUrl: normalizeText(pageData?.canonicalUrl),
        domain: normalizeText(pageData?.domain),
        brand: normalizeText(pageData?.brand),
        seller: normalizeText(pageData?.seller),
        price: pageData?.price ?? null,
        priceText: normalizeText(pageData?.priceText),
        currency: normalizeText(pageData?.currency),
        rating: pageData?.rating ?? null,
        ratingCount: pageData?.ratingCount ?? null,
        availability: normalizeText(pageData?.availability),
      },
      analysis,
      market,
      dataDisclosure:
        "Analysis uses visible product page content and sampled review text only.",
    };
    writeCache(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    const message = err?.error?.message || err?.message || "Error fetching AI response";
    console.error("Groq analyze error:", message);
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));