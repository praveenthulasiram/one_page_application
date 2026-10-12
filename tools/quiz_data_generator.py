#!/usr/bin/env python3
"""Generate and manage kid-friendly quiz datasets for the quiz video pipeline.

Commands:
  generate  create new dataset files (template bank or OpenAI-compatible API)
  images    download clue images from Wikipedia/Wikimedia Commons (with credits)
  shuffle   re-shuffle answer positions in existing datasets
  validate  check every dataset is render-ready
  manifest  rebuild asset/data/quizzes/manifest.json from files on disk
  list      print the manifest
  urls      print render URLs for every dataset
"""
import argparse
import html
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional


REPO_ROOT = Path(__file__).resolve().parent.parent
QUIZ_ROOT = REPO_ROOT / "asset" / "data" / "quizzes"
MANIFEST_PATH = QUIZ_ROOT / "manifest.json"
IMAGE_ROOT = REPO_ROOT / "asset" / "img" / "quiz"
CREDITS_PATH = IMAGE_ROOT / "credits.json"

# Wikimedia asks API clients for a descriptive User-Agent with a contact point.
USER_AGENT = "OnePageQuiz/1.0 (https://github.com/praveenthulasiram/one_page_application)"
IMAGE_WIDTH = 1280

STYLE_PROMPTS: Dict[str, Dict[str, str]] = {
    "animal-clue": {
        "system": (
            "You write ultra-clear, upbeat guess-the-animal quiz questions for kids ages 6-10. "
            "Every fact you state must be true; prefer well-known facts over surprising-but-shaky ones."
        ),
        "rules": (
            "- Each question is one simple clue about an animal, ending with 'Who am I?'\n"
            "- The correct animal must be the only reasonable answer (no koala vs. kangaroo pouch tricks)\n"
            "- 'subject' is the exact English Wikipedia article title for the correct animal (used to fetch a photo)"
        ),
    },
    "general": {
        "system": (
            "You write ultra-clear, upbeat multiple-choice quiz questions for kids ages 6-10. "
            "Every fact you state must be true; prefer well-known facts over surprising-but-shaky ones."
        ),
        "rules": (
            "- Questions are about {topic} and answerable by a curious 8-year-old\n"
            "- Exactly one answer is clearly correct; wrong answers are plausible but not tricky\n"
            "- 'subject' is the exact English Wikipedia article title whose photo best illustrates the question"
        ),
    },
}

USER_PROMPT_TEMPLATE = (
    "Create {question_count} kid-friendly multiple-choice quiz questions about {topic}.\n"
    "Avoid these subjects, they were already used: {avoid}.\n\n"
    "Output JSON only, with this shape:\n"
    "{{\"questions\": [{{\"question\": \"string\", \"answers\": [\"correct answer first\", \"wrong\", \"wrong\", \"wrong\"], "
    "\"fact\": \"one fun true fact shown after the reveal\", \"subject\": \"Wikipedia article title\"}}]}}\n\n"
    "Rules:\n"
    "{style_rules}\n"
    "- Put the correct answer FIRST in 'answers'; it will be shuffled later\n"
    "- 4 answers, each 1-3 words\n"
    "- Question under 16 words, fact under 16 words\n"
    "- No negatives ('Which is NOT...'), no trick wording, nothing scary or violent"
)

