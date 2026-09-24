#!/usr/bin/env python3
"""Local-only publisher for Mein Deutsch learning data."""

import argparse
import json
import os
import subprocess
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


PROJECT_DIR = Path(__file__).resolve().parent
DATA_FILE = PROJECT_DIR / "learning-data.json"
HOST = "127.0.0.1"
PORT = 8765
MAX_BODY_SIZE = 10 * 1024 * 1024
SCHEMA_VERSION = 5
ALLOWED_ORIGINS = {
    "null",
    f"http://{HOST}:{PORT}",
    f"http://localhost:{PORT}",
}
PUBLISH_LOCK = threading.Lock()

VOCABULARY_FIELDS = (
    "id", "level", "book", "lesson", "german", "chinese",
    "english", "example", "translation", "createdAt",
)
GRAMMAR_FIELDS = (
    "id", "title", "lesson", "rule", "pattern", "example", "note", "createdAt",
)


class PublishError(Exception):
    """A safe message that can be shown in the browser."""


def parse_date(value):
    if not isinstance(value, str):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def valid_record(record, required_fields, optional_fields=()):
    if not isinstance(record, dict):
        return False
    if any(not isinstance(record.get(field), str) for field in required_fields):
        return False
    if any(field in record and not isinstance(record[field], str) for field in optional_fields):
        return False
    if not record["id"].strip() or not parse_date(record["createdAt"]):
        return False
    return "updatedAt" not in record or parse_date(record["updatedAt"])


def validate_payload(payload):
    if not isinstance(payload, dict):
        raise PublishError("发布数据格式不正确。")
    if payload.get("app") != "Mein Deutsch" or payload.get("schemaVersion") != SCHEMA_VERSION:
        raise PublishError("发布数据与当前 Mein Deutsch 版本不兼容。")
    if not parse_date(payload.get("exportedAt")):
        raise PublishError("发布数据缺少有效时间。")

    entries = payload.get("entries")
    grammar_entries = payload.get("grammarEntries")
    if not isinstance(entries, list) or not isinstance(grammar_entries, list):
        raise PublishError("发布数据必须包含单词和语法列表。")

    for index, entry in enumerate(entries, start=1):
        if not valid_record(entry, VOCABULARY_FIELDS, ("category",)):
            raise PublishError(f"第 {index} 条单词数据格式不正确。")
    for index, entry in enumerate(grammar_entries, start=1):
        if not valid_record(entry, GRAMMAR_FIELDS):
            raise PublishError(f"第 {index} 条语法数据格式不正确。")

    entry_ids = [entry["id"] for entry in entries]
    grammar_ids = [entry["id"] for entry in grammar_entries]
    if len(set(entry_ids)) != len(entry_ids):
        raise PublishError("单词数据中存在重复 ID。")
    if len(set(grammar_ids)) != len(grammar_ids):
        raise PublishError("语法数据中存在重复 ID。")

    return entries, grammar_entries


