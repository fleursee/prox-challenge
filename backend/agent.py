import os
import json
import re
import chromadb
import anthropic

from pathlib import Path
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

load_dotenv(Path(__file__).parent.parent / ".env")

# ── Setup ─────────────────────────────────────────────────────────────────────

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

client     = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
embedder   = SentenceTransformer("all-MiniLM-L6-v2")
chroma     = chromadb.PersistentClient(path=str(Path(__file__).parent / "chroma_db"))
collection = chroma.get_collection("manual")

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """
You are Vulcan, a friendly and highly knowledgeable expert assistant for the Vulcan OmniPro 220 multiprocess welder.

Your user has just bought this welder and is likely standing in their garage trying to set it up. 
They are not an idiot, but they are not a professional welder either. 
Be warm, precise, and practical.

## Critical: Multimodal Responses

You must not be text-only. Follow these rules strictly:

1. **When a question involves wiring, polarity, or physical connections:**
   Generate an SVG diagram showing the setup. Do not just describe it in prose.

2. **When a question involves settings, duty cycles, or any matrix/table:**
   Generate an interactive HTML component — a calculator or visual table, not a prose description.

3. **When a troubleshooting flowchart would help:**
   Generate an SVG or HTML flowchart.

4. **When the answer is in a specific page of the manual:**
   Call the search_manual tool and the relevant page image will be surfaced automatically.

## How to generate artifacts

When you want to render a diagram or interactive component, wrap the code in artifact tags like this:

<artifact type="html">
<!DOCTYPE html>
<html>
  ...your interactive component here...
</html>
</artifact>

Or for SVG diagrams:

<artifact type="svg">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">
  ...your diagram here...
</svg>
</artifact>

Rules for artifacts:
- Make them self-contained (inline all CSS and JS, no external imports)
- Use a dark background (#1a1a1a) with warm accent colors (#f97316 orange, #fbbf24 amber)
- Make them beautiful and clear, not just functional
- For interactive components, add proper labels, hover states, and smooth transitions
- SVG diagrams should be large enough to read clearly, with proper labels and a legend if needed

## Tone

Warm, direct, never condescending. If the question is ambiguous, ask one focused clarifying question.
If a question requires cross-referencing multiple sections, do so — don't give a partial answer.
""".strip()

# ── Tools ─────────────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "search_manual",
        "description": (
            "Search the Vulcan OmniPro 220 owner's manual for relevant information. "
            "Returns the most relevant text chunks and their page images. "
            "Always call this before answering any specific technical question."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A specific technical query, e.g. 'duty cycle 200A 240V MIG' or 'polarity TIG welding'",
                },
                "n_results": {
                    "type": "integer",
                    "description": "Number of chunks to retrieve. Default 5, use more for complex cross-referencing questions.",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    }
]

# ── Tool execution ─────────────────────────────────────────────────────────────

def run_search_manual(query: str, n_results: int = 5) -> dict:
    embedding = embedder.encode([query]).tolist()[0]
    results   = collection.query(
        query_embeddings=[embedding],
        n_results=min(n_results, collection.count()),
        include=["documents", "metadatas"],
    )

    chunks = []
    images = []
    seen_pages = set()

    for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
        chunks.append({
            "text":   doc,
            "source": meta["source"],
            "page":   meta["page"],
        })
        page_key = (meta["source"], meta["page"])
        if page_key not in seen_pages:
            seen_pages.add(page_key)
            images.append({
                "source": meta["source"],
                "page":   meta["page"],
                "b64":    meta["page_image"],
            })

    return {"chunks": chunks, "images": images}

# ── SSE helpers ───────────────────────────────────────────────────────────────