# Curated offline bank. The correct answer is always listed first; positions are shuffled on write.
ANIMAL_BANK: List[Dict[str, Any]] = [
    {"question": "I have a long trunk and big floppy ears. Who am I?", "answers": ["Elephant", "Giraffe", "Hippo", "Rhino"], "fact": "Elephants use their trunks to drink, smell, and say hello!", "subject": "African bush elephant"},
    {"question": "I have a big fluffy mane and a mighty roar. Who am I?", "answers": ["Lion", "Tiger", "Bear", "Wolf"], "fact": "A lion's roar can be heard 8 kilometers away!", "subject": "Lion"},
    {"question": "I am black and white and munch bamboo all day. Who am I?", "answers": ["Panda", "Zebra", "Penguin", "Skunk"], "fact": "Pandas can spend 12 hours a day eating bamboo!", "subject": "Giant panda"},
    {"question": "I hop on big feet and carry my baby in a pouch. Who am I?", "answers": ["Kangaroo", "Rabbit", "Frog", "Deer"], "fact": "A baby kangaroo is called a joey!", "subject": "Red kangaroo"},
    {"question": "My neck is so long I eat leaves from the treetops. Who am I?", "answers": ["Giraffe", "Camel", "Horse", "Ostrich"], "fact": "A giraffe's tongue is dark purple and about 50 cm long!", "subject": "Giraffe"},
    {"question": "I swim in the sea, click and whistle, and love to jump. Who am I?", "answers": ["Dolphin", "Shark", "Octopus", "Crab"], "fact": "Dolphins sleep with one half of their brain at a time!", "subject": "Common bottlenose dolphin"},
    {"question": "I am a bird, but I swim instead of fly. Who am I?", "answers": ["Penguin", "Parrot", "Owl", "Eagle"], "fact": "Emperor penguin dads keep the egg warm on their feet!", "subject": "Emperor penguin"},
    {"question": "I have orange fur with black stripes. Who am I?", "answers": ["Tiger", "Leopard", "Fox", "Lion"], "fact": "No two tigers have the same stripes!", "subject": "Tiger"},
    {"question": "I look like a horse with black and white stripes. Who am I?", "answers": ["Zebra", "Donkey", "Cow", "Panda"], "fact": "Zebras can sleep standing up!", "subject": "Plains zebra"},
    {"question": "I hoot at night and can turn my head really far. Who am I?", "answers": ["Owl", "Bat", "Crow", "Chicken"], "fact": "Owls can turn their heads three-quarters of the way around!", "subject": "Great horned owl"},
    {"question": "I live in the desert and have a big hump on my back. Who am I?", "answers": ["Camel", "Llama", "Goat", "Horse"], "fact": "A camel's hump stores fat, not water!", "subject": "Dromedary"},
    {"question": "I have eight arms and can squirt ink. Who am I?", "answers": ["Octopus", "Jellyfish", "Starfish", "Turtle"], "fact": "An octopus has three hearts!", "subject": "Common octopus"},
    {"question": "I sleep most of the day high up in eucalyptus trees. Who am I?", "answers": ["Koala", "Monkey", "Squirrel", "Owl"], "fact": "Koalas eat almost nothing but eucalyptus leaves!", "subject": "Koala"},
    {"question": "I am a pink bird that often stands on one leg. Who am I?", "answers": ["Flamingo", "Parrot", "Swan", "Peacock"], "fact": "Flamingos are pink because of the food they eat!", "subject": "American flamingo"},
    {"question": "I have a hard shell and lay my eggs on the beach. Who am I?", "answers": ["Sea turtle", "Seal", "Frog", "Duck"], "fact": "Sea turtles can hold their breath for hours while they sleep!", "subject": "Green sea turtle"},
    {"question": "I open my tail like a giant colorful fan. Who am I?", "answers": ["Peacock", "Chicken", "Pigeon", "Parrot"], "fact": "Only the boys, called peacocks, have the big fancy tail!", "subject": "Indian peafowl"},
    {"question": "I start life as a tadpole and love to jump. Who am I?", "answers": ["Frog", "Fish", "Lizard", "Rabbit"], "fact": "Frogs drink water through their skin!", "subject": "Frog"},
    {"question": "I buzz from flower to flower and make honey. Who am I?", "answers": ["Bee", "Butterfly", "Ant", "Ladybug"], "fact": "Bees dance to tell their friends where the flowers are!", "subject": "Western honey bee"},
    {"question": "I have thick white fur and live on the Arctic ice. Who am I?", "answers": ["Polar bear", "Penguin", "Brown bear", "Seal"], "fact": "Under all that white fur, a polar bear's skin is black!", "subject": "Polar bear"},
    {"question": "I am the fastest runner on land. Who am I?", "answers": ["Cheetah", "Horse", "Lion", "Rabbit"], "fact": "A cheetah can run as fast as a car on the highway!", "subject": "Cheetah"},
    {"question": "I used to be a caterpillar, and now I have colorful wings. Who am I?", "answers": ["Butterfly", "Bee", "Bird", "Bat"], "fact": "Butterflies taste with their feet!", "subject": "Monarch butterfly"},
    {"question": "I have a long snout, lots of teeth, and bumpy skin. Who am I?", "answers": ["Crocodile", "Lizard", "Snake", "Shark"], "fact": "Crocodiles can't stick out their tongues!", "subject": "Nile crocodile"},
    {"question": "I am the biggest animal that has ever lived. Who am I?", "answers": ["Blue whale", "Elephant", "Shark", "Dinosaur"], "fact": "A blue whale's heart is as big as a bumper car!", "subject": "Blue whale"},
    {"question": "I am small and spiky, and I curl up into a ball. Who am I?", "answers": ["Hedgehog", "Mouse", "Hamster", "Squirrel"], "fact": "A hedgehog has about 5,000 spikes called quills!", "subject": "Hedgehog"},
]

