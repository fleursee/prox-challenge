import fitz  # PyMuPDF
import chromadb
import base64
import os
import json
from pathlib import Path
from sentence_transformers import SentenceTransformer

# ── Config ────────────────────────────────────────────────────────────────────
FILES_DIR = Path(__file__).parent.parent / "files"
DB_DIR    = Path(__file__).parent / "chroma_db"
CHUNK_SIZE        = 800   # characters per chunk
CHUNK_OVERLAP     = 150   # overlap between chunks so context isn't lost at edges
PAGE_IMAGE_DPI    = 150   # high enough to read diagrams, low enough to stay fast

# ── Helpers ───────────────────────────────────────────────────────────────────

def page_to_base64(page: fitz.Page, dpi: int = PAGE_IMAGE_DPI) -> str:
    """Render a PDF page to a base64-encoded PNG string."""
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    return base64.b64encode(pix.tobytes("png")).decode("utf-8")


def chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Split text into overlapping chunks, splitting on whitespace boundaries."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        if end < len(text):
            # walk back to the nearest space so we don't cut mid-word
            while end > start and text[end] not in (" ", "\n"):
                end -= 1
        chunks.append(text[start:end].strip())
        start = end - overlap
    return [c for c in chunks if c]  # drop any empty strings


# ── Main ──────────────────────────────────────────────────────────────────────

def ingest():
    print("Loading embedding model...")
    model = SentenceTransformer("all-MiniLM-L6-v2")  # small, fast, good quality

    print("Setting up ChromaDB...")
    client = chromadb.PersistentClient(path=str(DB_DIR))

    # Wipe and recreate so re-running ingest is always clean
    try:
        client.delete_collection("manual")
    except Exception:
        pass
    collection = client.create_collection(
        name="manual",
        metadata={"hnsw:space": "cosine"},
    )

    pdf_files = list(FILES_DIR.glob("*.pdf"))
    if not pdf_files:
        print(f"No PDFs found in {FILES_DIR}. Exiting.")
        return

    all_chunks     = []
    all_embeddings = []
    all_ids        = []
    all_metadata   = []

    for pdf_path in pdf_files:
        print(f"\nProcessing {pdf_path.name}...")
        doc = fitz.open(str(pdf_path))

        for page_num, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()
            if not text:
                print(f"  Page {page_num}: no text (probably a full-image page), skipping text chunks")
                # Still store the image so the agent can surface it
                text = f"[Page {page_num} — visual content only]"

            page_image_b64 = page_to_base64(page)
            chunks = chunk_text(text, CHUNK_SIZE, CHUNK_OVERLAP)

            for chunk_idx, chunk in enumerate(chunks):
                chunk_id = f"{pdf_path.stem}_p{page_num}_c{chunk_idx}"
                all_chunks.append(chunk)
                all_ids.append(chunk_id)
                all_metadata.append({
                    "source":     pdf_path.name,
                    "page":       page_num,
                    "chunk_idx":  chunk_idx,
                    "page_image": page_image_b64,   # stored per-chunk for easy retrieval
                })

            print(f"  Page {page_num}: {len(chunks)} chunk(s)")

        doc.close()

    print(f"\nEmbedding {len(all_chunks)} chunks...")
    all_embeddings = model.encode(all_chunks, show_progress_bar=True).tolist()

    print("Writing to ChromaDB...")
    # ChromaDB has a batch size limit, so insert in batches of 500
    batch = 500
    for i in range(0, len(all_chunks), batch):
        collection.add(
            ids        = all_ids[i:i+batch],
            documents  = all_chunks[i:i+batch],
            embeddings = all_embeddings[i:i+batch],
            metadatas  = all_metadata[i:i+batch],
        )

    print(f"\n✅ Ingestion complete. {len(all_chunks)} chunks stored in {DB_DIR}")


if __name__ == "__main__":
    ingest()