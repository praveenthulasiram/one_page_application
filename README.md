# Kids Quiz Video Maker

Turns quiz datasets (JSON) into YouTube-ready videos for kids: an auto-playing quiz page
rendered in headless Chromium, with a narrator voice, sound effects, a thumbnail and a
ready-to-paste description.

```
tools/quiz_data_generator.py  ->  asset/data/quizzes/<topic>/<topic>-NNN.json  ->  tools/record_video.js  ->  output/<name>/
       (questions + images)              (reviewable data)                          (headless render)          mp4, thumbnail, description
```

The page (`index.html` + `asset/js/quiz-engine.js`) never invents content; it only plays a dataset.

---

## 1) Setup (WSL / Ubuntu)

Requirements: Python 3.10+, Node.js 18+ and [uv](https://docs.astral.sh/uv/).

```bash
npm install                                         # Playwright + a bundled ffmpeg
npx playwright install chromium                     # headless browser (~120 MB, in ~/.cache/ms-playwright)
sudo env "PATH=$PATH" npx playwright install-deps chromium   # one-time: Chromium's Linux libraries
uv venv .venv && uv pip install --python .venv/bin/python piper-tts   # offline narrator voice
```

Voices download on first use into `.cache/voices/` (60–115 MB each); narration clips are cached
in `.cache/narration/`, so re-rendering only synthesizes lines that changed.

---

## 2) Make a video

```bash
# 16:9 video for the main channel
npm run record -- --dataset asset/data/quizzes/guess-the-animal/guess-the-animal-001.json

# 9:16 YouTube Short (keeps content out of the Shorts caption/button overlay)
npm run record -- --dataset asset/data/quizzes/guess-the-animal/guess-the-animal-001.json --format portrait

# every dataset in the manifest
npm run record -- --all
```

Output lands in `output/<dataset>-<format>/`:

| File | Use |
| --- | --- |
| `<name>.mp4` | H.264 + AAC, 30 fps, 1080p — upload as is |
| `thumbnail.jpg` | First question, before the answer is shown |
| `description.txt` | Title, chapter timestamps and the **photo credits you must include** |

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--format` | `landscape` | `landscape` (1920×1080) or `portrait` (1080×1920) |
| `--final-hold` | `10` | Seconds to keep the end screen (room for YouTube end-screen elements) |
| `--music <file.mp3>` | none | Background music, looped and faded out |
| `--music-volume` | `0.12` | Music level under the sound effects |
| `--voice` | `en_US-ljspeech-high` | Piper voice name (see "Narration" below) |
| `--speech-rate` | `1.1` | Piper length scale: higher is slower (1.0 = natural speed) |
| `--no-read-answers` | off | Read only the question, not "Is it A, B, C, or D?" |
| `--no-voice` | off | Render without narration |
| `--fps` | `30` | Output frame rate |
| `--speed` | `0.5` | Slow-motion capture factor; `1` renders in real time (faster, but may be choppy) |
| `--out` | `output` | Output folder |

The page is captured in slow motion (`--speed 0.5`: timers and CSS animations run at half speed)
and the video is sped back up, so motion stays smooth even on a slow or busy machine. A 2.5-minute
quiz takes about 12 minutes to render; use `--speed 1` for quick drafts.

### Narration

The narrator reads the intro, each question with its choices, "The answer is …!" plus the fun fact,
and the closing line. Timing stretches automatically so every line fits and kids still get
3 seconds of thinking time after the choices are read. Sound effects and music duck under the voice.

Voices with licences that allow use on a monetized channel:

| Voice | Accent | Dataset licence |
| --- | --- | --- |
| `en_US-ljspeech-high` (default) | US | Public domain |
| `en_US-kristin-medium` | US | Public domain |
| `en_GB-cori-high` | British | Public domain |
| `en_US-libritts_r-medium` | US (multi-speaker) | CC BY 4.0 — credit "LibriTTS-R" in the description |

Avoid `en_US-lessac-*` and `en_US-hfc_female-*` for monetized videos: their datasets are non-commercial.
Check the voice's `MODEL_CARD` on [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) before adding others.

---

## 3) Preview in a browser

```bash
npm run serve
```

Then open `http://localhost:5500/index.html?dataset=asset/data/quizzes/guess-the-animal/guess-the-animal-001.json`.
Click the intro screen once so the browser allows sound.

---

## 4) Create quiz content

```bash
# Offline: 3 files x 8 questions from the built-in curated animal bank (24 animals)
python3 tools/quiz_data_generator.py generate --topic "Guess the Animal" --num-files 3 --questions-per-file 8

# With an LLM (any OpenAI-compatible endpoint)
export OPENAI_API_KEY=...
python3 tools/quiz_data_generator.py generate --topic "Ocean Animals" --mode api \
  --base-url https://api.openai.com/v1 --model gpt-4o-mini --num-files 2
python3 tools/quiz_data_generator.py generate --topic "Space" --style general --mode api ...
```

What `generate` does:
- Writes **new** files (`<topic>-004.json`, …); existing files are never overwritten, so manual edits are safe.
- Shuffles answers so the correct option is spread across A–D (pass `--seed` for repeatable output).
- Looks up each question's `subject` on Wikipedia, downloads the lead photo into `asset/img/quiz/`
  and records author + licence in `imageCredit` (also cached in `asset/img/quiz/credits.json`).
- Rebuilds `asset/data/quizzes/manifest.json` (`--make-default` makes the first new file the default).

Other commands:

```bash
python3 tools/quiz_data_generator.py validate             # check every dataset is render-ready
python3 tools/quiz_data_generator.py images --all         # fetch missing images
python3 tools/quiz_data_generator.py shuffle <file.json>  # re-shuffle answer positions
python3 tools/quiz_data_generator.py manifest             # rebuild manifest from disk
python3 tools/quiz_data_generator.py list | urls
```

**Always review generated questions before publishing**: one wrong "fact" in a kids' video costs trust.

---

## 5) Dataset format

```json
{
  "questions": [
    {
      "question": "I have eight arms and can squirt ink. Who am I?",
      "answers": ["Jellyfish", "Octopus", "Starfish", "Turtle"],
      "correctIndex": 1,
      "fact": "An octopus has three hearts!",
      "subject": "Common octopus",
      "imageUrl": "asset/img/quiz/common-octopus.jpg",
      "imageCredit": { "file": "...", "author": "...", "license": "CC BY-SA 4.0", "source": "https://commons.wikimedia.org/..." }
    }
  ],
  "timing": { "questionSeconds": 10, "revealDurationMs": 3500, "introDelayMs": 3000, "urgentThresholdSeconds": 3 },
  "content": {
    "intro": { "title": "Guess the Animal Quiz", "message": "Can you guess them all?" },
    "final": { "title": "Great guessing!", "message": "How many did you get right?" }
  },
  "theme": { "overrides": { "orange": "#ff5a8a" } }
}
```

- `questions` is required; each needs 3 or 4 `answers` and a valid `correctIndex`.
- `fact` is shown in a banner when the answer is revealed (falls back to "It's <answer>!").
- `imageUrl` may be a local path or an http(s) URL; questions without one hide the picture panel.
- A question may carry its own `timing` (`questionSeconds`, `revealDurationMs`); the recorder uses this to fit narration.
- `theme.overrides` sets CSS custom properties of `index.html` (e.g. `orange`, `option-yellow`, `frame-blue`).

The page picks a dataset from `?dataset=<path>`, else the manifest's `defaultDataset`, else its first entry.
`?record=1` makes the page silent and log timeline events for the recorder.

---

## 6) Troubleshooting

- **`libnspr4.so: cannot open shared object file`** — run the `install-deps` command from Setup.
- **"Quiz setup error" on the page** — the dataset path is wrong or the JSON is invalid; run `validate`.
- **Image skipped for <subject>** — that Wikipedia article has no lead image; change `subject` to a nearby
  article (e.g. "Frog") and run `images <file>`.
- **API generation fails** — check `OPENAI_API_KEY`, `--base-url`, `--model`; template mode works offline.
