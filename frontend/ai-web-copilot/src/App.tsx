/// <reference types="chrome" />
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatComposer } from "./components/chat/ChatComposer";
import {
  ChatMessages,
  type ChatMessage,
} from "./components/chat/ChatMessages";

type PageData = {
  title?: string;
  url?: string;
  content?: string;
};

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const SAMPLE_MESSAGES: ChatMessage[] = [
  {
    id: "sample-a1",
    role: "assistant",
    text: "Hi — I’m AI Web Copilot. I read the active tab and can answer questions about what you’re looking at.",
  },
  {
    id: "sample-u1",
    role: "user",
    text: "What should I ask you?",
  },
  {
    id: "sample-a2",
    role: "assistant",
    text: "Try something like “Summarize this page” or “What are the risks called out in the reviews?” — then hit Send below.",
  },
];

function App() {
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    ...SAMPLE_MESSAGES,
  ]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const handleAsk = useCallback(async () => {
    const text = query.trim();
    if (!text) return;

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      text,
    };
    setMessages((m) => [...m, userMessage]);
    setQuery("");

    setLoading(true);

    try {
      const res = await fetch("http://localhost:5001/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: text,
          pageData,
        }),
      });

      const data = (await res.json()) as { result?: string; message?: string };
      const reply =
        typeof data.result === "string"
          ? data.result
          : typeof data.message === "string"
            ? data.message
            : "No reply from server.";

      setMessages((m) => [
        ...m,
        { id: makeId(), role: "assistant", text: reply },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: makeId(),
          role: "assistant",
          text: "Error fetching response",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [query, pageData]);

  const canSend = query.trim().length > 0;
  const inputDisabled = !pageData;

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

      <ChatMessages ref={scrollRef} messages={messages} loading={loading} />

      <ChatComposer
        value={query}
        onChange={setQuery}
        onSend={() => void handleAsk()}
        disabled={inputDisabled}
        loading={loading}
        canSend={canSend}
      />
    </div>
  );
}

export default App;
