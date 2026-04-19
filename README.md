# One Page Quiz Application

Frontend quiz renderer + Python quiz-data generation pipeline.

The frontend (`index.html`, `index2.html` + `asset/js/quiz-engine.js`) **does not generate questions**. It only renders dataset JSON files.

---

## 1) Project Overview

- Render a quiz screen from dataset JSON.
- Keep question generation in Python for easier maintenance and review.
- Organize datasets by topic under `asset/data/quizzes/`.
- Support automation by passing dataset file in page query param:
  - `index.html?dataset=asset/data/quizzes/python/python-001.json`

---

## 2) Folder Structure

- `index.html` — original UI shell
- `index2.html` — modern hook + iframe quiz UI shell
- `asset/js/quiz-engine.js` — quiz runtime logic
- `asset/img/quiz-bg.gif` — animated background used by `index2.html`
- `asset/data/quizzes/manifest.json` — dataset index + default
- `asset/data/quizzes/<topic>/<topic>-NNN.json` — quiz datasets
- `tools/quiz_data_generator.py` — reusable Python generator/manager CLI
- `tools/render_cycle.ps1` — iterate dataset URLs for recording workflows

---

## 3) Dataset JSON Contract

Each dataset file should be render-ready and include:

```json
{
  "questions": [
    {
      "question": "string",
      "answers": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "host": "optional short line",
      "imageUrl": "optional iframe image URL"
    }
  ],
  "timing": {
    "questionSeconds": 7,
    "revealDurationMs": 2000,
    "introDelayMs": 3000,
    "urgentThresholdSeconds": 4,
    "tickIntervalMs": 1000
  },
  "content": {
    "intro": { "title": "Quiz", "message": "..." },
    "final": { "title": "Quiz complete!", "message": "..." }
  },
  "theme": { "name": "primary-play" }
}
```

Notes:
- `questions` is required.
- `answers` can have 3 or 4 options.
- `correctIndex` must point to one valid answer.
- `imageUrl` is optional and used by `index2.html` to populate the media iframe.

---

## 4) How the Frontend Selects a Dataset

Selection order:
1. `dataset` query parameter (if provided)
2. `defaultDataset` in `asset/data/quizzes/manifest.json`
3. first `datasets[]` entry in manifest
4. fallback: `asset/data/quizzes/general/general-001.json`

Examples:
- `index.html?dataset=asset/data/quizzes/general/general-001.json`
- `index.html?dataset=asset/data/quizzes/python/python-003.json`
- `index2.html?dataset=asset/data/quizzes/general/general-001.json`

---

## 5) Generate Quiz Data (Python)

Script:
- `tools/quiz_data_generator.py`

### 5.1 Template mode (offline placeholders)

```bash
python tools/quiz_data_generator.py generate --topic Python --num-files 5 --questions-per-file 4 --question-seconds 7 --mode template
```

### 5.2 API mode (OpenAI-compatible)

Set key first:

```powershell
$env:OPENAI_API_KEY="your_api_key_here"
```

Generate:

```bash
python tools/quiz_data_generator.py generate --topic Python --num-files 5 --questions-per-file 4 --question-seconds 7 --mode api --base-url https://api.openai.com/v1 --model gpt-4o-mini
```

What it does:
- Creates topic folder if missing.
- Writes files as `<topic>-001.json`, `<topic>-002.json`, etc.
- Rebuilds `asset/data/quizzes/manifest.json`.

### 5.3 Other generator commands

```bash
python tools/quiz_data_generator.py list
python tools/quiz_data_generator.py manifest
python tools/quiz_data_generator.py urls --page index.html
```

- `list`: print current manifest.
- `manifest`: rebuild manifest from files on disk.
- `urls`: print dataset URLs for render automation.

---

## 6) Manual Review Workflow (Recommended)

1. Generate datasets with Python.
2. Open JSON files in `asset/data/quizzes/<topic>/`.
3. Refine wording, options, and `correctIndex` manually.
4. Re-run:

```bash
python tools/quiz_data_generator.py manifest
```

5. Render and validate via `dataset` param.

---

## 7) How to Test `index.html` and `index2.html`

### 7.1 Start a local server (recommended)

From repository root:

```bash
python -m http.server 5500
```

Open in browser:
- `http://localhost:5500/index.html`
- `http://localhost:5500/index.html?dataset=asset/data/quizzes/python/python-001.json`
- `http://localhost:5500/index2.html`
- `http://localhost:5500/index2.html?dataset=asset/data/quizzes/python/python-001.json`

### 7.2 What to verify

- Page loads without `Quiz setup error`.
- Selected dataset is rendered when `dataset` param changes.
- Timer follows dataset value (`timing.questionSeconds`).
- Theme/content overrides display correctly.
- On `index2.html`, iframe media updates from `questions[].imageUrl` when present.

### 7.3 One-command local start (PowerShell)

Use the helper script to start the server and open the landing page automatically:

```powershell
powershell -ExecutionPolicy Bypass -File tools/start_server.ps1
```

Common options:

```powershell
# Custom port
powershell -ExecutionPolicy Bypass -File tools/start_server.ps1 -Port 5501

# Open a specific dataset
powershell -ExecutionPolicy Bypass -File tools/start_server.ps1 -Dataset "asset/data/quizzes/python/python-001.json"

# Start without opening browser
powershell -ExecutionPolicy Bypass -File tools/start_server.ps1 -NoOpen
```

The script prints a server PID. Stop the server with:

```powershell
Stop-Process -Id <PID>
```

---

## 8) Recording / Iteration Helper

Script:
- `tools/render_cycle.ps1`

Examples:

```powershell
# Print dataset URLs from manifest
powershell -ExecutionPolicy Bypass -File tools/render_cycle.ps1 -Mode print

# Open each URL in default browser (for recording workflows)
powershell -ExecutionPolicy Bypass -File tools/render_cycle.ps1 -Mode open -BaseUrl http://localhost:5500 -DelaySeconds 1

# Start at index 1 and process only 3 datasets
powershell -ExecutionPolicy Bypass -File tools/render_cycle.ps1 -Mode print -StartIndex 1 -Limit 3
```

Parameters:
- `-ManifestPath` (default `asset/data/quizzes/manifest.json`)
- `-PagePath` (default `index.html`)
- `-BaseUrl` (optional, e.g. `http://localhost:5500`)
- `-Mode` (`print` or `open`)
- `-DelaySeconds` delay between opens in `open` mode
- `-Limit` max datasets to process
- `-StartIndex` starting dataset index

---

## 9) Troubleshooting

- **Quiz setup error**
  - Ensure server is running (`python -m http.server 5500`).
  - Confirm dataset path exists.
  - Confirm JSON is valid.

- **Dataset not found**
  - Check `dataset` query param spelling.
  - Rebuild manifest: `python tools/quiz_data_generator.py manifest`.

- **API generation fails**
  - Verify `OPENAI_API_KEY` is set.
  - Verify `--base-url` and `--model`.
  - Try `--mode template` to continue offline.

---

## 10) Quick Start

```bash
python tools/quiz_data_generator.py generate --topic Python --num-files 5 --questions-per-file 4 --question-seconds 7 --mode template
python -m http.server 5500
```

Open:

- `http://localhost:5500/index.html?dataset=asset/data/quizzes/python/python-001.json`
- `http://localhost:5500/index2.html?dataset=asset/data/quizzes/python/python-001.json`

python tools/quiz_data_generator.py generate --topic "Generative Ai" --num-files 2 --questions-per-file 2 --question-seconds 7 --mode api
