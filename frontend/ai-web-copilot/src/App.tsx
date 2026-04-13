import { useEffect, useState } from "react";

function App() {
  const [pageData, setPageData] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  // Listen for page data from content script
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
        (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error:", chrome.runtime.lastError.message);
            return;
          }

          setPageData(response);
        },
      );
    });
  }, []);

  const handleAsk = async () => {
    if (!query) return;

    setLoading(true);

    try {
      const res = await fetch("http://localhost:5000/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          pageData,
        }),
      });

      const data = await res.json();
      setResponse(data.result);
    } catch (err) {
      setResponse("Error fetching response");
    }

    setLoading(false);
  };

  return (
    <div className="p-4 w-[350px]">
      <h1 className="text-xl font-bold text-blue-500 mb-3">
        AI Web Copilot 🚀
      </h1>

      {/* Page Info */}
      {pageData ? (
        <div className="text-sm mb-2">
          <p className="font-semibold">Page:</p>
          <p className="truncate">{pageData.title}</p>
        </div>
      ) : (
        <p className="text-xs text-gray-500 mb-2">
          Unable to read page. Try refreshing.
        </p>
      )}

      {/* Input */}
      <textarea
        placeholder="Ask anything about this page..."
        className="w-full border rounded p-2 text-sm"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* Button */}
      <button
        onClick={handleAsk}
        disabled={!pageData || loading}
        className="mt-2 bg-blue-500 text-white px-3 py-1 rounded w-full disabled:opacity-50"
      >
        {loading ? "Thinking..." : "Ask AI"}
      </button>

      {/* Response */}
      {response && (
        <div className="mt-3 text-sm border-t pt-2">
          <p className="font-semibold">Response:</p>
          <p>{response}</p>
        </div>
      )}
    </div>
  );
}

export default App;
