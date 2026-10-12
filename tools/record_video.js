// Render quiz datasets to YouTube-ready MP4 files.
//
//   npm run record -- --dataset asset/data/quizzes/guess-the-animal/guess-the-animal-001.json
//   npm run record -- --all --format portrait
//
// How it works: narration clips are synthesized first (tools/narrate.py, Piper TTS) and the
// quiz timing is stretched so every clip fits. The page then runs in headless Chromium with
// ?record=1 (silent, logs timeline events). Frames come from the DevTools screencast and are
// encoded to constant-frame-rate H.264. Voice and sound effects are mixed in at the exact
// event times, with the effects ducked under the voice, so audio never drifts.
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright";
import { startStaticServer } from "./static_server.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORMATS = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 }
};
const SOUNDS = {
  ticking: "asset/sound/clock-tick.mp3",
  applause: "asset/sound/applause.mp3",
  cheers: "asset/sound/cheers.mp3"
};

const { values: options } = parseArgs({
  options: {
    dataset: { type: "string", multiple: true, default: [] },
    all: { type: "boolean", default: false },
    format: { type: "string", default: "landscape" },
    fps: { type: "string", default: "30" },
    speed: { type: "string", default: "0.5" },
    "final-hold": { type: "string", default: "10" },
    music: { type: "string" },
    "music-volume": { type: "string", default: "0.12" },
    voice: { type: "string", default: "en_US-ljspeech-high" },
    "no-voice": { type: "boolean", default: false },
    "speech-rate": { type: "string", default: "1.1" },
    "no-read-answers": { type: "boolean", default: false },
    out: { type: "string", default: "output" }
  }
});

const format = FORMATS[options.format];
if (!format) {
  throw new Error(`--format must be one of: ${Object.keys(FORMATS).join(", ")}`);
}
const fps = Number(options.fps);
const finalHoldMs = Number(options["final-hold"]) * 1000;
const musicVolume = Number(options["music-volume"]);
const useVoice = !options["no-voice"];
const speed = Number(options.speed);
if (!(speed > 0 && speed <= 1)) {
  throw new Error("--speed must be between 0 (exclusive) and 1");
}

// How long after each page event its narration clip starts, and the minimum silence kept after it.
const VOICE_OFFSET_MS = { intro: 300, question: 400, reveal: 250, final: 600 };
const THINKING_TIME_MS = 3000;
const AFTER_REVEAL_MS = 900;

const readJson = async (relativePath) => JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));

const datasetPaths = options.all
  ? (await readJson("asset/data/quizzes/manifest.json")).datasets.map((item) => item.path)
  : options.dataset;
if (datasetPaths.length === 0) {
  throw new Error("Pass --dataset <path> (repeatable) or --all.");
}

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
  });

// Screencast frames arrive only when the page repaints, at whatever rate the machine manages.
// Encoding live competes with Chromium for CPU, so frames go to disk with their timestamps
// and are encoded afterwards into constant-frame-rate video.
const createFrameStore = (dir) => {
  const frames = [];
  const writes = [];
  return {
    // Map slow-motion capture times onto video time (see --speed).
    rescale(originMs, factor) {
      frames.forEach((frame) => {
        frame.timeMs = originMs + (frame.timeMs - originMs) * factor;
      });
    },
    add(buffer, timeMs) {
      const file = path.join(dir, `${String(frames.length).padStart(6, "0")}.jpg`);
      frames.push({ file, timeMs });
      writes.push(writeFile(file, buffer));
    },
    // Build an ffmpeg concat list covering [startMs, endMs]; each frame lasts until the next one.
    async writeConcatList(listPath, startMs, endMs) {
      await Promise.all(writes);
      const firstIndex = Math.max(0, frames.findLastIndex((frame) => frame.timeMs <= startMs));
      const used = frames.slice(firstIndex).filter((frame) => frame.timeMs < endMs);
      if (used.length === 0) {
        throw new Error("no frames were captured");
      }
      const lines = ["ffconcat version 1.0"];
      used.forEach((frame, i) => {
        const from = Math.max(frame.timeMs, startMs);
        const to = i + 1 < used.length ? used[i + 1].timeMs : endMs;
        lines.push(`file '${frame.file}'`, `duration ${((to - from) / 1000).toFixed(4)}`);
      });
      // The concat demuxer ignores the last entry's duration unless the file is repeated.
      lines.push(`file '${used[used.length - 1].file}'`);
      await writeFile(listPath, `${lines.join("\n")}\n`);
      return used.length;
    }
  };
};

