import { useRef, useEffect, useState, useCallback } from "react";
import { useChat } from "../hooks/useChat";
import { ArtifactFrame } from "./ArtifactFrame";
import type { Message } from "../types";

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.type === "image") {
    return (
      <div className="flex flex-col gap-1 mt-2">
        <span className="text-xs text-white/30 font-mono">
          {msg.source} — p.{msg.page}
        </span>
        <img
          src={`data:image/png;base64,${msg.b64}`}
          alt={`Manual page ${msg.page}`}
          className="rounded-lg border border-white/10 max-w-sm shadow"
        />
      </div>
    );
  }

  if (msg.type === "artifact") {
    return <ArtifactFrame artifactType={msg.artifactType} code={msg.code} />;
  }

  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-orange-500 text-white rounded-br-sm"
            : "bg-white/8 text-white/90 rounded-bl-sm"
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
}

export function Chat() {
  const { messages, isStreaming, sendMessage } = useChat();
  const [input, setInput] = useState("");
  const [imageB64, setImageB64] = useState<string | undefined>();
  const [imagePreview, setImagePreview] = useState<string | undefined>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    sendMessage(text, imageB64);
    setInput("");
    setImageB64(undefined);
    setImagePreview(undefined);
  }, [input, imageB64, isStreaming, sendMessage]);

  const handleImage = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setImagePreview(result);
      setImageB64(result.split(",")[1]); // strip the data:image/...;base64, prefix
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const item = Array.from(e.clipboardData.items).find((i) =>
        i.type.startsWith("image")
      );
      if (item) handleImage(item.getAsFile()!);
    },
    [handleImage]
  );

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto px-4">
      {/* Header */}
      <div className="py-6 border-b border-white/10">
        <h1 className="text-white font-semibold tracking-tight">
          Vulcan <span className="text-orange-400">OmniPro 220</span>
        </h1>
        <p className="text-white/40 text-xs mt-0.5">
          Ask anything about your welder
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-6 flex flex-col gap-4">
        {messages.length === 0 && (
          <p className="text-white/20 text-sm text-center mt-20">
            Ask a question about setup, settings, troubleshooting, or wiring.
          </p>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {isStreaming && messages[messages.length - 1]?.type !== "text" && (
          <div className="flex justify-start">
            <div className="bg-white/8 rounded-2xl px-4 py-3 text-white/30 text-sm animate-pulse">
              thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="py-4 border-t border-white/10 flex flex-col gap-2">
        {imagePreview && (
          <div className="relative w-16 h-16">
            <img
              src={imagePreview}
              className="w-16 h-16 rounded-lg object-cover border border-white/20"
              alt="attachment"
            />
            <button
              onClick={() => { setImageB64(undefined); setImagePreview(undefined); }}
              className="absolute -top-1 -right-1 bg-black/80 text-white/60 rounded-full w-4 h-4 text-xs flex items-center justify-center"
            >
              ×
            </button>
          </div>
        )}
        <div className="flex gap-2 items-end">
          <button
            onClick={() => fileRef.current?.click()}
            className="text-white/30 hover:text-white/60 transition p-2"
            title="Attach image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleImage(e.target.files[0])} />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Ask about setup, duty cycle, wiring, troubleshooting…"
            rows={1}
            className="flex-1 bg-white/8 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 resize-none focus:outline-none focus:border-orange-500/50 transition"
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="bg-orange-500 hover:bg-orange-400 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl px-4 py-3 text-sm font-medium transition"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}