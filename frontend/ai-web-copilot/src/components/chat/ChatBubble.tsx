type ChatBubbleProps = {
  role: "user" | "assistant";
  children: string;
};

export function ChatBubble({ role, children }: ChatBubbleProps) {
  const isUser = role === "user";

  return (
    <div
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={
          isUser
            ? "max-w-[min(100%,18rem)] rounded-2xl rounded-br-md bg-blue-600 px-3.5 py-2.5 text-[15px] leading-snug text-white shadow-sm"
            : "max-w-[min(100%,18rem)] rounded-2xl rounded-bl-md border border-slate-700/80 bg-slate-800/95 px-3.5 py-2.5 text-[15px] leading-snug text-slate-100 shadow-sm"
        }
      >
        <p className="whitespace-pre-wrap break-words">{children}</p>
      </div>
    </div>
  );
}