DEFAULT_TIMING = {
    "questionSeconds": 10,
    "revealDurationMs": 3500,
    "introDelayMs": 3000,
    "urgentThresholdSeconds": 3,
}


# ---------------------------------------------------------------- helpers

def slugify(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower())
    return re.sub(r"-+", "-", text).strip("-") or "topic"


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def repo_rel(path: Path) -> str:
    return path.resolve().relative_to(REPO_ROOT).as_posix()


def dataset_files() -> List[Path]:
    return sorted(p for p in QUIZ_ROOT.glob("*/*.json"))


def resolve_dataset_args(paths: List[str], use_all: bool) -> List[Path]:
    if use_all:
        return dataset_files()
    resolved = [(REPO_ROOT / p).resolve() if not Path(p).is_absolute() else Path(p) for p in paths]
    missing = [str(p) for p in resolved if not p.exists()]
    if missing:
        raise SystemExit(f"Error: dataset not found: {', '.join(missing)}")
    return resolved


def next_free_paths(topic_dir: Path, topic_slug: str, count: int) -> List[Path]:
    """Return `count` new file paths that never overwrite an existing dataset."""
    used = set()
    for path in topic_dir.glob(f"{topic_slug}-*.json"):
        match = re.fullmatch(rf"{re.escape(topic_slug)}-(\d+)", path.stem)
        if match:
            used.add(int(match.group(1)))
    start = max(used, default=0) + 1
    return [topic_dir / f"{topic_slug}-{n:03d}.json" for n in range(start, start + count)]


# ---------------------------------------------------------------- questions

def clean_question(raw: Any) -> Optional[Dict[str, Any]]:
    """Normalise one question with the correct answer listed first. Returns None if unusable."""
    if not isinstance(raw, dict):
        return None
    question = str(raw.get("question", "")).strip()
    answers = raw.get("answers")
    if not question or not isinstance(answers, list):
        return None
    answers = [str(a).strip() for a in answers[:4]]
    if len(answers) < 3 or any(not a for a in answers) or len({a.lower() for a in answers}) != len(answers):
        return None
    return {
        "question": question,
        "answers": answers,
        "correctIndex": 0,
        "fact": str(raw.get("fact", "")).strip(),
        "subject": str(raw.get("subject", "")).strip(),
    }


def shuffle_answers(questions: List[Dict[str, Any]], rng: random.Random) -> None:
    """Shuffle answers in place, spreading the correct slot evenly so viewers can't spot a pattern."""
    slots: List[int] = []
    for question in questions:
        count = len(question["answers"])
        if not slots:
            slots = list(range(4))
            rng.shuffle(slots)
        target = next((s for s in slots if s < count), rng.randrange(count))
        if target in slots:
            slots.remove(target)
        correct = question["answers"][question["correctIndex"]]
        others = [a for i, a in enumerate(question["answers"]) if i != question["correctIndex"]]
        rng.shuffle(others)
        others.insert(target, correct)
        question["answers"] = others
        question["correctIndex"] = target


def build_dataset(questions: List[Dict[str, Any]], topic_label: str, question_seconds: int) -> Dict[str, Any]:
    return {
        "questions": questions,
        "timing": {**DEFAULT_TIMING, "questionSeconds": question_seconds},
        "content": {
            "intro": {"title": f"{topic_label} Quiz", "message": "Can you guess them all?"},
            "final": {"title": "Great guessing!", "message": "How many did you get right?"},
        },
    }


def call_openai_compatible(*, base_url: str, api_key: str, model: str, system_prompt: str, user_prompt: str,
                           temperature: float, max_tokens: int, timeout_seconds: int) -> Dict[str, Any]:
    payload = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    request = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))


def parse_model_json(content: str) -> Any:
    raw = content.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


def used_subjects() -> List[str]:
    subjects = set()
    for path in dataset_files():
        try:
            for q in read_json(path).get("questions", []):
                if q.get("subject"):
                    subjects.add(q["subject"])
        except (json.JSONDecodeError, OSError):
            continue
    return sorted(subjects)


