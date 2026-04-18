#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List


REPO_ROOT = Path(__file__).resolve().parent.parent
QUIZ_ROOT = REPO_ROOT / "asset" / "data" / "quizzes"
MANIFEST_PATH = QUIZ_ROOT / "manifest.json"

DEFAULT_SYSTEM_PROMPT = (
    "You create ultra-clear, upbeat multiple-choice quiz questions for kids ages 6-10. "
    "Keep language simple, concrete, and easy to guess in under 5 seconds."
)

DEFAULT_USER_PROMPT_TEMPLATE = (
    "Create {question_count} kid-friendly multiple-choice quiz questions about {topic}. "
    "Do lightweight fact checking from common knowledge before writing. "
    "Make each question short, fun, and highly guessable for engagement.\n\n"
    "Output JSON only with this shape:\n"
    "{{\n"
    "  \"questions\": [\n"
    "    {{\n"
    "      \"question\": \"string\",\n"
    "      \"answers\": [\"string\", \"string\", \"string\", \"string\"],\n"
    "      \"correctIndex\": 0,\n"
    "      \"host\": \"very short encouraging line\"\n"
    "    }}\n"
    "  ]\n"
    "}}\n\n"
    "Rules:\n"
    "- 4 answers per question, exactly one correct answer\n"
    "- Answers must be short (1-4 words when possible)\n"
    "- Avoid trick wording, negatives, or ambiguity\n"
    "- Keep question text under 12 words\n"
    "- Keep host line under 10 words\n"
    "- Prioritize excitement and clarity over difficulty"
)


def slugify(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower())
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "topic"


def to_positive_int(value: int, fallback: int) -> int:
    return value if isinstance(value, int) and value > 0 else fallback


def normalize_questions(raw_questions: Any, question_count: int) -> List[Dict[str, Any]]:
    if not isinstance(raw_questions, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for item in raw_questions:
        question = str(item.get("question", "")).strip() if isinstance(item, dict) else ""
        answers = item.get("answers", []) if isinstance(item, dict) else []
        correct_index = item.get("correctIndex") if isinstance(item, dict) else None
        host = str(item.get("host", "")).strip() if isinstance(item, dict) else ""

        if not question or not isinstance(answers, list) or len(answers) < 4:
            continue
        cleaned_answers = [str(answer).strip() for answer in answers[:4]]
        if any(not answer for answer in cleaned_answers):
            continue
        if not isinstance(correct_index, int) or correct_index < 0 or correct_index >= len(cleaned_answers):
            continue

        normalized.append(
            {
                "question": question,
                "answers": cleaned_answers,
                "correctIndex": correct_index,
                "host": host,
            }
        )
        if len(normalized) >= question_count:
            break

    return normalized


def strip_code_fences(text: str) -> str:
    raw = text.strip()
    if raw.startswith("```") and raw.endswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


def call_openai_compatible(
    *,
    base_url: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
    timeout_seconds: int,
) -> Dict[str, Any]:
    endpoint = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "temperature": float(temperature),
        "max_tokens": int(max_tokens),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        method="POST",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))


def build_dataset(
    *,
    questions: List[Dict[str, Any]],
    question_seconds: int,
    topic_label: str,
    theme_name: str,
) -> Dict[str, Any]:
    return {
        "questions": questions,
        "timing": {
            "questionSeconds": question_seconds,
            "revealDurationMs": 2000,
            "introDelayMs": 3000,
            "urgentThresholdSeconds": max(2, min(4, question_seconds)),
            "tickIntervalMs": 1000,
        },
        "content": {
            "intro": {
                "title": f"{topic_label} Quiz",
                "message": "Get ready for fun, fast, easy-to-guess questions.",
            },
            "final": {
                "title": "Quiz complete!",
                "message": "Great job! Thanks for watching and playing along.",
            },
        },
        "theme": {"name": theme_name},
    }


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_manifest() -> Dict[str, Any]:
    if MANIFEST_PATH.exists():
        try:
            return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"defaultDataset": "", "datasets": []}


def save_manifest(manifest: Dict[str, Any]) -> None:
    write_json(MANIFEST_PATH, manifest)


def rebuild_manifest(default_dataset: str = "") -> Dict[str, Any]:
    datasets: List[Dict[str, str]] = []
    for path in sorted(QUIZ_ROOT.glob("*/*.json")):
        if path.name == "manifest.json":
            continue
        rel = path.relative_to(REPO_ROOT).as_posix()
        topic = path.parent.name
        datasets.append({"topic": topic, "path": rel})

    manifest = {
        "defaultDataset": default_dataset or (datasets[0]["path"] if datasets else ""),
        "datasets": datasets,
    }
    save_manifest(manifest)
    return manifest


