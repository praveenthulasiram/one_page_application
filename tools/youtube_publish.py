#!/usr/bin/env python3
"""Schedule rendered quiz videos on YouTube: one episode goes live every day at a fixed time.

Videos are uploaded as private with a publish time (status.publishAt), so YouTube itself makes
them public on schedule; this machine does not need to be on at publish time.

Commands (run with the project venv):
  .venv/bin/python tools/youtube_publish.py auth       # one-time Google sign-in
  .venv/bin/python tools/youtube_publish.py plan       # show what would be scheduled (no upload)
  .venv/bin/python tools/youtube_publish.py schedule   # upload pending episodes with publish times
  .venv/bin/python tools/youtube_publish.py status     # list scheduled uploads and their YouTube state

Settings live in publish/config.json; every upload is recorded in publish/schedule.json.
"""
import argparse
import json
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "publish" / "config.json"
LEDGER_PATH = REPO_ROOT / "publish" / "schedule.json"
MANIFEST_PATH = REPO_ROOT / "asset" / "data" / "quizzes" / "manifest.json"
OUTPUT_DIR = REPO_ROOT / "output"
SECRETS_DIR = REPO_ROOT / ".secrets"
CLIENT_SECRET_PATH = SECRETS_DIR / "client_secret.json"
TOKEN_PATH = SECRETS_DIR / "youtube-token.json"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]
MIN_LEAD = timedelta(hours=1)  # never schedule a slot that is about to pass


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- episodes

def episode_number(dataset_path: str) -> Optional[int]:
    match = re.search(r"-(\d+)\.json$", dataset_path)
    return int(match.group(1)) if match else None


def build_title(dataset: Dict[str, Any], number: Optional[int], fmt: str) -> str:
    base = (dataset.get("content", {}).get("intro", {}).get("title") or "Kids Quiz").strip()
    numbered = f"{base} #{number}" if number else base
    suffix = " #Shorts" if fmt == "portrait" else " | Fun Quiz for Kids with Fun Facts"
    return re.sub(r"[<>]", "", f"{numbered}{suffix}")[:100]


def build_description(description_file: Path, fmt: str) -> str:
    lines = description_file.read_text(encoding="utf-8").splitlines()
    # The recorder's first line is a title suggestion; the upload title is built separately.
    if lines and lines[0].strip() and "|" in lines[0]:
        lines = lines[1:]
    body = "\n".join(lines).strip()
    if fmt == "portrait":
        body = f"{body}\n\n#Shorts"
    body = re.sub(r"[<>]", "", body)
    if len(body.encode("utf-8")) > 5000:
        body = body.encode("utf-8")[:4990].decode("utf-8", "ignore") + "…"
    return body