# ---------------------------------------------------------------- images

def http_get(url: str, *, attempts: int = 4) -> bytes:
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code in (429, 503) and attempt < attempts - 1:
                time.sleep(2 ** (attempt + 1))
                continue
            raise
    raise RuntimeError("unreachable")


def strip_html(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value or ""))).strip()


def lookup_wikipedia_image(subject: str) -> Dict[str, str]:
    """Find the lead image of an English Wikipedia article, plus its Commons licence details."""
    query = urllib.parse.urlencode({
        "action": "query", "format": "json", "redirects": 1, "titles": subject,
        "prop": "pageimages", "piprop": "name",
    })
    pages = json.loads(http_get(f"https://en.wikipedia.org/w/api.php?{query}"))["query"]["pages"]
    page = next(iter(pages.values()))
    file_name = page.get("pageimage")
    if not file_name:
        raise LookupError(f"no lead image for Wikipedia article '{subject}'")

    query = urllib.parse.urlencode({
        "action": "query", "format": "json", "titles": f"File:{file_name}",
        "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": IMAGE_WIDTH,
    })
    pages = json.loads(http_get(f"https://commons.wikimedia.org/w/api.php?{query}"))["query"]["pages"]
    info = next(iter(pages.values()))["imageinfo"][0]
    meta = info.get("extmetadata", {})
    return {
        "download": info.get("thumburl") or info["url"],
        "file": file_name.replace("_", " "),
        "author": strip_html(meta.get("Artist", {}).get("value", "")) or "Unknown",
        "license": strip_html(meta.get("LicenseShortName", {}).get("value", "")) or "See source",
        "source": info.get("descriptionurl", ""),
    }


def ensure_image(subject: str, credits: Dict[str, Any]) -> Dict[str, Any]:
    """Download the image for `subject` once; return {path, credit}."""
    slug = slugify(subject)
    existing = credits.get(slug)
    if existing and (REPO_ROOT / existing["path"]).exists():
        return existing

    details = lookup_wikipedia_image(subject)
    ext = Path(urllib.parse.urlparse(details["download"]).path).suffix.lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        ext = ".jpg"
    target = IMAGE_ROOT / f"{slug}{ext}"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(http_get(details["download"]))
    time.sleep(0.5)

    entry = {
        "path": repo_rel(target),
        "credit": {k: details[k] for k in ("file", "author", "license", "source")},
    }
    credits[slug] = entry
    write_json(CREDITS_PATH, credits)
    return entry


def attach_images(dataset: Dict[str, Any], *, refresh: bool = False) -> List[str]:
    """Fill imageUrl/imageCredit for questions that have a subject. Returns error messages."""
    credits = read_json(CREDITS_PATH) if CREDITS_PATH.exists() else {}
    errors: List[str] = []
    for question in dataset.get("questions", []):
        subject = question.get("subject")
        if not subject:
            continue
        if not refresh and question.get("imageUrl") and (REPO_ROOT / question["imageUrl"]).exists():
            continue
        try:
            entry = ensure_image(subject, credits)
        except (LookupError, urllib.error.URLError, KeyError, StopIteration) as error:
            errors.append(f"{subject}: {error}")
            continue
        question["imageUrl"] = entry["path"]
        question["imageCredit"] = entry["credit"]
    return errors


# ---------------------------------------------------------------- manifest

def rebuild_manifest(default_dataset: str = "") -> Dict[str, Any]:
    datasets = [{"topic": p.parent.name, "path": repo_rel(p)} for p in dataset_files()]
    paths = {d["path"] for d in datasets}
    if default_dataset not in paths:
        previous = read_json(MANIFEST_PATH).get("defaultDataset", "") if MANIFEST_PATH.exists() else ""
        default_dataset = previous if previous in paths else (datasets[0]["path"] if datasets else "")
    manifest = {"defaultDataset": default_dataset, "datasets": datasets}
    write_json(MANIFEST_PATH, manifest)
    return manifest


# ---------------------------------------------------------------- commands