const synthesizeNarration = async (lines) => {
  const python = path.join(repoRoot, ".venv", "bin", "python");
  try {
    await access(python);
  } catch {
    throw new Error("Narration needs the Python venv: run `uv venv .venv && uv pip install --python .venv/bin/python piper-tts` (or pass --no-voice).");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(repoRoot, "tools", "narrate.py")], { stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`narrate.py exited with code ${code}`))));
    child.stdin.end(JSON.stringify({ voice: options.voice, lengthScale: Number(options["speech-rate"]), lines }));
  });
};

const narrationLines = (dataset) => {
  const lines = [];
  const intro = dataset.content?.intro || {};
  lines.push({ id: "intro", text: [intro.title && `${intro.title}!`, intro.message].filter(Boolean).join(" ") });
  dataset.questions.forEach((question, i) => {
    const answers = question.answers.map(String);
    const choices = `Is it ${answers.slice(0, -1).join(", ")}, or ${answers.at(-1)}?`;
    lines.push({ id: `question${i}`, text: options["no-read-answers"] ? question.question : `${question.question} ${choices}` });
    const answer = answers[question.correctIndex];
    lines.push({ id: `reveal${i}`, text: `The answer is ${answer}! ${question.fact || ""}`.trim() });
  });
  const final = dataset.content?.final || {};
  lines.push({ id: "final", text: [final.title, final.message].filter(Boolean).join(" ") });
  return lines.filter((line) => line.text);
};

// Stretch the dataset's timing so each narration clip fits inside the moment it belongs to.
const fitTimingToNarration = (dataset, clips) => {
  const timing = dataset.timing || {};
  const baseQuestionSeconds = timing.questionSeconds || 10;
  const baseRevealMs = timing.revealDurationMs || 3500;
  const clipMs = (id) => clips[id]?.durationMs || 0;
  return {
    ...dataset,
    timing: {
      ...timing,
      introDelayMs: Math.max(timing.introDelayMs || 3000, VOICE_OFFSET_MS.intro + clipMs("intro") + 700)
    },
    questions: dataset.questions.map((question, i) => ({
      ...question,
      timing: {
        questionSeconds: Math.max(baseQuestionSeconds, Math.ceil((VOICE_OFFSET_MS.question + clipMs(`question${i}`) + THINKING_TIME_MS) / 1000)),
        revealDurationMs: Math.max(baseRevealMs, VOICE_OFFSET_MS.reveal + clipMs(`reveal${i}`) + AFTER_REVEAL_MS)
      }
    }))
  };
};

const formatTimestamp = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
};

