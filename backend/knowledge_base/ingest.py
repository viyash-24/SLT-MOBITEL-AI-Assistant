"""SLT-MOBITEL knowledge-base ingestion pipeline.

Run once before starting the API, or re-run any time files change:

    cd backend
    python -m knowledge_base.ingest [--verbose] [--dry-run]

Idempotency guarantee
---------------------
Each source file is hashed.  If the hash and the number of embedded
vectors for that source are both unchanged the source is skipped.  When
a file changes, its old vectors are deleted and replaced in one
transaction per source, leaving every other source's vectors intact.

Supported file types (auto-discovered from data/)
--------------------------------------------------
* .xlsx  – FAQ workbook (Tag / Category / Question / Response columns)
* .pdf   – Package details PDF (selectable text, page-by-page + chunked)
* .txt   – Plain-text knowledge files (UTF-8)
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Callable

from langchain_core.documents import Document
from langchain_postgres import PGVector
from langchain_text_splitters import RecursiveCharacterTextSplitter
from openpyxl import load_workbook
from pypdf import PdfReader
from sqlalchemy import select

from config import Settings, get_settings
from embeddings import create_embeddings

logger = logging.getLogger("slt_knowledge_ingest")

DATA_DIR = Path(__file__).resolve().parent / "data"

# ---------------------------------------------------------------------------
# Text splitters
# ---------------------------------------------------------------------------

# General splitter used for PDF pages and TXT files
_TEXT_SPLITTER = RecursiveCharacterTextSplitter(
    chunk_size=1800,
    chunk_overlap=220,
    separators=["\n\n", "\n", ". ", " ", ""],
)

# Tighter splitter for PDF pages that contain dense tables — smaller chunks
# keep package name + price + data together during retrieval.
_TABLE_SPLITTER = RecursiveCharacterTextSplitter(
    chunk_size=900,
    chunk_overlap=150,
    separators=["\n\n", "\n", "  ", " ", ""],
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _source_hash(path: Path) -> str:
    """SHA-256 of the raw file bytes — used to detect file changes."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _stable_id(source: str, identity: str) -> str:
    """Deterministic vector ID derived from source filename + chunk identity."""
    return hashlib.sha256(f"{source}:{identity}".encode("utf-8")).hexdigest()


def _metadata(
    *,
    source: str,
    source_hash: str,
    content_type: str,
    document_id: str,
    chunk_id: int,
    category: str,
    title: str | None = None,
) -> dict[str, str | int]:
    return {
        "title": title or source,
        "source": source,
        "source_hash": source_hash,
        "content_type": content_type,
        "document_id": document_id,
        "chunk_id": chunk_id,
        "category": category,
    }


def _txt_category(path: Path) -> str:
    """Infer a human-readable category from the .txt filename."""
    name = path.stem.lower()
    if any(kw in name for kw in ("faq", "question", "help", "support", "troubleshoot")):
        return "Customer support FAQ"
    if any(kw in name for kw in ("package", "plan", "broadband", "fiber", "lte", "adsl", "connection")):
        return "SLT packages and plans"
    if any(kw in name for kw in ("policy", "terms", "condition", "legal")):
        return "Policies and terms"
    if any(kw in name for kw in ("contact", "hotline", "helpline", "number")):
        return "Contact and support"
    if any(kw in name for kw in ("roam", "international", "overseas")):
        return "Roaming and international"
    return "SLT-MOBITEL general information"