def command_generate(args: argparse.Namespace) -> int:
    topic = args.topic.strip()
    topic_slug = slugify(topic)
    topic_dir = QUIZ_ROOT / topic_slug
    rng = random.Random(args.seed)

    if args.mode == "api":
        api_key = os.getenv(args.api_key_env)
        if not args.base_url or not args.model or not api_key:
            print(f"Error: api mode needs --base-url, --model and ${args.api_key_env}.", file=sys.stderr)
            return 2

    # Build every dataset in memory first so a failure halfway leaves nothing half-written.
    datasets: List[Dict[str, Any]] = []
    if args.mode == "template":
        needed = args.num_files * args.questions_per_file
        if needed > len(ANIMAL_BANK):
            print(f"Error: template bank has {len(ANIMAL_BANK)} questions, asked for {needed}.", file=sys.stderr)
            return 2
        pool = [clean_question(q) for q in ANIMAL_BANK]
        rng.shuffle(pool)
        for index in range(args.num_files):
            datasets.append(build_dataset(pool[index * args.questions_per_file:(index + 1) * args.questions_per_file], topic, args.question_seconds))
    else:
        style = STYLE_PROMPTS[args.style]
        avoid = used_subjects()
        for index in range(args.num_files):
            user_prompt = USER_PROMPT_TEMPLATE.format(
                question_count=args.questions_per_file, topic=topic,
                avoid=", ".join(avoid) or "none", style_rules=style["rules"].format(topic=topic),
            )
            try:
                response = call_openai_compatible(
                    base_url=args.base_url, api_key=api_key, model=args.model,
                    system_prompt=style["system"], user_prompt=user_prompt,
                    temperature=args.temperature, max_tokens=args.max_tokens, timeout_seconds=args.timeout_seconds,
                )
                parsed = parse_model_json(str(response["choices"][0]["message"]["content"]))
            except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError) as error:
                print(f"Error: API generation failed for file {index + 1}: {error}", file=sys.stderr)
                return 1
            questions = [q for q in (clean_question(r) for r in parsed.get("questions", [])) if q]
            if len(questions) < args.questions_per_file:
                print(f"Error: model returned {len(questions)} usable questions, expected {args.questions_per_file}.", file=sys.stderr)
                return 1
            questions = questions[:args.questions_per_file]
            avoid += [q["subject"] for q in questions if q["subject"]]
            datasets.append(build_dataset(questions, topic, args.question_seconds))

    for dataset in datasets:
        shuffle_answers(dataset["questions"], rng)
        if not args.no_images:
            for error in attach_images(dataset):
                print(f"Warning: image skipped for {error}", file=sys.stderr)

    created = []
    for path, dataset in zip(next_free_paths(topic_dir, topic_slug, len(datasets)), datasets):
        write_json(path, dataset)
        created.append(repo_rel(path))

    manifest = rebuild_manifest(default_dataset=created[0] if args.make_default else "")
    print(json.dumps({"created": created, "defaultDataset": manifest["defaultDataset"]}, indent=2))
    return 0


def command_images(args: argparse.Namespace) -> int:
    failed = 0
    for path in resolve_dataset_args(args.datasets, args.all):
        dataset = read_json(path)
        errors = attach_images(dataset, refresh=args.refresh)
        write_json(path, dataset)
        for error in errors:
            print(f"{repo_rel(path)}: image skipped for {error}", file=sys.stderr)
        failed += len(errors)
        print(f"{repo_rel(path)}: images ok" if not errors else f"{repo_rel(path)}: {len(errors)} image(s) missing")
    return 1 if failed else 0


def command_shuffle(args: argparse.Namespace) -> int:
    rng = random.Random(args.seed)
    for path in resolve_dataset_args(args.datasets, args.all):
        dataset = read_json(path)
        shuffle_answers(dataset.get("questions", []), rng)
        write_json(path, dataset)
        print(f"{repo_rel(path)}: correct slots {[q['correctIndex'] for q in dataset.get('questions', [])]}")
    return 0