def find_episodes(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every (dataset, format) the config asks for, in manifest order, with its render status."""
    manifest = read_json(MANIFEST_PATH)
    episodes = []
    for item in manifest.get("datasets", []):
        dataset_path = item["path"]
        stem = Path(dataset_path).stem
        dataset = read_json(REPO_ROOT / dataset_path)
        for fmt in config["formats"]:
            folder = OUTPUT_DIR / f"{stem}-{fmt}"
            episodes.append({
                "key": f"{stem}-{fmt}",
                "dataset": dataset_path,
                "format": fmt,
                "video": folder / f"{stem}-{fmt}.mp4",
                "thumbnail": folder / "thumbnail.jpg",
                "descriptionFile": folder / "description.txt",
                "title": build_title(dataset, episode_number(dataset_path), fmt),
            })
    return episodes


def slot_datetime(day: date, config: Dict[str, Any]) -> datetime:
    hour, minute = (int(part) for part in config["publishTime"].split(":"))
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZoneInfo(config["timezone"]))


def plan_uploads(config: Dict[str, Any], ledger: Dict[str, Any], start: Optional[date]) -> List[Dict[str, Any]]:
    """Assign one publish day per dataset (all its formats share the slot), after anything already scheduled."""
    done = {entry["key"] for entry in ledger["uploads"]}
    tz = ZoneInfo(config["timezone"])
    now = datetime.now(tz)
    last_day = max((datetime.fromisoformat(e["publishAt"]).astimezone(tz).date() for e in ledger["uploads"]), default=None)

    day = start or now.date()
    if last_day and day <= last_day:
        day = last_day + timedelta(days=1)
    while slot_datetime(day, config) < now + MIN_LEAD:
        day += timedelta(days=1)

    planned: List[Dict[str, Any]] = []
    by_dataset: Dict[str, List[Dict[str, Any]]] = {}
    for episode in find_episodes(config):
        by_dataset.setdefault(episode["dataset"], []).append(episode)

    for dataset_path, formats in by_dataset.items():
        pending = [e for e in formats if e["key"] not in done]
        if not pending:
            continue
        missing = [e for e in pending if not e["video"].exists()]
        if missing:
            # Keep episodes in order: stop at the first one that is not rendered yet.
            print(f"Stopping at {dataset_path}: not rendered yet ({', '.join(e['format'] for e in missing)}).")
            print(f"  Render it with: npm run record -- --dataset {dataset_path} --format <format>")
            break
        # A dataset already half-scheduled keeps its existing day.
        existing = [e for e in ledger["uploads"] if e["dataset"] == dataset_path]
        publish_at = datetime.fromisoformat(existing[0]["publishAt"]) if existing else slot_datetime(day, config)
        for episode in pending:
            planned.append({**episode, "publishAt": publish_at})
        if not existing:
            day += timedelta(days=1)
    return planned


# ---------------------------------------------------------------- YouTube API

def youtube_client():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    if not TOKEN_PATH.exists():
        raise SystemExit("Not signed in: run `.venv/bin/python tools/youtube_publish.py auth` first.")
    credentials = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if not credentials.valid:
        if credentials.expired and credentials.refresh_token:
            credentials.refresh(Request())
            TOKEN_PATH.write_text(credentials.to_json(), encoding="utf-8")
        else:
            raise SystemExit("Sign-in expired: run `.venv/bin/python tools/youtube_publish.py auth` again.")
    return build("youtube", "v3", credentials=credentials, cache_discovery=False)


def command_auth(_args: argparse.Namespace) -> int:
    from google_auth_oauthlib.flow import InstalledAppFlow

    if not CLIENT_SECRET_PATH.exists():
        print(f"Missing {CLIENT_SECRET_PATH.relative_to(REPO_ROOT)}: download the OAuth client JSON from Google Cloud"
              " (see README, 'Publish to YouTube').", file=sys.stderr)
        return 2
    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET_PATH), SCOPES)
    # WSL forwards localhost to Windows, so the sign-in page in your Windows browser can redirect back here.
    credentials = flow.run_local_server(
        host="localhost", port=8765, open_browser=False, prompt="consent",
        authorization_prompt_message="Open this URL in your browser and choose your YouTube channel:\n{url}\n",
    )
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    TOKEN_PATH.write_text(credentials.to_json(), encoding="utf-8")
    TOKEN_PATH.chmod(0o600)

    channels = youtube_client().channels().list(part="snippet", mine=True).execute().get("items", [])
    names = ", ".join(c["snippet"]["title"] for c in channels) or "(no channel found)"
    print(f"Signed in. Uploads will go to: {names}")
    return 0


def upload_video(youtube, episode: Dict[str, Any], config: Dict[str, Any]) -> str:
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    body = {
        "snippet": {
            "title": episode["title"],
            "description": build_description(episode["descriptionFile"], episode["format"]),
            "tags": config["tags"],
            "categoryId": config["categoryId"],
            "defaultLanguage": config["language"],
            "defaultAudioLanguage": config["language"],
        },
        "status": {
            "privacyStatus": "private",  # publishAt only works on private videos
            "publishAt": episode["publishAt"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "selfDeclaredMadeForKids": config["madeForKids"],
            # Generic TTS narration over photos is not realistic altered media in YouTube's sense.
            "containsSyntheticMedia": False,
        },
    }
    media = MediaFileUpload(str(episode["video"]), mimetype="video/mp4", chunksize=8 * 1024 * 1024, resumable=True)
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    response = None
    retries = 0
    while response is None:
        try:
            status, response = request.next_chunk()
            if status:
                print(f"    {int(status.progress() * 100)}%", end="\r", flush=True)
        except HttpError as error:
            if error.resp.status in (500, 502, 503, 504) and retries < 5:
                retries += 1
                time.sleep(2 ** retries)
                continue
            raise
    return response["id"]


def set_thumbnail(youtube, video_id: str, thumbnail: Path) -> Optional[str]:
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    try:
        youtube.thumbnails().set(videoId=video_id, media_body=MediaFileUpload(str(thumbnail), mimetype="image/jpeg")).execute()
        return None
    except HttpError as error:
        return f"custom thumbnail not set ({error.resp.status}); custom thumbnails need a phone-verified channel"


# ---------------------------------------------------------------- commands

def print_plan(planned: List[Dict[str, Any]], config: Dict[str, Any]) -> None:
    tz = ZoneInfo(config["timezone"])
    for episode in planned:
        when = episode["publishAt"].astimezone(tz).strftime("%a %d %b %Y %H:%M %Z")
        print(f"  {when}  {episode['format']:<9}  {episode['title']}")


def command_plan(args: argparse.Namespace) -> int:
    config = read_json(CONFIG_PATH)
    planned = plan_uploads(config, read_json(LEDGER_PATH), args.start)
    if not planned:
        print("Nothing to schedule: every rendered episode is already on YouTube.")
        return 0
    print(f"Would schedule {len(planned)} upload(s):")
    print_plan(planned, config)
    return 0


def command_schedule(args: argparse.Namespace) -> int:
    config = read_json(CONFIG_PATH)
    ledger = read_json(LEDGER_PATH)
    planned = plan_uploads(config, ledger, args.start)
    if args.limit:
        planned = planned[:args.limit]
    if not planned:
        print("Nothing to schedule: every rendered episode is already on YouTube.")
        return 0
    print(f"Scheduling {len(planned)} upload(s):")
    print_plan(planned, config)

    youtube = youtube_client()
    for episode in planned:
        print(f"  uploading {episode['key']} ...")
        video_id = upload_video(youtube, episode, config)
        warning = set_thumbnail(youtube, video_id, episode["thumbnail"]) if episode["format"] == "landscape" else None
        # Record each upload immediately, so a failure later never causes a duplicate upload.
        ledger["uploads"].append({
            "key": episode["key"],
            "dataset": episode["dataset"],
            "format": episode["format"],
            "title": episode["title"],
            "publishAt": episode["publishAt"].isoformat(),
            "videoId": video_id,
            "url": f"https://youtu.be/{video_id}",
            "uploadedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
        write_json(LEDGER_PATH, ledger)
        print(f"    done: https://youtu.be/{video_id}" + (f"  (warning: {warning})" if warning else ""))
    return 0


def command_status(_args: argparse.Namespace) -> int:
    config = read_json(CONFIG_PATH)
    ledger = read_json(LEDGER_PATH)
    if not ledger["uploads"]:
        print("No uploads yet.")
        return 0
    states: Dict[str, Dict[str, Any]] = {}
    if TOKEN_PATH.exists():
        youtube = youtube_client()
        ids = [e["videoId"] for e in ledger["uploads"]]
        for start in range(0, len(ids), 50):
            response = youtube.videos().list(part="status,processingDetails", id=",".join(ids[start:start + 50])).execute()
            states.update({item["id"]: item for item in response.get("items", [])})
    tz = ZoneInfo(config["timezone"])
    for entry in ledger["uploads"]:
        when = datetime.fromisoformat(entry["publishAt"]).astimezone(tz).strftime("%a %d %b %H:%M")
        item = states.get(entry["videoId"])
        state = "unknown"
        if item:
            status = item["status"]
            state = status.get("privacyStatus", "?")
            if status.get("publishAt") and state == "private":
                state = "scheduled"
            state += f", {item.get('processingDetails', {}).get('processingStatus', 'processing ?')}"
        elif TOKEN_PATH.exists():
            state = "missing on YouTube (deleted?)"
        print(f"  {when}  {entry['format']:<9}  {state:<28}  {entry['url']}  {entry['title']}")
    return 0


def parse_date(value: str) -> date:
    return date.fromisoformat(value)


def main() -> int:
    parser = argparse.ArgumentParser(description="Schedule quiz videos on YouTube.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("auth", help="Sign in to YouTube (one-time).").set_defaults(func=command_auth)
    for name, func, help_text in (
        ("plan", command_plan, "Show what would be scheduled."),
        ("schedule", command_schedule, "Upload pending episodes as scheduled videos."),
    ):
        cmd = sub.add_parser(name, help=help_text)
        cmd.add_argument("--start", type=parse_date, help="First publish day (YYYY-MM-DD); default: next free day")
        cmd.set_defaults(func=func)
        if name == "schedule":
            cmd.add_argument("--limit", type=int, default=0, help="Upload at most N videos this run")
    sub.add_parser("status", help="List scheduled uploads and their YouTube state.").set_defaults(func=command_status)
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
