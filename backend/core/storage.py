"""
Object storage helper.

Primary backend is Google Cloud Storage (buckets created for this project).
If a bucket is unset or GCS is unreachable, falls back to a local ./storage
tree so the pipelines still run in a bare dev environment.

Bucket names are configurable via env:
  GCS_RAW_BUCKET      (default amr-raw-data-patchamomma-2026)      GLASS raw drops
  GCS_VENDOR_BUCKET   (default amr-vendor-docs-patchamomma-2026)   vendor documents
  GCS_HOSPITAL_BUCKET (default amr-hospital-staging-patchamomma-2026) hospital batch drops
"""
from __future__ import annotations

import io
import os
import pathlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional

RAW_BUCKET = os.getenv("GCS_RAW_BUCKET", "amr-raw-data-patchamomma-2026")
VENDOR_BUCKET = os.getenv("GCS_VENDOR_BUCKET", "amr-vendor-docs-patchamomma-2026")
HOSPITAL_BUCKET = os.getenv("GCS_HOSPITAL_BUCKET", "amr-hospital-staging-patchamomma-2026")

_LOCAL_ROOT = pathlib.Path(os.getenv("LOCAL_STORAGE_ROOT", "storage")).resolve()


@dataclass
class StoredObject:
    uri: str            # gs://bucket/key  or  file://<abs path>
    bucket: str
    key: str
    size: int
    updated: Optional[str] = None


def month_prefix(root: str, when: Optional[datetime] = None) -> str:
    when = when or datetime.now(timezone.utc)
    return f"{root.rstrip('/')}/{when:%Y}/{when:%m}"


def timestamp_key(root: str, filename: str, when: Optional[datetime] = None) -> str:
    when = when or datetime.now(timezone.utc)
    return f"{month_prefix(root, when)}/{when:%Y%m%dT%H%M%SZ}_{filename}"


class _LocalBackend:
    def __init__(self, bucket: str):
        self.bucket = bucket
        self.base = _LOCAL_ROOT / bucket
        self.base.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> pathlib.Path:
        p = (self.base / key).resolve()
        if not str(p).startswith(str(self.base)):
            raise ValueError("path traversal blocked")
        return p

    def put(self, key: str, data: bytes, content_type: str | None = None) -> StoredObject:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return StoredObject(uri=f"file://{p}", bucket=self.bucket, key=key, size=len(data),
                            updated=datetime.now(timezone.utc).isoformat())

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def list(self, prefix: str) -> list[StoredObject]:
        root = self._path(prefix)
        out: list[StoredObject] = []
        if root.is_dir():
            for f in sorted(root.rglob("*")):
                if f.is_file():
                    rel = str(f.relative_to(self.base))
                    out.append(StoredObject(uri=f"file://{f}", bucket=self.bucket, key=rel,
                                            size=f.stat().st_size,
                                            updated=datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).isoformat()))
        return out

    def signed_url(self, key: str, minutes: int = 60) -> str:
        return f"file://{self._path(key)}"


class _GcsBackend:
    def __init__(self, bucket: str, client):
        self.bucket_name = bucket
        self._bucket = client.bucket(bucket)

    def put(self, key: str, data: bytes, content_type: str | None = None) -> StoredObject:
        blob = self._bucket.blob(key)
        blob.upload_from_file(io.BytesIO(data), size=len(data), content_type=content_type)
        return StoredObject(uri=f"gs://{self.bucket_name}/{key}", bucket=self.bucket_name,
                            key=key, size=len(data), updated=datetime.now(timezone.utc).isoformat())

    def get(self, key: str) -> bytes:
        return self._bucket.blob(key).download_as_bytes()

    def list(self, prefix: str) -> list[StoredObject]:
        out: list[StoredObject] = []
        for blob in self._bucket.list_blobs(prefix=prefix.rstrip("/") + "/"):
            out.append(StoredObject(uri=f"gs://{self.bucket_name}/{blob.name}", bucket=self.bucket_name,
                                    key=blob.name, size=blob.size or 0,
                                    updated=blob.updated.isoformat() if blob.updated else None))
        return out

    def signed_url(self, key: str, minutes: int = 60) -> str:
        try:
            from datetime import timedelta
            return self._bucket.blob(key).generate_signed_url(expiration=timedelta(minutes=minutes))
        except Exception:
            return f"gs://{self.bucket_name}/{key}"


_clients: dict[str, object] = {}


def backend(bucket: str):
    """Return a storage backend for `bucket` (GCS if reachable, else local)."""
    if bucket in _clients:
        return _clients[bucket]
    be: object
    try:
        from google.cloud import storage

        client = storage.Client()
        # cheap reachability check
        client.bucket(bucket).exists()
        be = _GcsBackend(bucket, client)
    except Exception:
        be = _LocalBackend(bucket)
    _clients[bucket] = be
    return be


def is_gcs(bucket: str) -> bool:
    return isinstance(backend(bucket), _GcsBackend)
