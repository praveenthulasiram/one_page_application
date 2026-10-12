(() => {
  const DEFAULT_TIMING = {
    questionSeconds: 10,
    revealDurationMs: 3500,
    introDelayMs: 3000,
    urgentThresholdSeconds: 3
  };
  const DEFAULT_CONTENT = {
    intro: { title: "Quiz", message: "Get ready for the first question." },
    final: { title: "Great job!", message: "How many did you get right?" }
  };
  const DEFAULT_SOUND_PATHS = {
    ticking: "asset/sound/clock-tick.mp3",
    applause: "asset/sound/applause.mp3",
    cheers: "asset/sound/cheers.mp3"
  };
  const DEFAULT_MANIFEST_PATH = "asset/data/quizzes/manifest.json";
  const TIMER_REFRESH_MS = 100;
  const TRANSITION_MS = 260;
  const PRELOAD_TIMEOUT_MS = 10000;

  const params = new URLSearchParams(window.location.search);
  // Record mode: the video recorder mixes sound itself, so the page stays silent and logs timeline events instead.
  const recordMode = params.get("record") === "1";
  // ?speed=0.5 plays the whole quiz in slow motion; the recorder captures it slowly for more frames
  // per video second and speeds the result back up. CSS animations are slowed by the recorder via DevTools.
  const speed = Math.min(1, Math.max(0.1, Number(params.get("speed")) || 1));
  const scaled = (ms) => ms / speed;
  const recorder = { recordMode, events: [], done: false };
  window.quizRecorder = recorder;
  const emit = (type, detail = {}) => {
    const event = { type, time: Date.now(), ...detail };
    recorder.events.push(event);
    // Exposed by tools/record_video.js so the recorder sees events the moment they happen.
    if (typeof window.__quizEvent === "function") {
      window.__quizEvent(event);
    }
  };

  const toPositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  // Allow http(s) and same-site relative paths; reject javascript:, data: and other schemes.
  const sanitizeMediaUrl = (value) => {
    const source = String(value ?? "").trim();
    if (!source) {
      return "";
    }
    if (/^https?:\/\//i.test(source) || !/^[a-z][a-z0-9+.-]*:/i.test(source)) {
      return source;
    }
    return "";
  };

  const normalizeQuestions = (questions, answerSlots) => {
    if (!Array.isArray(questions)) {
      return [];
    }
    return questions
      .map((item) => ({
        question: String(item?.question ?? "").trim(),
        answers: Array.isArray(item?.answers) ? item.answers.slice(0, answerSlots).map((answer) => String(answer)) : [],
        correctIndex: Number.isInteger(item?.correctIndex) ? item.correctIndex : -1,
        fact: String(item?.fact ?? "").trim(),
        imageUrl: sanitizeMediaUrl(item?.imageUrl),
        // Optional per-question timing, e.g. set by the recorder so narration always fits.
        questionSeconds: toPositiveNumber(item?.timing?.questionSeconds, 0),
        revealDurationMs: toPositiveNumber(item?.timing?.revealDurationMs, 0)
      }))
      .filter((item) => item.question && item.answers.length > 0 && item.correctIndex >= 0 && item.correctIndex < item.answers.length);
  };

  const mergeContent = (content) => ({
    intro: {
      title: content?.intro?.title ?? DEFAULT_CONTENT.intro.title,
      message: content?.intro?.message ?? DEFAULT_CONTENT.intro.message
    },
    final: {
      title: content?.final?.title ?? DEFAULT_CONTENT.final.title,
      message: content?.final?.message ?? DEFAULT_CONTENT.final.message
    }
  });

  // Datasets may override any CSS custom property on the page, e.g. { "theme": { "overrides": { "orange": "#ff5a8a" } } }.
  const applyThemeOverrides = (themeConfig) => {
    const overrides = themeConfig?.overrides && typeof themeConfig.overrides === "object" ? themeConfig.overrides : {};
    Object.entries(overrides).forEach(([key, value]) => {
      const token = String(key || "").trim();
      if (token) {
        document.documentElement.style.setProperty(token.startsWith("--") ? token : `--${token}`, String(value));
      }
    });
  };

  const preloadImage = (url) =>
    new Promise((resolve) => {
      const image = new Image();
      image.onload = image.onerror = () => resolve();
      image.src = url;
    });

  // Wait for fonts and every clue image so no frame of a recording shows a half-loaded screen.
  const preloadAssets = (questionBank) => {
    const images = [...new Set(questionBank.map((item) => item.imageUrl).filter(Boolean))];
    const loads = Promise.all([document.fonts?.ready, ...images.map(preloadImage)]);
    return Promise.race([loads, new Promise((resolve) => setTimeout(resolve, PRELOAD_TIMEOUT_MS))]);
  };

  const fetchJson = async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`http_${response.status} for ${path}`);
    }
    return response.json();
  };

  // Selection order: ?dataset= query param, then manifest default, then the first manifest entry.
  const resolveDatasetPath = async () => {
    const requested = (params.get("dataset") || "").trim();
    if (requested) {
      return requested;
    }
    const manifest = await fetchJson(DEFAULT_MANIFEST_PATH);
    const fallback = manifest?.defaultDataset || manifest?.datasets?.[0]?.path;
    if (!fallback) {
      throw new Error("manifest lists no datasets");
    }
    return String(fallback).trim();
  };

  let activeCleanup = null;

  window.initializeQuiz = (config = {}) => {
    if (typeof activeCleanup === "function") {
      activeCleanup();
      activeCleanup = null;
    }

    const byId = (id) => document.getElementById(id);
    const timerBar = byId("timerBar");
    const timerText = byId("timerText");
    const progressEl = document.querySelector(".progress");
    const timerWrap = document.querySelector(".timer-wrap");
    const quizShell = document.querySelector(".quiz-shell");
    const introScreen = byId("introScreen");
    const finalScreen = byId("finalScreen");
    const questionText = byId("questionText");
    const questionPill = byId("questionPill");
    const hostLine = byId("hostLine");
    const mediaImage = byId("questionMediaFrame");
    const answerButtons = [0, 1, 2, 3].map((index) => byId(`answer${index}`)).filter(Boolean);
    const numberOnlyPill = String(quizShell?.dataset?.questionPill || "").trim().toLowerCase() === "number-only";

    if (!timerBar || !timerText || !progressEl || !timerWrap || !quizShell || !questionText || !questionPill || !hostLine || answerButtons.length === 0) {
      return { ok: false, reason: "missing_dom_elements" };
    }

    const timing = {
      questionSeconds: toPositiveNumber(config?.timing?.questionSeconds, DEFAULT_TIMING.questionSeconds),
      revealDurationMs: toPositiveNumber(config?.timing?.revealDurationMs, DEFAULT_TIMING.revealDurationMs),
      introDelayMs: toPositiveNumber(config?.timing?.introDelayMs, DEFAULT_TIMING.introDelayMs),
      urgentThresholdSeconds: toPositiveNumber(config?.timing?.urgentThresholdSeconds, DEFAULT_TIMING.urgentThresholdSeconds)
    };
    const content = mergeContent(config?.content);
    const questionBank = normalizeQuestions(config?.questions, answerButtons.length);
    applyThemeOverrides(config?.theme);

    const setText = (id, text) => {
      const element = byId(id);
      if (element) {
        element.textContent = text;
      }
    };
    setText("introTitle", content.intro.title);
    setText("introMessage", content.intro.message);
    setText("finalTitle", content.final.title);
    setText("finalMessage", content.final.message);

    if (questionBank.length === 0) {
      emit("error", { reason: "no_questions" });
      return { ok: false, reason: "no_questions" };
    }

    const soundPaths = { ...DEFAULT_SOUND_PATHS, ...(config?.sounds || {}) };
    const sounds = Object.fromEntries(
      Object.entries(soundPaths).map(([name, path]) => {
        const audio = new Audio(path);
        audio.preload = "auto";
        audio.muted = recordMode;
        return [name, audio];
      })
    );
    sounds.ticking.loop = true;

    let questionIndex = 0;
    let deadline = 0;
    let phase = "intro"; // intro -> question -> reveal -> ... -> final
    let audioReady = false;
    let timerInterval;
    let revealTimeout;
    let introTimeout;
    const disposers = [];

    const playSound = (sound) => {
      if (recordMode || !sound) {
        return;
      }
      sound.pause();
      sound.currentTime = 0;
      sound.play().catch(() => {});
    };

    const stopSound = (sound) => {
      sound.pause();
      sound.currentTime = 0;
    };

    const stopAllSounds = () => Object.values(sounds).forEach(stopSound);

    // Browsers block audio until the first user gesture; play each sound muted once to unlock it.
    const unlockAudio = async () => {
      if (audioReady || recordMode) {
        return;
      }
      audioReady = true;
      for (const sound of Object.values(sounds)) {
        try {
          sound.muted = true;
          await sound.play();
        } catch (_error) {
        }
        stopSound(sound);
        sound.muted = false;
      }
      if (phase === "question") {
        playSound(sounds.ticking);
      }
    };

    ["pointerdown", "touchstart", "keydown"].forEach((type) => {
      window.addEventListener(type, unlockAudio, { once: true, passive: true });
      disposers.push(() => window.removeEventListener(type, unlockAudio));
    });

    const renderQuestion = () => {
      const current = questionBank[questionIndex];
      questionText.textContent = current.question;
      hostLine.textContent = "";
      questionPill.textContent = numberOnlyPill ? String(questionIndex + 1) : `Question ${questionIndex + 1} / ${questionBank.length}`;
      quizShell.classList.toggle("no-media", !current.imageUrl);
      if (mediaImage instanceof HTMLImageElement && current.imageUrl) {
        mediaImage.src = current.imageUrl;
      }

      answerButtons.forEach((button, index) => {
        const answerText = current.answers[index];
        button.classList.remove("is-correct");
        button.hidden = !answerText;
        button.disabled = !answerText;
        const labelEl = button.querySelector("[data-option-label]");
        const textEl = button.querySelector("[data-option-text]");
        const optionLabel = String.fromCharCode(65 + index);
        if (labelEl && textEl) {
          labelEl.textContent = optionLabel;
          textEl.textContent = answerText || "";
        } else {
          button.textContent = answerText ? `${optionLabel}. ${answerText}` : "";
        }
      });
    };

    const currentQuestionSeconds = () => questionBank[questionIndex].questionSeconds || timing.questionSeconds;

    const renderTimer = () => {
      const remainingMs = Math.max(0, deadline - Date.now()) * speed;
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      timerBar.style.width = `${(remainingMs / (currentQuestionSeconds() * 1000)) * 100}%`;
      timerText.textContent = `${remainingSeconds}s`;
      progressEl.setAttribute("aria-valuenow", String(remainingSeconds));
      const urgent = remainingSeconds <= timing.urgentThresholdSeconds;
      timerBar.classList.toggle("is-urgent", urgent);
      timerWrap.classList.toggle("urgent", urgent);
      return remainingMs;
    };

    const tick = () => {
      if (phase === "question" && renderTimer() <= 0) {
        beginReveal();
      }
    };

    const startQuestion = () => {
      phase = "question";
      quizShell.classList.remove("is-revealing");
      renderQuestion();
      deadline = Date.now() + scaled(currentQuestionSeconds() * 1000);
      progressEl.setAttribute("aria-valuemax", String(currentQuestionSeconds()));
      timerBar.classList.add("progress-bar-animated");
      renderTimer();
      playSound(sounds.ticking);
      emit("question", { index: questionIndex });
    };

    const completeQuiz = () => {
      phase = "final";
      clearInterval(timerInterval);
      stopAllSounds();
      quizShell.classList.remove("is-revealing");
      quizShell.classList.add("is-final");
      finalScreen?.setAttribute("aria-hidden", "false");
      playSound(sounds.cheers);
      emit("final");
      setTimeout(() => {
        recorder.done = true;
      }, scaled(TRANSITION_MS));
    };

    const beginReveal = () => {
      if (phase !== "question") {
        return;
      }
      phase = "reveal";
      stopSound(sounds.ticking);
      timerBar.classList.remove("progress-bar-animated");
      const current = questionBank[questionIndex];
      answerButtons.forEach((button, index) => {
        button.disabled = true;
        button.classList.toggle("is-correct", index === current.correctIndex);
      });
      hostLine.textContent = current.fact || `It's ${current.answers[current.correctIndex]}!`;
      quizShell.classList.add("is-revealing");
      playSound(sounds.applause);
      emit("reveal", { index: questionIndex });

      revealTimeout = setTimeout(() => {
        stopSound(sounds.applause);
        if (questionIndex >= questionBank.length - 1) {
          completeQuiz();
          return;
        }
        questionIndex += 1;
        quizShell.classList.add("is-transitioning");
        setTimeout(() => quizShell.classList.remove("is-transitioning"), scaled(TRANSITION_MS));
        startQuestion();
      }, scaled(current.revealDurationMs || timing.revealDurationMs));
    };

    const startQuiz = () => {
      if (phase !== "intro") {
        return;
      }
      clearTimeout(introTimeout);
      quizShell.classList.remove("is-intro");
      introScreen?.setAttribute("aria-hidden", "true");
      startQuestion();
      timerInterval = setInterval(tick, TIMER_REFRESH_MS);
    };

    const destroy = () => {
      phase = "destroyed";
      clearInterval(timerInterval);
      clearTimeout(revealTimeout);
      clearTimeout(introTimeout);
      stopAllSounds();
      disposers.splice(0).forEach((dispose) => dispose());
    };
    activeCleanup = destroy;

    quizShell.classList.remove("is-final", "is-revealing");
    quizShell.classList.add("is-intro");
    finalScreen?.setAttribute("aria-hidden", "true");
    introScreen?.setAttribute("aria-hidden", "false");

    if (introScreen && !recordMode) {
      const onIntroClick = () => unlockAudio().then(startQuiz);
      introScreen.addEventListener("click", onIntroClick, { once: true });
      disposers.push(() => introScreen.removeEventListener("click", onIntroClick));
    }

    preloadAssets(questionBank).then(() => {
      if (phase !== "intro") {
        return;
      }
      emit("intro");
      introTimeout = setTimeout(startQuiz, scaled(timing.introDelayMs));
    });

    return { ok: true, destroy, questionCount: questionBank.length, timing };
  };

  const bootstrapQuiz = async () => {
    try {
      const datasetPath = await resolveDatasetPath();
      window.activeQuizDatasetPath = datasetPath;
      window.initializeQuiz(await fetchJson(datasetPath));
    } catch (error) {
      console.error("Failed to load quiz configuration.", error);
      emit("error", { reason: String(error) });
      window.initializeQuiz({
        content: { intro: { title: "Quiz setup error", message: "Unable to load the selected quiz dataset JSON." } },
        questions: []
      });
    }
  };

  bootstrapQuiz();
})();
