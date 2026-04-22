const LIMITS = {
  bodyChars: 8000,
  reviews: 12,
  reviewTextChars: 320,
};

function cleanText(value) {
  if (!value) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function pickText(selectors) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    const text = cleanText(node?.textContent || node?.innerText);
    if (text) return text;
  }
  return "";
}

function pickMeta(keys) {
  for (const key of keys) {
    const node =
      document.querySelector(`meta[property="${key}"]`) ||
      document.querySelector(`meta[name="${key}"]`) ||
      document.querySelector(`meta[itemprop="${key}"]`);
    const content = cleanText(node?.getAttribute("content"));
    if (content) return content;
  }
  return "";
}

function parsePrice(value) {
  if (!value) return null;
  const normalized = String(value).replace(/,/g, "");
  const match = normalized.match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function parseJsonLdProducts() {
  const scripts = Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  );
  const products = [];

  for (const script of scripts) {
    try {
      const raw = script.textContent?.trim();
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const item = stack.pop();
        if (!item || typeof item !== "object") continue;
        if (Array.isArray(item)) {
          stack.push(...item);
          continue;
        }
        if (item["@graph"] && Array.isArray(item["@graph"])) {
          stack.push(...item["@graph"]);
        }
        const type = item["@type"];
        const typeList = Array.isArray(type) ? type : [type];
        if (typeList.includes("Product")) {
          products.push(item);
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return products;
}

function toReviewObject(review) {
  const author =
    cleanText(review?.author?.name || review?.author) || "Anonymous";
  const ratingValue = Number(review?.reviewRating?.ratingValue || 0) || null;
  const title = cleanText(review?.name || "");
  const body = cleanText(review?.reviewBody || "");
  const date = cleanText(review?.datePublished || "");

  return {
    author,
    rating: ratingValue,
    title: title.slice(0, 120),
    text: body.slice(0, LIMITS.reviewTextChars),
    date,
    source: "json_ld",
  };
}

function extractReviewsFromDom() {
  const reviewNodes = Array.from(
    document.querySelectorAll(
      '[data-review-id], [itemprop="review"], .review, [class*="review"]',
    ),
  ).slice(0, LIMITS.reviews * 2);

  const reviews = [];
  for (const node of reviewNodes) {
    const text = cleanText(node.textContent).slice(0, LIMITS.reviewTextChars);
    if (!text || text.length < 40) continue;
    const ratingText = cleanText(
      node.querySelector('[aria-label*="out of"], [class*="rating"]')
        ?.textContent,
    );
    const rating = parsePrice(ratingText);
    reviews.push({
      author: cleanText(
        node.querySelector('[class*="author"], [itemprop="author"]')
          ?.textContent,
      ),
      rating: rating && rating <= 5 ? rating : null,
      title: cleanText(
        node.querySelector('h3, h4, [class*="title"]')?.textContent,
      ).slice(0, 120),
      text,
      date: cleanText(
        node.querySelector("time, [class*='date']")?.textContent,
      ),
      source: "dom",
    });
    if (reviews.length >= LIMITS.reviews) break;
  }

  return reviews;
}

function getCanonicalUrl() {
  const canonicalNode = document.querySelector('link[rel="canonical"]');
  return cleanText(canonicalNode?.href || window.location.href);
}

function inferProductType(title, breadcrumbs = []) {
  const corpus = `${title} ${breadcrumbs.join(" ")}`.toLowerCase();
  const groups = [
    ["laptop", "notebook", "macbook", "chromebook", "ultrabook"],
    ["shirt", "t-shirt", "hoodie", "jeans", "dress", "jacket"],
    ["phone", "smartphone", "iphone", "android", "mobile"],
    ["headphone", "earbud", "speaker", "soundbar"],
    ["tv", "television", "monitor", "display"],
    ["furniture", "chair", "table", "sofa", "bed"],
  ];
  const labels = [
    "laptop",
    "apparel",
    "phone",
    "audio",
    "display",
    "furniture",
  ];
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i].some((keyword) => corpus.includes(keyword))) {
      return labels[i];
    }
  }
  return "unknown";
}

function extractProductData() {
  const jsonLdProducts = parseJsonLdProducts();
  const primaryJsonLd = jsonLdProducts[0] || {};

  const title =
    cleanText(primaryJsonLd?.name) ||
    pickMeta(["og:title", "twitter:title"]) ||
    cleanText(document.title);

  const breadcrumbs = Array.from(
    document.querySelectorAll("nav a, [aria-label*='breadcrumb'] a"),
  )
    .map((node) => cleanText(node.textContent))
    .filter(Boolean)
    .slice(0, 8);

  const offer = Array.isArray(primaryJsonLd?.offers)
    ? primaryJsonLd.offers[0]
    : primaryJsonLd?.offers || {};
  const jsonLdPrice = offer?.price || primaryJsonLd?.offers?.price;
  const priceText =
    String(jsonLdPrice || "") ||
    pickText([
      '[itemprop="price"]',
      '[class*="price"]',
      '[data-test*="price"]',
      '[data-testid*="price"]',
    ]);
  const priceValue = parsePrice(priceText);
  const currency =
    cleanText(offer?.priceCurrency) ||
    pickMeta(["product:price:currency", "currency"]) ||
    (priceText.includes("$")
      ? "USD"
      : priceText.includes("₹")
        ? "INR"
        : priceText.includes("€")
          ? "EUR"
          : "");

  const ratingValue =
    Number(primaryJsonLd?.aggregateRating?.ratingValue || 0) ||
    parsePrice(
      pickText([
        '[itemprop="ratingValue"]',
        '[class*="rating"]',
        '[aria-label*="out of 5"]',
      ]),
    ) ||
    null;
  const ratingCount =
    Number(primaryJsonLd?.aggregateRating?.reviewCount || 0) || null;

  const jsonLdReviews = Array.isArray(primaryJsonLd?.review)
    ? primaryJsonLd.review
    : primaryJsonLd?.review
      ? [primaryJsonLd.review]
      : [];
  const reviews = [
    ...jsonLdReviews.map(toReviewObject),
    ...extractReviewsFromDom(),
  ]
    .filter((item) => item.text || item.title)
    .slice(0, LIMITS.reviews);

  return {
    title,
    url: window.location.href,
    canonicalUrl: getCanonicalUrl(),
    domain: window.location.hostname,
    productTypeHint: inferProductType(title, breadcrumbs),
    brand:
      cleanText(primaryJsonLd?.brand?.name || primaryJsonLd?.brand) ||
      pickMeta(["product:brand", "brand"]),
    seller:
      cleanText(offer?.seller?.name || offer?.seller) ||
      pickText(['[class*="seller"]', '[data-testid*="seller"]']),
    availability:
      cleanText(offer?.availability || "") ||
      pickText(['[class*="stock"]', '[class*="availability"]']),
    price: priceValue,
    priceText: cleanText(priceText),
    currency,
    rating: ratingValue,
    ratingCount,
    breadcrumbs,
    reviews,
    content: cleanText(document.body?.innerText).slice(0, LIMITS.bodyChars),
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_PAGE_DATA") {
    sendResponse(extractProductData());
  }
});
