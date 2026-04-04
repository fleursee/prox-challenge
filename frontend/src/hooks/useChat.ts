import { useState, useCallback, useRef } from "react";
import type { Message } from "../types";

const API = "http://localhost:8000";

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const assistantBufferRef = useRef("");

  const appendToken = useCallback((token: string) => {
    assistantBufferRef.current += token;
    const text = assistantBufferRef.current;

    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.type === "text" && last.role === "assistant") {
        return [
          ...prev.slice(0, -1),
          { ...last, content: text },
        ];
      }
      return [
        ...prev,
        { type: "text", role: "assistant", content: text },
      ];
    });
  }, []);

  const sendMessage = useCallback(
    async (text: string, imageB64?: string) => {
      if (isStreaming) return;

      // Add user message
      setMessages((prev) => [
        ...prev,
        { type: "text", role: "user", content: text },
      ]);

      setIsStreaming(true);
      assistantBufferRef.current = "";

      // Build history for the API (text messages only)
      const history = messages
        .filter((m) => m.type === "text")
        .map((m) => ({ role: m.role, content: (m as { content: string }).content }));

      try {
        const res = await fetch(`${API}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, image: imageB64 ?? null, history }),
        });

        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const lines = part.trim().split("\n");
            const eventLine = lines.find((l) => l.startsWith("event:"));
            const dataLine  = lines.find((l) => l.startsWith("data:"));
            if (!eventLine || !dataLine) continue;

            const event = eventLine.replace("event: ", "").trim();
            const data  = JSON.parse(dataLine.replace("data: ", "").trim());

            if (event === "text") {
              appendToken(data.token);
            } else if (event === "artifact") {
              setMessages((prev) => [
                ...prev,
                {
                  type:         "artifact",
                  role:         "assistant",
                  artifactType: data.type,
                  code:         data.code,
                },
              ]);
            } else if (event === "image") {
              setMessages((prev) => [
                ...prev,
                {
                  type:   "image",
                  role:   "assistant",
                  source: data.source,
                  page:   data.page,
                  b64:    data.b64,
                },
              ]);
            } else if (event === "done" || event === "error") {
              setIsStreaming(false);
            }
          }
        }
      } catch (err) {
        console.error(err);
        setIsStreaming(false);
      }
    },
    [isStreaming, messages, appendToken]
  );

  return { messages, isStreaming, sendMessage };
}