const buildAudioMix = (events, startMs, totalMs, clips) => {
  const at = (event) => event.time - startMs;
  const questions = events.filter((event) => event.type === "question");
  const reveals = events.filter((event) => event.type === "reveal");
  const intro = events.find((event) => event.type === "intro");
  const final = events.find((event) => event.type === "final");
  // Input 0 is the silent video; tick and music loop so they can cover any segment length.
  const inputs = [
    { file: SOUNDS.ticking, loop: true },
    { file: SOUNDS.applause },
    { file: SOUNDS.cheers }
  ];
  const addInput = (file, loop = false) => inputs.push({ file, loop });
  const filters = [];
  const fxLabels = [];
  const voiceLabels = [];
  const place = (label, delayMs) => `adelay=${Math.round(Math.max(0, delayMs))}:all=1[${label}]`;

  filters.push(`[1:a]asplit=${questions.length}${questions.map((_, i) => `[tick${i}]`).join("")}`);
  filters.push(`[2:a]asplit=${reveals.length}${reveals.map((_, i) => `[clap${i}]`).join("")}`);
  questions.forEach((question, i) => {
    const reveal = reveals.find((event) => event.index === question.index);
    const lengthS = ((reveal ? at(reveal) : totalMs) - at(question)) / 1000;
    filters.push(`[tick${i}]atrim=0:${lengthS.toFixed(3)},${place(`t${i}`, at(question))}`);
    fxLabels.push(`[t${i}]`);
  });
  reveals.forEach((reveal, i) => {
    const next = questions.find((event) => event.index === reveal.index + 1) || final;
    const lengthS = ((next ? at(next) : totalMs) - at(reveal)) / 1000;
    const fadeStart = Math.max(0, lengthS - 0.4);
    filters.push(`[clap${i}]atrim=0:${lengthS.toFixed(3)},afade=t=out:st=${fadeStart.toFixed(3)}:d=0.4,${place(`a${i}`, at(reveal))}`);
    fxLabels.push(`[a${i}]`);
  });
  if (final) {
    filters.push(`[3:a]${place("cheer", at(final))}`);
    fxLabels.push("[cheer]");
  }
  if (options.music) {
    addInput(options.music, true);
    filters.push(`[${inputs.length}:a]volume=${musicVolume},atrim=0:${(totalMs / 1000).toFixed(3)},afade=t=out:st=${Math.max(0, totalMs / 1000 - 2).toFixed(3)}:d=2[music]`);
    fxLabels.push("[music]");
  }

  const placeVoice = (id, event, offsetMs) => {
    if (!clips[id] || !event) {
      return;
    }
    addInput(clips[id].path);
    filters.push(`[${inputs.length}:a]aresample=44100,${place(`v_${id}`, at(event) + offsetMs)}`);
    voiceLabels.push(`[v_${id}]`);
  };
  placeVoice("intro", intro, VOICE_OFFSET_MS.intro);
  questions.forEach((event) => placeVoice(`question${event.index}`, event, VOICE_OFFSET_MS.question));
  reveals.forEach((event) => placeVoice(`reveal${event.index}`, event, VOICE_OFFSET_MS.reveal));
  placeVoice("final", final, VOICE_OFFSET_MS.final);

  filters.push(`${fxLabels.join("")}amix=inputs=${fxLabels.length}:normalize=0:duration=longest[fx]`);
  if (voiceLabels.length > 0) {
    // Duck the effects and music whenever the narrator speaks.
    filters.push(`${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0:duration=longest,aformat=channel_layouts=stereo,asplit=2[vkey][vout]`);
    filters.push("[fx][vkey]sidechaincompress=threshold=0.02:ratio=8:attack=10:release=400[fxduck]");
    filters.push("[fxduck][vout]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95[mix]");
  } else {
    filters.push("[fx]alimiter=limit=0.95[mix]");
  }

  const inputArgs = inputs.flatMap(({ file, loop }) => [...(loop ? ["-stream_loop", "-1"] : []), "-i", path.resolve(repoRoot, file)]);
  return { inputArgs, filter: filters.join(";") };
};

const buildDescription = (dataset, events, startMs) => {
  const lines = [];
  const title = dataset.content?.intro?.title || "Kids Quiz";
  lines.push(`${title} | Fun Quiz for Kids with Pictures and Fun Facts`, "");
  lines.push("Can you guess them all? Pause the video if you need more time!", "");
  lines.push("0:00 Intro");
  events
    .filter((event) => event.type === "question")
    .forEach((event) => lines.push(`${formatTimestamp(event.time - startMs)} Question ${event.index + 1}`));
  const final = events.find((event) => event.type === "final");
  if (final) {
    lines.push(`${formatTimestamp(final.time - startMs)} Results`);
  }

  const credits = dataset.questions.map((question) => question.imageCredit).filter(Boolean);
  if (credits.length > 0) {
    lines.push("", "Photo credits (via Wikimedia Commons):");
    const seen = new Set();
    for (const credit of credits) {
      if (seen.has(credit.source)) {
        continue;
      }
      seen.add(credit.source);
      lines.push(`- "${credit.file}" by ${credit.author}, ${credit.license}, ${credit.source}`);
    }
  }
  return `${lines.join("\n")}\n`;
};

