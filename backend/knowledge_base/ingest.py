"""SLT-MOBITEL knowledge-base ingestion pipeline.

Run once before starting the API, or re-run any time files change:

    cd backend
    python -m knowledge_base.ingest [--verbose] [--dry-run]

Idempotency guarantee
---------------------
Each source file is hashed (SHA-256). If the hash and the number of embedded
vectors for that source are both unchanged, the source is skipped. When a file
changes, its old vectors are deleted and replaced in one transaction per source,
leaving every other source's vectors intact. Stale vectors from removed sources
are purged automatically to prevent duplicate or outdated responses.

Supported file types (auto-discovered from data/)
--------------------------------------------------
* .json  – Structured FAQ and package details knowledge files (UTF-8)
* .txt   – Plain-text knowledge files (UTF-8)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

from langchain_core.documents import Document
from langchain_postgres import PGVector
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import select

from config import Settings, get_settings
from embeddings import create_embeddings

logger = logging.getLogger("slt_knowledge_ingest")

DATA_DIR = Path(__file__).resolve().parent / "data"

# ---------------------------------------------------------------------------
# Text splitters
# ---------------------------------------------------------------------------

# General splitter used for long text blocks and TXT files
_TEXT_SPLITTER = RecursiveCharacterTextSplitter(
    chunk_size=1800,
    chunk_overlap=220,
    separators=["\n\n", "\n", ". ", " ", ""],
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


# ---------------------------------------------------------------------------
# JSON loaders
# ---------------------------------------------------------------------------

def _parse_faq_json(data: dict[str, Any], path: Path, source_hash: str) -> list[Document]:
    """Parse FAQ entries from structured JSON format (e.g. SLT_FAQ_V4.json)."""
    faqs = data.get("faqs", [])
    documents: list[Document] = []
    seen: set[str] = set()
    skipped_empty = 0

    for idx, item in enumerate(faqs, start=1):
        faq_id = str(item.get("id") or f"faq_{idx:03d}")
        question = str(item.get("question") or "").strip()
        responses = item.get("responses") or {}

        if isinstance(responses, dict):
            english = str(responses.get("en") or "").strip()
            sinhala = str(responses.get("si") or "").strip()
        elif isinstance(responses, str):
            english = responses.strip()
            sinhala = ""
        else:
            english = ""
            sinhala = ""

        if not question or (not english and not sinhala):
            skipped_empty += 1
            continue

        raw_tag = str(item.get("tag") or "").strip()
        raw_category = str(item.get("category") or "").strip()

        tag = raw_tag or "General"
        category = raw_category or tag
        full_category = f"{tag} / {category}" if category and category != tag else (category or tag)

        content = f"Question: {question}\nAnswer (English): {english}"
        if sinhala:
            content += f"\nAnswer (Sinhala): {sinhala}"

        identity = hashlib.sha256(content.encode("utf-8")).hexdigest()
        if identity in seen:
            logger.debug("Skipping duplicate FAQ %s in %s.", faq_id, path.name)
            continue
        seen.add(identity)

        clean_q = re.sub(r"\s+", " ", question).strip()
        title = f"FAQ: {clean_q[:65]}"

        documents.append(
            Document(
                id=_stable_id(path.name, faq_id),
                page_content=content,
                metadata=_metadata(
                    source=path.name,
                    source_hash=source_hash,
                    content_type="json",
                    document_id=faq_id,
                    chunk_id=0,
                    category=full_category,
                    title=title,
                ),
            )
        )

    if skipped_empty:
        logger.info("%s: skipped %d empty/incomplete FAQ entries.", path.name, skipped_empty)

    return documents


def _parse_package_json(data: dict[str, Any], path: Path, source_hash: str) -> list[Document]:
    """Parse package details and connection charges from JSON (e.g. SLT_Package_Details_New_Connection_Charges_V1_2.json).

    Produces two complementary document levels:
      1. Section Overview: complete structured summary of the section and all its
         packages (ideal for multi-package comparison, general questions, and
         broader retrieval).
      2. Individual Record: detailed breakdown of each specific package/connection charge
         (ideal for direct pinpoint lookup by name, rental, or facility).
    """
    sections = data.get("sections", [])
    documents: list[Document] = []

    for s_idx, sec in enumerate(sections, start=1):
        sec_id = str(sec.get("section_id") or f"section_{s_idx:02d}")
        sec_title = str(sec.get("title") or "SLT Packages").strip()
        page = sec.get("source_page") or s_idx
        cols = sec.get("columns") or {}
        records = sec.get("records") or []

        category = f"Packages / {sec_title}"
        section_title = f"SLT Packages: {sec_title} (p.{page})"

        pkg_names: list[str] = []
        overview_lines: list[str] = []

        for r_idx, rec in enumerate(records):
            # Extract the primary label for this record
            name = (
                rec.get("package")
                or rec.get("package_name")
                or rec.get("price_plan_name")
                or rec.get("service_type")
                or rec.get("new_connection_type")
                or rec.get("customer_category")
            )
            name_str = str(name).strip() if name is not None else f"Record {r_idx + 1}"
            if name_str and name_str not in pkg_names:
                pkg_names.append(name_str)

            # Build readable attributes for the record
            parts: list[str] = []
            detailed_fields: list[str] = [
                f"Package/Service: {name_str}",
                f"Category/Section: {sec_title} (Page {page})",
            ]

            for col_k, col_label in cols.items():
                val = rec.get(col_k)
                if val is not None and str(val).strip():
                    parts.append(f"{col_label}: {val}")
                    detailed_fields.append(f"{col_label}: {val}")

            # Include any additional fields not in columns definition
            for k, v in rec.items():
                if k not in cols and k not in ("source_page", "inherited_from_merged_cell") and v is not None:
                    v_str = str(v).strip()
                    if v_str:
                        label = k.replace("_", " ").title()
                        parts.append(f"{label}: {v_str}")
                        detailed_fields.append(f"{label}: {v_str}")

            overview_lines.append(f"- {name_str} | " + " | ".join(parts))

            # ── 1. Individual Record Document ─────────────────────────────────
            rec_doc_id = f"{sec_id}-rec-{r_idx}"
            item_title = f"{name_str} ({sec_title})"[:70]
            rec_content = "\n".join(detailed_fields)

            documents.append(
                Document(
                    id=_stable_id(path.name, rec_doc_id),
                    page_content=rec_content,
                    metadata=_metadata(
                        source=path.name,
                        source_hash=source_hash,
                        content_type="json",
                        document_id=rec_doc_id,
                        chunk_id=r_idx + 1,
                        category=category,
                        title=item_title,
                    ),
                )
            )

        # ── 2. Section Overview Document ─────────────────────────────────────
        overview_doc_id = f"{sec_id}-overview"
        overview_header = (
            f"Section: {sec_title} (Page {page})\n"
            f"Included Packages/Options: {', '.join(pkg_names)}\n"
        )
        overview_content = overview_header + "\n" + "\n".join(overview_lines)

        documents.append(
            Document(
                id=_stable_id(path.name, overview_doc_id),
                page_content=overview_content,
                metadata=_metadata(
                    source=path.name,
                    source_hash=source_hash,
                    content_type="json",
                    document_id=overview_doc_id,
                    chunk_id=0,
                    category=category,
                    title=section_title,
                ),
            )
        )

    return documents


def _load_json(path: Path, source_hash: str) -> list[Document]:
    """Load knowledge documents from a JSON file.

    Dispatches based on the JSON schema:
      - FAQ format (contains 'faqs') -> _parse_faq_json
      - Package format (contains 'sections') -> _parse_package_json
      - Generic JSON -> fallback key/value document conversion
    """
    raw_content = path.read_text(encoding="utf-8", errors="replace").strip()
    if not raw_content:
        logger.warning("JSON source %s is empty — skipping.", path.name)
        return []

    try:
        data = json.loads(raw_content)
    except json.JSONDecodeError as exc:
        logger.error("Failed to decode JSON in %s: %s", path.name, exc)
        return []

    documents: list[Document] = []

    if isinstance(data, dict):
        if "faqs" in data:
            documents = _parse_faq_json(data, path, source_hash)
        elif "sections" in data:
            documents = _parse_package_json(data, path, source_hash)
        else:
            # Generic dict: chunk or represent as structured text
            logger.info("Parsing %s as generic JSON dictionary.", path.name)
            title = path.stem.replace("_", " ").replace("-", " ").title()
            category = _txt_category(path)
            content = json.dumps(data, indent=2, ensure_ascii=False)
            for idx, chunk in enumerate(_TEXT_SPLITTER.split_text(content)):
                if not chunk.strip():
                    continue
                doc_id = f"chunk-{idx}"
                documents.append(
                    Document(
                        id=_stable_id(path.name, doc_id),
                        page_content=chunk.strip(),
                        metadata=_metadata(
                            source=path.name,
                            source_hash=source_hash,
                            content_type="json",
                            document_id=doc_id,
                            chunk_id=idx,
                            category=category,
                            title=f"{title} (Part {idx + 1})" if idx > 0 else title,
                        ),
                    )
                )
    elif isinstance(data, list):
        # Generic list of items
        logger.info("Parsing %s as list of JSON items.", path.name)
        title = path.stem.replace("_", " ").replace("-", " ").title()
        category = _txt_category(path)
        for idx, item in enumerate(data):
            doc_id = f"item-{idx}"
            content = json.dumps(item, indent=2, ensure_ascii=False)
            documents.append(
                Document(
                    id=_stable_id(path.name, doc_id),
                    page_content=content,
                    metadata=_metadata(
                        source=path.name,
                        source_hash=source_hash,
                        content_type="json",
                        document_id=doc_id,
                        chunk_id=idx,
                        category=category,
                        title=f"{title} Item {idx + 1}",
                    ),
                )
            )

    logger.info("Loaded %d documents from %s.", len(documents), path.name)
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
    ".json": _load_json,
    ".txt": _load_text,
}

# Registered knowledge-base files. Auto-discovered .json and .txt files in data/
# are appended automatically.
_REGISTERED_FILES = (
    "SLT_FAQ_V4.json",
    "SLT_Package_Details_New_Connection_Charges_V1_2.json",
)


def _discover_sources(data_dir: Path) -> list[Path]:
    """Return an ordered list of source paths.

    Registered files come first (they are required and will raise
    FileNotFoundError if missing). Additional .json and .txt files discovered in
    data_dir are appended automatically.
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

    # Auto-discover any additional .json and .txt files not already registered
    registered_names = {p.name for p in paths}
    for file_path in sorted(data_dir.iterdir()):
        if file_path.is_file() and file_path.suffix.lower() in (".json", ".txt"):
            if file_path.name not in registered_names:
                paths.append(file_path)
                logger.info("Auto-discovered knowledge file: %s", file_path.name)

    return paths


