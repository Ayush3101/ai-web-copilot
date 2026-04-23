/// <reference types="chrome" />
import { useCallback, useEffect, useMemo, useState } from "react";

type PageData = {
  title: string;
  url: string;
  canonicalUrl?: string;
  domain?: string;
  productTypeHint?: string;
  brand?: string;
  seller?: string;
  availability?: string;
  price?: number | null;
  priceText?: string;
  currency?: string;
  rating?: number | null;
  ratingCount?: number | null;
  breadcrumbs?: string[];
  content?: string;
  reviews?: Array<{
    author?: string;
    rating?: number | null;
    title?: string;
    text?: string;
    date?: string;
    source?: string;
  }>;
};

type AnalysisResponse = {
  status: "ok";
  analyzedAt: string;
  productSnapshot: {
    title: string;
    url: string;
    canonicalUrl?: string;
    domain?: string;
    brand?: string;
    seller?: string;
    price?: number | null;
    priceText?: string;
    currency?: string;
    rating?: number | null;
    ratingCount?: number | null;
    availability?: string;
  };
  analysis: {
    productType: string;
    topPros: string[];
    topCons: string[];
    credibilitySummary: {
      genuineLikely: number;
      suspiciousLikely: number;
      confidence: number;
      reasons: string[];
    };
    recommendation: {
      decision: "buy" | "wait" | "avoid";
      rationale: string;
    };
  };
  market: {
    alternativePlatformPrices: Array<{
      platform: string;
      price: number;
      currency: string;
      productUrl: string;
      confidence: number;
      source: string;
    }>;
    currentSitePriceTrendSignal: {
      state: string;
      confidence: number;
      message: string;
    };
    bestActionNow: {
      action: string;
      reason: string;
    };
    coupons: Array<{
      code: string;
      savingsType: string;
      value: number;
      estimatedSavings: number;
      confidence: number;
      terms: string;
      source: string;
    }>;
    sourceNotes?: string[];
  };
  dataDisclosure: string;
};