def validate_dataset(path: Path) -> List[str]:
    try:
        dataset = read_json(path)
    except json.JSONDecodeError as error:
        return [f"invalid JSON: {error}"]
    questions = dataset.get("questions")
    if not isinstance(questions, list) or not questions:
        return ["no questions"]
    problems = []
    for number, q in enumerate(questions, start=1):
        answers = q.get("answers", [])
        if not str(q.get("question", "")).strip():
            problems.append(f"Q{number}: empty question")
        if not isinstance(answers, list) or not 3 <= len(answers) <= 4:
            problems.append(f"Q{number}: needs 3 or 4 answers")
        elif not isinstance(q.get("correctIndex"), int) or not 0 <= q["correctIndex"] < len(answers):
            problems.append(f"Q{number}: correctIndex out of range")
        image = q.get("imageUrl", "")
        if image and not image.startswith(("http://", "https://")) and not (REPO_ROOT / image).exists():
            problems.append(f"Q{number}: image file missing ({image})")
        if image and not image.startswith(("http://", "https://")) and not q.get("imageCredit"):
            problems.append(f"Q{number}: image has no credit")
    slots = [q.get("correctIndex") for q in questions]
    if len(questions) >= 4 and len(set(slots)) == 1:
        problems.append(f"every correct answer is in slot {slots[0]} (run: shuffle)")
    return problems


def command_validate(_args: argparse.Namespace) -> int:
    bad = 0
    for path in dataset_files():
        problems = validate_dataset(path)
        print(f"{'FAIL' if problems else 'ok  '} {repo_rel(path)}")
        for problem in problems:
            print(f"       - {problem}")
        bad += bool(problems)
    return 1 if bad else 0


def command_manifest(_args: argparse.Namespace) -> int:
    print(json.dumps(rebuild_manifest(), indent=2))
    return 0


def command_list(_args: argparse.Namespace) -> int:
    print(json.dumps(read_json(MANIFEST_PATH) if MANIFEST_PATH.exists() else {}, indent=2))
    return 0


def command_urls(args: argparse.Namespace) -> int:
    manifest = read_json(MANIFEST_PATH) if MANIFEST_PATH.exists() else {}
    urls = [f"{args.page}?dataset={urllib.parse.quote(d['path'])}" for d in manifest.get("datasets", []) if d.get("path")]
    print(json.dumps({"urls": urls}, indent=2))
    return 0


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate and manage kid-friendly quiz datasets.")
    sub = parser.add_subparsers(dest="command", required=True)

    generate = sub.add_parser("generate", help="Create new dataset files (never overwrites).")
    generate.add_argument("--topic", required=True, help="Topic label, e.g. 'Guess the Animal'")
    generate.add_argument("--num-files", type=positive_int, default=1)
    generate.add_argument("--questions-per-file", type=positive_int, default=8)
    generate.add_argument("--question-seconds", type=positive_int, default=DEFAULT_TIMING["questionSeconds"])
    generate.add_argument("--mode", choices=["template", "api"], default="template")
    generate.add_argument("--style", choices=sorted(STYLE_PROMPTS), default="animal-clue", help="Prompt style for api mode")
    generate.add_argument("--seed", type=int, default=None, help="Random seed for reproducible shuffles")
    generate.add_argument("--no-images", action="store_true", help="Skip downloading clue images")
    generate.add_argument("--make-default", action="store_true", help="Make the first new file the manifest default")
    generate.add_argument("--base-url", default="", help="OpenAI-compatible base URL, without /chat/completions")
    generate.add_argument("--model", default="")
    generate.add_argument("--api-key-env", default="OPENAI_API_KEY")
    generate.add_argument("--temperature", type=float, default=0.7)
    generate.add_argument("--max-tokens", type=positive_int, default=2000)
    generate.add_argument("--timeout-seconds", type=positive_int, default=90)
    generate.set_defaults(func=command_generate)

    for name, func, help_text in (
        ("images", command_images, "Download missing clue images (with credits) for datasets."),
        ("shuffle", command_shuffle, "Re-shuffle answer positions in datasets."),
    ):
        cmd = sub.add_parser(name, help=help_text)
        cmd.add_argument("datasets", nargs="*", help="Dataset paths relative to the repo root")
        cmd.add_argument("--all", action="store_true", help="Process every dataset")
        cmd.set_defaults(func=func)
        if name == "images":
            cmd.add_argument("--refresh", action="store_true", help="Re-resolve images even if already present")
        else:
            cmd.add_argument("--seed", type=int, default=None)

    sub.add_parser("validate", help="Check every dataset is render-ready.").set_defaults(func=command_validate)
    sub.add_parser("manifest", help="Rebuild manifest from files on disk.").set_defaults(func=command_manifest)
    sub.add_parser("list", help="Print current manifest.").set_defaults(func=command_list)
    urls = sub.add_parser("urls", help="Print dataset render URLs.")
    urls.add_argument("--page", default="index.html")
    urls.set_defaults(func=command_urls)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