def load_knowledge_documents(data_dir: Path = DATA_DIR) -> list[Document]:
    """Load all knowledge-base documents without touching the database.

    Raises FileNotFoundError if a registered file is missing.
    Returns an empty list if data_dir does not exist.
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


def _clean_outdated_sources(store: PGVector, active_sources: set[str]) -> list[str]:
    """Purge vectors whose source file is no longer in the active knowledge base.

    This ensures old sources (e.g. legacy PDF or XLSX files) do not linger in the
    pgvector collection and cause duplicate, conflicting, or outdated answers.
    """
    purged: list[str] = []
    with store._make_sync_session() as session:
        collection = store.get_collection(session)
        if collection is None:
            return []
        statement = select(
            store.EmbeddingStore.id,
            store.EmbeddingStore.cmetadata,
        ).where(
            store.EmbeddingStore.collection_id == collection.uuid,
        )
        stale_ids: list[str] = []
        for row in session.execute(statement):
            meta = row.cmetadata or {}
            source = meta.get("source")
            if source and source not in active_sources:
                stale_ids.append(str(row.id))
                if source not in purged:
                    purged.append(source)

    if stale_ids:
        store.delete(ids=stale_ids)
        logger.info(
            "Purged %d outdated vectors from removed sources: %s",
            len(stale_ids),
            purged,
        )
    return purged


def ingest_knowledge_base(
    settings: Settings | None = None,
    *,
    dry_run: bool = False,
) -> dict[str, int]:
    """Embed and store all knowledge-base documents into pgvector.

    Removes outdated entries from deleted source files and updates changed files.
    Returns a dict mapping source filename → number of vectors written.
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

    # Clean up stale/outdated sources (e.g. old XLSX or PDF vectors)
    active_sources = set(by_source.keys())
    _clean_outdated_sources(store, active_sources)

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
        description="Ingest SLT-MOBITEL JSON knowledge-base files into pgvector.",
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