def _is_table_heavy(text: str) -> bool:
    """Heuristic: many short whitespace-separated columns ≈ table content."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return False
    multi_space = sum(1 for ln in lines if re.search(r"\s{3,}", ln))
    return multi_space / len(lines) > 0.5


# ---------------------------------------------------------------------------
# Per-format loaders
# ---------------------------------------------------------------------------

def _load_workbook(path: Path, source_hash: str) -> list[Document]:
    """Load FAQ Q&A pairs from an Excel workbook.

    Expected layout (1-indexed rows):
        Row 1 : empty / title
        Row 2 : Tag | Category | Question | Response | (empty)
        Row 3 : (empty) | (empty) | (empty)  | English | Sinhala
        Row 4+: data rows
    """
    workbook = load_workbook(path, read_only=True, data_only=True)
    documents: list[Document] = []
    try:
        for worksheet in workbook.worksheets:
            rows = list(worksheet.iter_rows(values_only=True))
            if len(rows) < 3:
                logger.warning("Workbook sheet %r has fewer than 3 rows — skipping.", worksheet.title)
                continue

            # Row index 1 (0-based) holds the main column headers
            headers = [
                str(value).strip().lower() if value is not None else ""
                for value in rows[1]
            ]

            # Locate required columns by name
            try:
                tag_index = headers.index("tag")
            except ValueError:
                # Try fuzzy: first column whose header starts with "tag"
                tag_index = next(
                    (i for i, h in enumerate(headers) if h.startswith("tag")), None
                )
            try:
                category_index = headers.index("category")
            except ValueError:
                category_index = next(
                    (i for i, h in enumerate(headers) if "categor" in h), None
                )
            try:
                question_index = headers.index("question")
            except ValueError:
                question_index = next(
                    (i for i, h in enumerate(headers) if "question" in h), None
                )
            try:
                response_index = headers.index("response")
            except ValueError:
                response_index = next(
                    (i for i, h in enumerate(headers) if "response" in h or "answer" in h), None
                )

            missing = [
                name for name, idx in (
                    ("tag", tag_index),
                    ("category", category_index),
                    ("question", question_index),
                    ("response", response_index),
                )
                if idx is None
            ]
            if missing:
                raise ValueError(
                    f"{path.name}/{worksheet.title}: could not locate columns: {missing}. "
                    f"Found headers: {headers}"
                )

            # Row index 2 (0-based) is the sub-header row (English / Sinhala).
            # Detect the Sinhala column from the actual sub-header row rather
            # than assuming a fixed offset.
            sub_headers = [
                str(value).strip().lower() if value is not None else ""
                for value in rows[2]
            ]
            english_col: int = response_index  # default: same column as Response
            sinhala_col: int | None = None
            for col_idx, sh in enumerate(sub_headers):
                if "english" in sh or "eng" == sh:
                    english_col = col_idx
                elif "sinhala" in sh or "si" == sh or "සිං" in sh:
                    sinhala_col = col_idx

            # If sub-header detection failed, fall back to response+1 convention
            if sinhala_col is None and response_index + 1 < len(headers):
                sinhala_col = response_index + 1

            seen: set[str] = set()
            skipped_empty = 0
            last_tag = "General"

            for row_number, row in enumerate(rows[3:], start=4):
                question = str(row[question_index] or "").strip()
                english = str(row[english_col] or "").strip()
                sinhala = (
                    str(row[sinhala_col] or "").strip()
                    if sinhala_col is not None and sinhala_col < len(row)
                    else ""
                )
                # Skip rows with no question or no answer at all
                if not question or (not english and not sinhala):
                    skipped_empty += 1
                    continue

                raw_tag = str(row[tag_index] or "").strip() if tag_index < len(row) else ""
                category = str(row[category_index] or "").strip() if category_index < len(row) else ""

                if raw_tag:
                    last_tag = raw_tag
                    tag = raw_tag
                elif category:
                    derived = category.replace("FAQs", "").replace("FAQ", "").strip()
                    tag = derived if derived else last_tag
                else:
                    tag = last_tag

                tag = tag or "General"
                full_category = f"{tag} / {category}" if category and category != tag else (category or tag)

                content = f"Question: {question}\nAnswer (English): {english}"
                if sinhala:
                    content += f"\nAnswer (Sinhala): {sinhala}"

                identity = hashlib.sha256(content.encode("utf-8")).hexdigest()
                if identity in seen:
                    logger.debug("Skipping duplicate row %s/%s.", worksheet.title, row_number)
                    continue
                seen.add(identity)

                clean_q = re.sub(r"\s+", " ", question).strip()
                title = f"FAQ: {clean_q[:65]}"

                document_id = f"{worksheet.title}-row{row_number}"
                documents.append(
                    Document(
                        id=_stable_id(path.name, document_id),
                        page_content=content,
                        metadata=_metadata(
                            source=path.name,
                            source_hash=source_hash,
                            content_type="xlsx",
                            document_id=document_id,
                            chunk_id=0,
                            category=full_category,
                            title=title,
                        ),
                    )
                )

            if skipped_empty:
                logger.info(
                    "%s/%s: skipped %d empty/incomplete rows.",
                    path.name, worksheet.title, skipped_empty,
                )

    finally:
        workbook.close()

    if not documents:
        logger.warning("No usable rows found in %s.", path.name)
    else:
        logger.info("Loaded %d Q&A documents from %s.", len(documents), path.name)
    return documents


def _load_pdf(path: Path, source_hash: str) -> list[Document]:
    """Extract text from each PDF page and chunk it.

    Table-heavy pages use a tighter splitter so that package name, price,
    and data allowance are kept together in one chunk rather than split across
    chunk boundaries.
    """
    reader = PdfReader(str(path))
    documents: list[Document] = []
    failed_pages: list[int] = []

    for page_number, page in enumerate(reader.pages, start=1):
        raw = (page.extract_text() or "").strip()
        if not raw:
            logger.error(
                "No selectable text on %s page %d — image-only or encrypted page.",
                path.name, page_number,
            )
            failed_pages.append(page_number)
            continue

        if "\ufffd" in raw:
            logger.warning(
                "%s page %d contains replacement characters (\\ufffd); "
                "verify extracted glyphs manually.",
                path.name, page_number,
            )

        # Extract meaningful page heading from the first non-empty line
        lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
        page_heading = lines[0][:60] if lines else f"Page {page_number}"

        # Choose the appropriate splitter based on content density
        splitter = _TABLE_SPLITTER if _is_table_heavy(raw) else _TEXT_SPLITTER
        chunks = splitter.split_text(raw)

        for chunk_index, chunk_text in enumerate(chunks):
            if not chunk_text.strip():
                continue
            document_id = f"page-{page_number}-chunk-{chunk_index}"
            chunk_suffix = f" (Part {chunk_index + 1})" if len(chunks) > 1 else ""
            documents.append(
                Document(
                    id=_stable_id(path.name, document_id),
                    page_content=chunk_text.strip(),
                    metadata=_metadata(
                        source=path.name,
                        source_hash=source_hash,
                        content_type="pdf",
                        document_id=document_id,
                        chunk_id=chunk_index,
                        category=f"Packages / {page_heading}",
                        title=f"SLT Packages: {page_heading} (p.{page_number}){chunk_suffix}",
                    ),
                )
            )

    if failed_pages:
        logger.error(
            "%s: could not extract text from %d/%d pages: %s",
            path.name, len(failed_pages), len(reader.pages), failed_pages,
        )
    else:
        logger.info("Loaded %d chunks from %s (%d pages).", len(documents), path.name, len(reader.pages))

    return documents


def _load_text(path: Path, source_hash: str) -> list[Document]:
    """Load and chunk a plain-text knowledge file."""
    content = path.read_text(encoding="utf-8", errors="replace").strip()
    if not content:
        logger.warning("Text source %s is empty — skipping.", path.name)
        return []
    if "\ufffd" in content:
        logger.warning(
            "%s contains replacement characters; verify encoding manually.", path.name
        )

    category = _txt_category(path)
    documents: list[Document] = []

    for chunk_number, chunk in enumerate(_TEXT_SPLITTER.split_text(content)):
        if not chunk.strip():
            continue
        document_id = f"chunk-{chunk_number}"
        documents.append(
            Document(
                id=_stable_id(path.name, document_id),
                page_content=chunk.strip(),
                metadata=_metadata(
                    source=path.name,
                    source_hash=source_hash,
                    content_type="txt",
                    document_id=document_id,
                    chunk_id=chunk_number,
                    category=category,
                    title=path.stem.replace("_", " ").replace("-", " ").title(),
                ),
            )
        )

    logger.info("Loaded %d chunks from %s.", len(documents), path.name)
    return documents


# ---------------------------------------------------------------------------
# File discovery and dispatch
# ---------------------------------------------------------------------------

_LOADERS: dict[str, Callable[[Path, str], list[Document]]] = {
    ".xlsx": _load_workbook,
    ".pdf": _load_pdf,
    ".txt": _load_text,
}

# Ordered list of explicitly registered files.  Any .txt file found in data/
# is automatically added after the registered files (alphabetical order).
_REGISTERED_FILES = (
    "FAQ.V4.xlsx",
    "SLT Package details and New Connection Charges. V1.2.pdf",
)


def _discover_sources(data_dir: Path) -> list[Path]:
    """Return an ordered list of source paths.

    Registered files come first (they are required and will raise
    FileNotFoundError if missing).  Additional .txt files discovered in
    data_dir are appended automatically so new files do not require a code
    change.
    """
    paths: list[Path] = []

    for filename in _REGISTERED_FILES:
        path = data_dir / filename
        if not path.exists():
            raise FileNotFoundError(
                f"Required knowledge-base file is missing: {path}\n"
                f"Place the file in {data_dir} and re-run ingestion."
            )
        paths.append(path)

    # Auto-discover any .txt files not already in the list
    registered_names = {p.name for p in paths}
    for txt_path in sorted(data_dir.glob("*.txt")):
        if txt_path.name not in registered_names:
            paths.append(txt_path)
            logger.info("Auto-discovered text file: %s", txt_path.name)

    return paths


def load_knowledge_documents(data_dir: Path = DATA_DIR) -> list[Document]:
    """Load all knowledge-base documents without touching the database.

    Raises FileNotFoundError if a registered file is missing.
    Returns an empty list if data_dir does not exist (used for graceful
    server startup when the database is not yet populated).
    """
    if not data_dir.exists():
        logger.warning("Knowledge-base data directory not found: %s", data_dir)
        return []

    source_paths = _discover_sources(data_dir)
    documents: list[Document] = []
    for path in source_paths:
        loader = _LOADERS.get(path.suffix.lower())
        if loader is None:
            logger.warning("No loader for file type %r — skipping %s.", path.suffix, path.name)
            continue
        try:
            docs = loader(path, _source_hash(path))
            documents.extend(docs)
        except Exception as exc:
            logger.error("Failed to load %s: %s", path.name, exc, exc_info=True)

    return documents


# ---------------------------------------------------------------------------
# pgvector upsert logic
# ---------------------------------------------------------------------------

def _existing_source_rows(store: PGVector, source: str) -> list[tuple[str, dict]]:
    with store._make_sync_session() as session:
        collection = store.get_collection(session)
        if collection is None:
            return []
        statement = select(
            store.EmbeddingStore.id,
            store.EmbeddingStore.cmetadata,
        ).where(
            store.EmbeddingStore.collection_id == collection.uuid,
            store.EmbeddingStore.cmetadata["source"].astext == source,
        )
        return [(str(row.id), row.cmetadata or {}) for row in session.execute(statement)]


def ingest_knowledge_base(
    settings: Settings | None = None,
    *,
    dry_run: bool = False,
) -> dict[str, int]:
    """Embed and store all knowledge-base documents.

    Returns a dict mapping source filename → number of vectors written (0 if
    unchanged, positive if new/replaced).

    Parameters
    ----------
    settings:
        If None, loaded from environment / .env file.
    dry_run:
        If True, load and parse files but skip all database writes.
        Useful for checking file parsing without a live database.
    """
    settings = settings or get_settings()
    if not settings.google_api_key:
        raise RuntimeError("GOOGLE_API_KEY is not configured.")
    if not dry_run and not settings.database_configured:
        raise RuntimeError("DATABASE_URL is not configured.")

    documents = load_knowledge_documents()
    if not documents:
        logger.warning("No documents loaded — nothing to ingest.")
        return {}

    by_source: dict[str, list[Document]] = defaultdict(list)
    for document in documents:
        by_source[str(document.metadata["source"])].append(document)

    logger.info(
        "Loaded %d documents across %d sources: %s",
        len(documents),
        len(by_source),
        list(by_source.keys()),
    )

    if dry_run:
        print("Dry-run mode — no database writes.")
        counts: dict[str, int] = {}
        for source, docs in by_source.items():
            print(f"  {source}: {len(docs)} documents would be indexed.")
            counts[source] = len(docs)
        return counts

    store = PGVector(
        embeddings=create_embeddings(settings),
        collection_name=settings.pgvector_collection,
        connection=settings.database_url,
        use_jsonb=True,
    )

    counts = {}
    for source, source_docs in by_source.items():
        existing = _existing_source_rows(store, source)
        expected_hash = str(source_docs[0].metadata["source_hash"])

        # Skip if the file hash and vector count are both unchanged
        unchanged = (
            len(existing) == len(source_docs)
            and all(meta.get("source_hash") == expected_hash for _, meta in existing)
        )
        if unchanged:
            counts[source] = 0
            logger.info(
                "Skipped unchanged source %s (%d vectors).", source, len(existing)
            )
            continue

        if existing:
            logger.info(
                "Replacing %d existing vectors for %s.", len(existing), source
            )
            store.delete(ids=[row_id for row_id, _ in existing])

        store.add_documents(
            source_docs,
            ids=[str(doc.id) for doc in source_docs],
        )
        counts[source] = len(source_docs)
        logger.info("Indexed %d vectors for %s.", len(source_docs), source)

    return counts


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Ingest SLT-MOBITEL knowledge-base files into pgvector.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Enable detailed ingestion log output.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Parse files and report counts without writing to the database.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    try:
        counts = ingest_knowledge_base(dry_run=args.dry_run)
    except FileNotFoundError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        logger.error("Knowledge-base ingestion failed: %s", error, exc_info=args.verbose)
        return 1

    print("\nIngestion complete.")
    total = 0
    for source, count in counts.items():
        status = "skipped (unchanged)" if count == 0 else f"{count} vectors written"
        print(f"  {source}: {status}")
        total += count
    print(f"\nTotal new/replaced vectors: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