def sse(event: str, data: dict) -> str:
    """Format a single SSE message."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def extract_artifacts(text: str) -> tuple[str, list[dict]]:
    """
    Pull <artifact> blocks out of the text, return cleaned text + list of artifacts.
    The frontend renders artifacts separately so they don't appear as raw code in the chat.
    """
    artifacts = []
    pattern   = re.compile(r'<artifact\s+type="(\w+)">(.*?)</artifact>', re.DOTALL)

    def replacer(m):
        artifacts.append({"type": m.group(1), "code": m.group(2).strip()})
        return ""  # remove the tag from the visible text

    clean_text = pattern.sub(replacer, text)
    return clean_text.strip(), artifacts

# ── Request schema ─────────────────────────────────────────────────────────────

class Message(BaseModel):
    role:    str
    content: str  # text only for history

class ChatRequest(BaseModel):
    message: str
    image:   str | None = None   # base64-encoded image from user upload
    history: list[Message] = []

# ── Main streaming endpoint ────────────────────────────────────────────────────

@app.post("/chat")
async def chat(req: ChatRequest):

    async def stream():
        try:
            # Build the user content block (text + optional image)
            user_content: list = []
            if req.image:
                user_content.append({
                    "type": "image",
                    "source": {
                        "type":       "base64",
                        "media_type": "image/jpeg",
                        "data":       req.image,
                    },
                })
            user_content.append({"type": "text", "text": req.message})

            # Build message history
            messages = [
                {"role": m.role, "content": m.content}
                for m in req.history
            ]
            messages.append({"role": "user", "content": user_content})

            # ── Agentic loop ──────────────────────────────────────────────────
            # We loop because tool use interrupts the stream:
            # Claude streams text → hits a tool call → we execute it →
            # feed the result back → Claude streams the final answer.

            while True:
                full_text    = ""
                tool_calls   = []
                stop_reason  = None

                with client.messages.stream(
                    model      = "claude-sonnet-4-5",
                    max_tokens = 4096,
                    system     = SYSTEM_PROMPT,
                    tools      = TOOLS,
                    messages   = messages,
                ) as stream_ctx:

                    for event in stream_ctx:
                        event_type = type(event).__name__

                        # Stream text tokens directly to the client
                        if event_type == "RawContentBlockDeltaEvent":
                            delta = event.delta
                            if hasattr(delta, "text") and delta.text:
                                full_text += delta.text
                                yield sse("text", {"token": delta.text})

                        # Capture tool use blocks as they complete
                        elif event_type == "RawContentBlockStopEvent":
                            pass  # handled via final_message below

                    final     = stream_ctx.get_final_message()
                    stop_reason = final.stop_reason

                    for block in final.content:
                        if block.type == "tool_use":
                            tool_calls.append(block)

                # ── If Claude wants to use a tool ─────────────────────────────
                if stop_reason == "tool_use" and tool_calls:
                    # Add Claude's response (with tool_use blocks) to history
                    messages.append({
                        "role":    "assistant",
                        "content": final.content,
                    })

                    # Execute each tool and build the tool_result message
                    tool_results = []
                    for tc in tool_calls:
                        if tc.name == "search_manual":
                            result = run_search_manual(
                                query     = tc.input.get("query", ""),
                                n_results = tc.input.get("n_results", 5),
                            )
                            # Emit page images to the frontend immediately
                            for img in result["images"]:
                                yield sse("image", {
                                    "source": img["source"],
                                    "page":   img["page"],
                                    "b64":    img["b64"],
                                })

                            # Feed text chunks back to Claude as tool result
                            chunks_text = "\n\n".join(
                                f"[{c['source']} p.{c['page']}]\n{c['text']}"
                                for c in result["chunks"]
                            )
                            tool_results.append({
                                "type":        "tool_result",
                                "tool_use_id": tc.id,
                                "content":     chunks_text,
                            })

                    messages.append({"role": "user", "content": tool_results})
                    # Loop again so Claude can now answer with the retrieved context

                else:
                    # ── Final answer: extract and emit any artifacts ───────────
                    clean_text, artifacts = extract_artifacts(full_text)
                    for artifact in artifacts:
                        yield sse("artifact", artifact)

                    yield sse("done", {"full_text": clean_text})
                    break

        except Exception as e:
            yield sse("error", {"message": str(e)})

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/health")
async def health():
    return {"status": "ok"}