type ChatComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  loading: boolean;
  canSend: boolean;
};

export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled,
  loading,
  canSend,
}: ChatComposerProps) {
  const sendDisabled = disabled || loading || !canSend;

  return (
    <div className="shrink-0 border-t border-slate-800/90 bg-slate-950/98 px-4 pb-3 pt-2 backdrop-blur-sm">
      <div className="flex w-full max-w-full items-end gap-2.5">
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-input"
          rows={1}
          placeholder="Message…"
          className="max-h-36 min-h-[48px] flex-1 resize-none rounded-2xl border border-slate-700/90 bg-slate-900/90 px-3.5 py-3 text-[15px] leading-snug text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          value={value}
          disabled={disabled || loading}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!sendDisabled) onSend();
            }
          }}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={sendDisabled}
          className="shrink-0 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