type LoadStage = "idle" | "analyzing" | "pricing" | "done" | "error";

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function App() {
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [stage, setStage] = useState<LoadStage>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (
      typeof chrome === "undefined" ||
      !chrome.tabs?.query ||
      !chrome.tabs?.sendMessage
    ) {
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;

      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "GET_PAGE_DATA" },
        (response: PageData | undefined) => {
          if (chrome.runtime.lastError) {
            console.error("Error:", chrome.runtime.lastError.message);
            return;
          }

          if (response) setPageData(response);
        },
      );
    });
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!pageData) return;
    setStage("analyzing");
    setErrorMessage("");
    setAnalysis(null);

    try {
      const res = await fetch("http://localhost:5001/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "Analyze this product page for a buy decision.",
          pageData,
        }),
      });
      if (!res.ok) {
        const bad = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(bad.error || "Server request failed.");
      }
      setStage("pricing");

      const data = (await res.json()) as AnalysisResponse;
      setAnalysis(data);
      setStage("done");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Error fetching response",
      );
      setStage("error");
    } finally {
      if (stage !== "error") {
        setTimeout(() => {
          setStage((current) => (current === "pricing" ? "done" : current));
        }, 250);
      }
    }
  }, [pageData, stage]);

  const trustScore = useMemo(() => {
    if (!analysis) return 0;
    return Math.round(analysis.analysis.credibilitySummary.genuineLikely * 100);
  }, [analysis]);

  const loadingText =
    stage === "analyzing"
      ? "Analyzing product and reviews..."
      : stage === "pricing"
        ? "Checking price options and coupons..."
        : "";

  return (
    <div className="flex h-full min-h-0 w-full min-w-[360px] max-w-[400px] flex-1 flex-col bg-slate-950 text-slate-100 antialiased">
      <header className="shrink-0 border-b border-slate-800/90 bg-slate-900/95 px-4 py-3.5 backdrop-blur-sm">
        <h1 className="text-[17px] font-semibold leading-tight tracking-tight text-white">
          AI Web Copilot
        </h1>
        {pageData?.title ? (
          <p
            className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-slate-400"
            title={pageData.title}
          >
            {pageData.title}
          </p>
        ) : (
          <p className="mt-1.5 text-[13px] leading-snug text-slate-500">
            Unable to read page — refresh the tab and reopen the popup.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
          <p className="text-[12px] text-slate-400">Product Snapshot</p>
          <p className="mt-1 text-[14px] font-medium text-white">
            {analysis?.productSnapshot.title || pageData?.title || "Unknown product"}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] text-slate-300">
            <p>
              Price:{" "}
              {analysis?.productSnapshot.priceText ||
                pageData?.priceText ||
                "Not visible"}
            </p>
            <p>
              Rating:{" "}
              {analysis?.productSnapshot.rating
                ? `${analysis.productSnapshot.rating}/5`
                : "Unknown"}
            </p>
            <p>Brand: {analysis?.productSnapshot.brand || pageData?.brand || "-"}</p>
            <p>Seller: {analysis?.productSnapshot.seller || pageData?.seller || "-"}</p>
          </div>
        </div>

        {loadingText ? (
          <div className="rounded-lg border border-indigo-700/40 bg-indigo-950/40 p-3 text-[13px] text-indigo-200">
            {loadingText}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/50 p-3 text-[13px] text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        {analysis ? (
          <>
            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[12px] text-slate-400">Pros & Cons Summary</p>
              <div className="mt-2 grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <p className="font-semibold text-emerald-300">Pros</p>
                  <ul className="mt-1 space-y-1 text-slate-200">
                    {analysis.analysis.topPros.length ? (
                      analysis.analysis.topPros.map((item) => (
                        <li key={item}>+ {item}</li>
                      ))
                    ) : (
                      <li>No strong positives found.</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="font-semibold text-rose-300">Cons</p>
                  <ul className="mt-1 space-y-1 text-slate-200">
                    {analysis.analysis.topCons.length ? (
                      analysis.analysis.topCons.map((item) => (
                        <li key={item}>- {item}</li>
                      ))
                    ) : (
                      <li>No major negatives found.</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[12px] text-slate-400">Review Trust Meter</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[20px] font-semibold text-white">{trustScore}</p>
                <p className="text-[12px] text-slate-300">/100 trust score</p>
              </div>
              <p className="mt-1 text-[12px] text-slate-300">
                Likely genuine:{" "}
                {formatPercent(analysis.analysis.credibilitySummary.genuineLikely)} |
                Suspicious:{" "}
                {formatPercent(analysis.analysis.credibilitySummary.suspiciousLikely)}
              </p>
              <ul className="mt-2 space-y-1 text-[12px] text-slate-200">
                {analysis.analysis.credibilitySummary.reasons.map((reason) => (
                  <li key={reason}>- {reason}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[12px] text-slate-400">Buy/Wait Recommendation</p>
              <p className="mt-1 text-[14px] font-semibold uppercase text-white">
                {analysis.analysis.recommendation.decision}
              </p>
              <p className="mt-1 text-[12px] text-slate-200">
                {analysis.analysis.recommendation.rationale}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[12px] text-slate-400">Better Price Options</p>
              <ul className="mt-2 space-y-1 text-[12px] text-slate-200">
                {analysis.market.alternativePlatformPrices.length ? (
                  analysis.market.alternativePlatformPrices.map((item) => (
                    <li key={`${item.platform}-${item.price}`}>
                      {item.platform}: {item.currency} {item.price.toFixed(2)} (
                      {Math.round(item.confidence * 100)}% confidence)
                    </li>
                  ))
                ) : (
                  <li>No reliable cheaper platform found yet.</li>
                )}
              </ul>
              <p className="mt-2 text-[12px] text-slate-300">
                Action: {analysis.market.bestActionNow.action} -{" "}
                {analysis.market.bestActionNow.reason}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[12px] text-slate-400">Coupon Opportunities</p>
              <ul className="mt-2 space-y-1 text-[12px] text-slate-200">
                {analysis.market.coupons.length ? (
                  analysis.market.coupons.map((coupon) => (
                    <li key={`${coupon.code}-${coupon.source}`}>
                      {coupon.code}: save {coupon.estimatedSavings} (
                      {Math.round(coupon.confidence * 100)}% confidence)
                    </li>
                  ))
                ) : (
                  <li>No high-confidence coupons found.</li>
                )}
              </ul>
            </div>

            <p className="pb-1 text-[11px] text-slate-500">{analysis.dataDisclosure}</p>
          </>
        ) : (
          <p className="text-[12px] text-slate-400">
            Run analysis to get product insights and buying guidance.
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-800/90 bg-slate-900/95 px-3 py-3">
        <button
          type="button"
          onClick={() => void runAnalysis()}
          disabled={!pageData || stage === "analyzing" || stage === "pricing"}
          className="w-full rounded-md bg-indigo-500 px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700"
        >
          {stage === "analyzing" || stage === "pricing"
            ? "Analyzing..."
            : "Analyze This Product"}
        </button>
      </div>
    </div>
  );
}

export default App;