const recordDataset = async (browser, baseUrl, datasetPath) => {
  const dataset = await readJson(datasetPath);
  const name = `${path.basename(datasetPath, ".json")}-${options.format}`;
  const outDir = path.join(repoRoot, options.out, name);
  await mkdir(outDir, { recursive: true });

  let clips = {};
  let renderDataset = dataset;
  let holdMs = finalHoldMs;
  if (useVoice) {
    console.log(`  narrating with ${options.voice} ...`);
    clips = await synthesizeNarration(narrationLines(dataset));
    renderDataset = fitTimingToNarration(dataset, clips);
    holdMs = Math.max(finalHoldMs, VOICE_OFFSET_MS.final + (clips.final?.durationMs || 0) + 2500);
  }
  // The page loads this copy, so timing tweaks never touch the reviewed dataset.
  const renderDatasetPath = path.join(outDir, "dataset.render.json");
  await writeFile(renderDatasetPath, `${JSON.stringify(renderDataset, null, 2)}\n`);
  const silentVideo = path.join(outDir, "video-silent.mp4");
  const framesDir = path.join(outDir, "frames");
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir);
  const frameStore = createFrameStore(framesDir);
  const finalVideo = path.join(outDir, `${name}.mp4`);

  const context = await browser.newContext({ viewport: format, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const events = [];
  let resolveFinal;
  const finalSeen = new Promise((resolve) => {
    resolveFinal = resolve;
  });
  let startMs = null;

  await page.exposeFunction("__quizEvent", (event) => {
    events.push(event);
    if (event.type === "intro" && startMs === null) {
      startMs = event.time;
    }
    if (event.type === "error") {
      resolveFinal(new Error(`page reported an error: ${event.reason}`));
    }
    if (event.type === "final") {
      resolveFinal();
    }
  });
  page.on("pageerror", (error) => console.error(`  page error: ${error.message}`));

  const cdp = await context.newCDPSession(page);
  // Slow CSS animations and transitions to match the page's slowed timers.
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: speed });
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    frameStore.add(Buffer.from(data, "base64"), metadata.timestamp * 1000);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: format.width, maxHeight: format.height, everyNthFrame: 1 });

  const pageDatasetPath = path.relative(repoRoot, renderDatasetPath).split(path.sep).join("/");
  const url = `${baseUrl}/index.html?record=1&speed=${speed}&dataset=${encodeURIComponent(pageDatasetPath)}`;
  await page.goto(url, { waitUntil: "load" });

  // Thumbnail: the first question, a moment after it appears (before the answer is shown).
  const firstQuestion = new Promise((resolve) => {
    const check = setInterval(() => {
      if (events.some((event) => event.type === "question")) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
  await firstQuestion;
  await page.waitForTimeout(1200 / speed);
  await page.screenshot({ path: path.join(outDir, "thumbnail.jpg"), type: "jpeg", quality: 90 });

  const result = await finalSeen;
  if (result instanceof Error) {
    throw result;
  }
  await page.waitForTimeout(holdMs / speed);
  await cdp.send("Page.stopScreencast");
  await context.close();

  // From here on, all times are video times.
  events.forEach((event) => {
    event.time = startMs + (event.time - startMs) * speed;
  });
  frameStore.rescale(startMs, speed);
  const endMs = events.find((event) => event.type === "final").time + holdMs;

  const concatList = path.join(framesDir, "frames.ffconcat");
  const frameCount = await frameStore.writeConcatList(concatList, startMs, endMs);
  await run(["-f", "concat", "-safe", "0", "-i", concatList,
    "-vf", `fps=${fps},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", silentVideo]);
  await rm(framesDir, { recursive: true });

  const totalMs = endMs - startMs;
  const { inputArgs, filter } = buildAudioMix(events, startMs, totalMs, clips);
  await run([
    "-i", silentVideo, ...inputArgs,
    "-filter_complex", filter,
    "-map", "0:v", "-map", "[mix]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-t", (totalMs / 1000).toFixed(3), "-movflags", "+faststart",
    finalVideo
  ]);
  await rm(silentVideo);
  await rm(renderDatasetPath);
  await writeFile(path.join(outDir, "description.txt"), buildDescription(dataset, events, startMs));
  return { finalVideo, seconds: totalMs / 1000, captureFps: frameCount / (totalMs / 1000) };
};

const { server, port } = await startStaticServer(repoRoot);
const browser = await chromium.launch();
let failures = 0;
try {
  for (const datasetPath of datasetPaths) {
    console.log(`Recording ${datasetPath} (${options.format}) ...`);
    try {
      const { finalVideo, seconds, captureFps } = await recordDataset(browser, `http://127.0.0.1:${port}`, datasetPath);
      console.log(`  done: ${path.relative(repoRoot, finalVideo)} (${seconds.toFixed(1)}s, captured ${captureFps.toFixed(1)} fps)`);
    } catch (error) {
      failures += 1;
      console.error(`  failed: ${error.message}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
process.exitCode = failures ? 1 : 0;