def run_git(*arguments, timeout=120, check=True):
    try:
        result = subprocess.run(
            ["git", "-C", str(PROJECT_DIR), *arguments],
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise PublishError("无法运行本机 Git 发布程序。") from error

    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        safe_detail = detail[-1] if detail else "未知 Git 错误"
        raise PublishError(f"GitHub 发布失败：{safe_detail}")
    return result


def read_existing_data():
    if not DATA_FILE.exists():
        return None
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_data_file(data):
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=".learning-data-", suffix=".tmp", dir=PROJECT_DIR
    )
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as temporary_file:
            json.dump(data, temporary_file, ensure_ascii=False, indent=2)
            temporary_file.write("\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_name, DATA_FILE)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def publish_payload(payload):
    entries, grammar_entries = validate_payload(payload)
    status = run_git("status", "--porcelain", "--untracked-files=no").stdout.splitlines()
    unrelated_changes = [line for line in status if not line.endswith(" learning-data.json")]
    if unrelated_changes:
        raise PublishError("网站程序存在尚未完成的修改，已为安全起见停止发布。")

    existing = read_existing_data()
    data_changed = not existing or (
        existing.get("entries") != entries
        or existing.get("grammarEntries") != grammar_entries
        or existing.get("schemaVersion") != SCHEMA_VERSION
    )

    if data_changed:
        published_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        public_data = {
            "app": "Mein Deutsch",
            "schemaVersion": SCHEMA_VERSION,
            "exportedAt": payload["exportedAt"],
            "publishedAt": published_at,
            "entries": entries,
            "grammarEntries": grammar_entries,
        }
        try:
            write_data_file(public_data)
        except OSError as error:
            raise PublishError("无法安全写入手机版数据文件。") from error

        run_git("add", "--", DATA_FILE.name)
        commit = run_git(
            "commit",
            "-m",
            f"Update mobile data ({len(entries)} words, {len(grammar_entries)} grammar)",
        )
        if commit.returncode != 0:
            raise PublishError("无法记录手机版数据版本。")
    else:
        published_at = existing.get("publishedAt", existing.get("exportedAt"))

    run_git("push", "origin", "main")
    revision = run_git("rev-parse", "--short", "HEAD").stdout.strip()
    return {
        "ok": True,
        "changed": data_changed,
        "entries": len(entries),
        "grammarEntries": len(grammar_entries),
        "publishedAt": published_at,
        "revision": revision,
    }


class PublishHandler(BaseHTTPRequestHandler):
    server_version = "MeinDeutschPublisher/1.0"

    def allowed_origin(self):
        origin = self.headers.get("Origin")
        return origin is None or origin in ALLOWED_ORIGINS

    def add_cors_headers(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.add_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if urlparse(self.path).path != "/api/publish" or not self.allowed_origin():
            self.send_json(403, {"error": "不允许这个页面调用发布助手。"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.add_cors_headers()
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self.send_json(200, {"ok": True, "service": "Mein Deutsch Publisher"})
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/api/publish":
            self.send_json(404, {"error": "Not found"})
            return
        if not self.allowed_origin():
            self.send_json(403, {"error": "不允许这个页面调用发布助手。"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_BODY_SIZE:
            self.send_json(413, {"error": "发布数据为空或超过 10 MB。"})
            return

        if not PUBLISH_LOCK.acquire(blocking=False):
            self.send_json(409, {"error": "已有一次发布正在进行，请稍后重试。"})
            return

        try:
            try:
                payload = json.loads(self.rfile.read(content_length))
                result = publish_payload(payload)
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_json(400, {"error": "发布内容不是有效 JSON。"})
                return
            except PublishError as error:
                self.send_json(400, {"error": str(error)})
                return
            except Exception:
                self.send_json(500, {"error": "发布助手发生意外错误，学习数据未被修改。"})
                return
            self.send_json(200, result)
        finally:
            PUBLISH_LOCK.release()

    def log_message(self, message_format, *arguments):
        print(f"{self.address_string()} - {message_format % arguments}", flush=True)


def load_json_file(path):
    try:
        with Path(path).open("r", encoding="utf-8") as source:
            return json.load(source)
    except (OSError, json.JSONDecodeError) as error:
        raise PublishError("无法读取指定的 JSON 备份。") from error


def main():
    parser = argparse.ArgumentParser(description="Publish Mein Deutsch data safely.")
    parser.add_argument("--serve", action="store_true", help="run the local publishing service")
    parser.add_argument("--publish-backup", metavar="FILE", help="publish a validated backup once")
    parser.add_argument("--validate", metavar="FILE", help="validate a backup without publishing")
    arguments = parser.parse_args()

    if arguments.validate:
        entries, grammar_entries = validate_payload(load_json_file(arguments.validate))
        print(json.dumps({"entries": len(entries), "grammarEntries": len(grammar_entries)}))
        return
    if arguments.publish_backup:
        result = publish_payload(load_json_file(arguments.publish_backup))
        print(json.dumps(result, ensure_ascii=False))
        return
    if arguments.serve:
        server = ThreadingHTTPServer((HOST, PORT), PublishHandler)
        print(f"Mein Deutsch publisher listening on http://{HOST}:{PORT}", flush=True)
        server.serve_forever()
        return
    parser.error("choose --serve, --publish-backup, or --validate")


if __name__ == "__main__":
    main()