def command_generate(args: argparse.Namespace) -> int:
    topic = args.topic.strip()
    topic_slug = slugify(topic)
    topic_dir = QUIZ_ROOT / topic_slug
    num_files = to_positive_int(args.num_files, 1)
    question_count = to_positive_int(args.questions_per_file, 4)
    question_seconds = to_positive_int(args.question_seconds, 7)
    theme_name = args.theme_name.strip() or "primary-play"
    timeout_seconds = to_positive_int(args.timeout_seconds, 60)

    if args.mode == "api":
        if not args.base_url:
            print("Error: --base-url is required in api mode.", file=sys.stderr)
            return 2
        if not args.model:
            print("Error: --model is required in api mode.", file=sys.stderr)
            return 2
        api_key = os.getenv(args.api_key_env)
        if not api_key:
            print(f"Error: environment variable {args.api_key_env} is not set.", file=sys.stderr)
            return 2

    topic_dir.mkdir(parents=True, exist_ok=True)
    created_paths: List[str] = []

    for index in range(1, num_files + 1):
        if args.mode == "api":
            user_prompt = DEFAULT_USER_PROMPT_TEMPLATE.format(question_count=question_count, topic=topic)
            try:
                response = call_openai_compatible(
                    base_url=args.base_url,
                    api_key=api_key,
                    model=args.model,
                    system_prompt=DEFAULT_SYSTEM_PROMPT,
                    user_prompt=user_prompt,
                    temperature=args.temperature,
                    max_tokens=args.max_tokens,
                    timeout_seconds=timeout_seconds,
                )
            except (urllib.error.URLError, TimeoutError) as error:
                print(f"Error: API request failed for file {index}: {error}", file=sys.stderr)
                return 1

            content = str(response.get("choices", [{}])[0].get("message", {}).get("content", ""))
            stripped = strip_code_fences(content)
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                print(f"Error: model response was not valid JSON for file {index}.", file=sys.stderr)
                return 1
            questions = normalize_questions(parsed.get("questions"), question_count)
            if len(questions) < question_count:
                print(f"Error: model returned {len(questions)} valid questions, expected {question_count}.", file=sys.stderr)
                return 1
        else:
            questions = []
            for question_index in range(1, question_count + 1):
                questions.append(
                    {
                        "question": f"{topic} question {question_index}?",
                        "answers": ["Option A", "Option B", "Option C", "Option D"],
                        "correctIndex": 0,
                        "host": "Pick the best answer!",
                    }
                )

        dataset = build_dataset(
            questions=questions,
            question_seconds=question_seconds,
            topic_label=topic,
            theme_name=theme_name,
        )

        file_name = f"{topic_slug}-{index:03d}.json"
        file_path = topic_dir / file_name
        write_json(file_path, dataset)
        created_paths.append(file_path.relative_to(REPO_ROOT).as_posix())

    manifest = rebuild_manifest(default_dataset=created_paths[0])
    print(json.dumps({"created": created_paths, "defaultDataset": manifest.get("defaultDataset", "")}, indent=2))
    return 0


def command_manifest(_args: argparse.Namespace) -> int:
    manifest = rebuild_manifest()
    print(json.dumps(manifest, indent=2))
    return 0


def command_list(_args: argparse.Namespace) -> int:
    manifest = load_manifest()
    print(json.dumps(manifest, indent=2))
    return 0


def command_urls(args: argparse.Namespace) -> int:
    manifest = load_manifest()
    datasets = manifest.get("datasets", []) if isinstance(manifest, dict) else []
    page = args.page.strip() if isinstance(args.page, str) else "index.html"
    urls: List[str] = []
    for item in datasets:
        path = str(item.get("path", "")).strip() if isinstance(item, dict) else ""
        if not path:
            continue
        urls.append(f"{page}?dataset={path}")
    print(json.dumps({"urls": urls}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate and manage quiz datasets.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate = subparsers.add_parser("generate", help="Generate quiz dataset JSON files.")
    generate.add_argument("--topic", required=True, help="Topic label, e.g. Python")
    generate.add_argument("--num-files", type=int, default=1, help="Number of dataset files to create")
    generate.add_argument("--questions-per-file", type=int, default=4, help="Questions per dataset file")
    generate.add_argument("--question-seconds", type=int, default=7, help="Seconds per question")
    generate.add_argument("--theme-name", default="primary-play", help="Theme name for generated dataset")
    generate.add_argument("--mode", choices=["api", "template"], default="template", help="Generation mode")
    generate.add_argument("--base-url", default="", help="OpenAI-compatible base URL, without /chat/completions")
    generate.add_argument("--model", default="", help="Model name for api mode")
    generate.add_argument("--api-key-env", default="OPENAI_API_KEY", help="Environment variable for API key")
    generate.add_argument("--temperature", type=float, default=0.6, help="Sampling temperature for api mode")
    generate.add_argument("--max-tokens", type=int, default=900, help="Max tokens for api mode")
    generate.add_argument("--timeout-seconds", type=int, default=60, help="HTTP timeout in seconds")
    generate.set_defaults(func=command_generate)

    manifest = subparsers.add_parser("manifest", help="Rebuild manifest from quiz files.")
    manifest.set_defaults(func=command_manifest)

    listing = subparsers.add_parser("list", help="Print current manifest.")
    listing.set_defaults(func=command_list)

    urls = subparsers.add_parser("urls", help="Print dataset render URLs for automation.")
    urls.add_argument("--page", default="index.html", help="Page path used to build URLs")
    urls.set_defaults(func=command_urls)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
