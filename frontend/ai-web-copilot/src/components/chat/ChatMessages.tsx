import { forwardRef } from "react";
import { ChatBubble } from "./ChatBubble";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ChatMessagesProps = {
  messages: ChatMessage[];
  loading: boolean;
};

export const ChatMessages = forwardRef<HTMLDivElement, ChatMessagesProps>(
  function ChatMessages({ messages, loading }, ref) {
    return (
      <div
        ref={ref}
        className="chat-scroll flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overflow-x-hidden px-4 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((m) => (
          <ChatBubble key={m.id} role={m.role}>
            {m.text}
          </ChatBubble>
        ))}
        {loading ? (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-slate-700/80 bg-slate-800/90 px-4 py-3 text-sm text-slate-400">
              <span className="size-2 animate-bounce rounded-full bg-slate-500 [animation-delay:0ms]" />
              <span className="size-2 animate-bounce rounded-full bg-slate-500 [animation-delay:150ms]" />
              <span className="size-2 animate-bounce rounded-full bg-slate-500 [animation-delay:300ms]" />
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);
