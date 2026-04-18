(() => {
  const DEFAULT_TIMING = {
    questionSeconds: 12,
    revealDurationMs: 2000,
    introDelayMs: 3000,
    urgentThresholdSeconds: 4,
    tickIntervalMs: 1000
  };
  const DEFAULT_CONTENT = {
    intro: {
      title: "Quiz",
      message: "Get ready for the first question."
    },
    final: {
      title: "Thank you for watching.",
      message: "If you enjoyed this content, please consider subscribing, liking, and supporting us for more similar content."
    },
    defaultHostLine: "Choose your answer before time runs out.",
    timeUpHostLine: "Time up! Correct answer highlighted.",
    completeHostLine: "All questions completed. Well done!"
  };
  const DEFAULT_SOUND_PATHS = {
    ticking: "asset/sound/clock-tick.mp3",
    applause: "asset/sound/applause.mp3",
    cheers: "asset/sound/cheers.mp3"
  };
  const DEFAULT_THEME_NAME = "primary-play";
  const THEME_PRESETS = {
    "primary-play": {
      "--page-bg": "#f2f7ff",
      "--shell-border": "#15325f",
      "--shell-bg-1": "#ffffff",
      "--shell-bg-2": "#eef7ff",
      "--decor-1": "rgba(17, 138, 245, 0.14)",
      "--decor-2": "rgba(255, 56, 96, 0.13)",
      "--question-bg-1": "#ffffff",
      "--question-bg-2": "#f2f8ff",
      "--answers-bg": "#eff6ff",
      "--intro-bg-1": "rgba(17, 138, 245, 0.15)",
      "--intro-bg-2": "rgba(255, 214, 31, 0.18)",
      "--final-bg-1": "rgba(43, 214, 110, 0.13)",
      "--final-bg-2": "rgba(17, 138, 245, 0.14)",
      "--text-main": "#12213f",
      "--text-subtle": "#2f4f82",
      "--question-emphasis": "#ffd41f",
      "--question-emphasis-text": "#12213f",
      "--pill-bg": "#1f4ea8",
      "--pill-text": "#ffffff",
      "--intro-badge-bg": "#ffe36b",
      "--intro-badge-text": "#112a54",
      "--final-badge-bg": "#8ff0b9",
      "--final-badge-text": "#0d4a2a",
      "--answer-bg-1": "#ffffff",
      "--answer-bg-2": "#d9edff",
      "--answer-border": "#2274f4",
      "--answer-text": "#11315e",
      "--answer-hover-shadow": "rgba(34, 116, 244, 0.27)",
      "--timer-wrap-bg": "rgba(255, 255, 255, 0.96)",
      "--timer-wrap-border": "#c6dbff",
      "--timer-label": "#163465",
      "--progress-bg": "#dbe8fb",
      "--timer-bar-start": "#1f83ff",
      "--timer-bar-end": "#165df0",
      "--timer-urgent-start": "#ff5f4d",
      "--timer-urgent-end": "#f11d3c",
      "--urgent-shadow-1": "rgba(241, 29, 60, 0.2)",
      "--urgent-shadow-2": "rgba(241, 29, 60, 0.28)",
      "--feedback-correct": "#22b65f",
      "--feedback-correct-text": "#ffffff",
      "--feedback-incorrect": "#f11d3c"
    },
    "soft-pastel": {
      "--page-bg": "#f5f8ff",
      "--shell-border": "#5f7196",
      "--shell-bg-1": "#ffffff",
      "--shell-bg-2": "#f2fbff",
      "--decor-1": "rgba(120, 196, 255, 0.16)",
      "--decor-2": "rgba(254, 189, 230, 0.16)",
      "--question-bg-1": "#ffffff",
      "--question-bg-2": "#f7fdff",
      "--answers-bg": "#f2fbff",
      "--intro-bg-1": "rgba(120, 196, 255, 0.2)",
      "--intro-bg-2": "rgba(255, 240, 164, 0.21)",
      "--final-bg-1": "rgba(159, 239, 200, 0.2)",
      "--final-bg-2": "rgba(158, 214, 255, 0.2)",
      "--text-main": "#26354f",
      "--text-subtle": "#4f668a",
      "--question-emphasis": "#fff3a8",
      "--question-emphasis-text": "#2d3650",
      "--pill-bg": "#6589c9",
      "--pill-text": "#ffffff",
      "--intro-badge-bg": "#ffe8b2",
      "--intro-badge-text": "#37445b",
      "--final-badge-bg": "#b8f4d0",
      "--final-badge-text": "#2f5845",
      "--answer-bg-1": "#ffffff",
      "--answer-bg-2": "#e9f7ff",
      "--answer-border": "#6fa3ea",
      "--answer-text": "#2d466d",
      "--answer-hover-shadow": "rgba(111, 163, 234, 0.27)",
      "--timer-wrap-bg": "rgba(255, 255, 255, 0.97)",
      "--timer-wrap-border": "#d1dff5",
      "--timer-label": "#3e567e",
      "--progress-bg": "#e4edfa",
      "--timer-bar-start": "#76beff",
      "--timer-bar-end": "#5e98f0",
      "--timer-urgent-start": "#ff7a74",
      "--timer-urgent-end": "#f24f5d",
      "--urgent-shadow-1": "rgba(242, 79, 93, 0.2)",
      "--urgent-shadow-2": "rgba(242, 79, 93, 0.26)",
      "--feedback-correct": "#2dc171",
      "--feedback-correct-text": "#ffffff",
      "--feedback-incorrect": "#f24f5d"
    },
    "dark-focus": {
      "--page-bg": "#120d22",
      "--shell-border": "#4634b2",
      "--shell-bg-1": "#1a1236",
      "--shell-bg-2": "#120c28",
      "--decor-1": "rgba(0, 255, 249, 0.2)",
      "--decor-2": "rgba(255, 68, 234, 0.2)",
      "--question-bg-1": "#241b4a",
      "--question-bg-2": "#1a1335",
      "--answers-bg": "#130f2b",
      "--intro-bg-1": "rgba(255, 68, 234, 0.22)",
      "--intro-bg-2": "rgba(0, 255, 249, 0.2)",
      "--final-bg-1": "rgba(45, 211, 126, 0.21)",
      "--final-bg-2": "rgba(0, 255, 249, 0.2)",
      "--text-main": "#f8fbff",
      "--text-subtle": "#c9d5ff",
      "--question-emphasis": "#ffe44a",
      "--question-emphasis-text": "#1a1335",
      "--pill-bg": "#00e8ff",
      "--pill-text": "#0c1436",
      "--intro-badge-bg": "#ff6bed",
      "--intro-badge-text": "#260d38",
      "--final-badge-bg": "#85ffba",
      "--final-badge-text": "#083623",
      "--answer-bg-1": "#2b2153",
      "--answer-bg-2": "#201744",
      "--answer-border": "#00d9ff",
      "--answer-text": "#f5fbff",
      "--answer-hover-shadow": "rgba(0, 217, 255, 0.36)",
      "--timer-wrap-bg": "rgba(31, 23, 62, 0.96)",
      "--timer-wrap-border": "#5a4ac8",
      "--timer-label": "#dce5ff",
      "--progress-bg": "#362c65",
      "--timer-bar-start": "#00e8ff",
      "--timer-bar-end": "#53a0ff",
      "--timer-urgent-start": "#ff6f66",
      "--timer-urgent-end": "#ff2e52",
      "--urgent-shadow-1": "rgba(255, 46, 82, 0.24)",
      "--urgent-shadow-2": "rgba(255, 46, 82, 0.34)",
      "--feedback-correct": "#37d879",
      "--feedback-correct-text": "#0d1d17",
      "--feedback-incorrect": "#ff2e52"
    }
  };

  const toPositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  const normalizeQuestions = (questions, answerSlots) => {
    if (!Array.isArray(questions)) {
      return [];
    }

    return questions
      .map((item) => {
        const answers = Array.isArray(item?.answers) ? item.answers.slice(0, answerSlots) : [];
        const correctIndex = Number.isInteger(item?.correctIndex) ? item.correctIndex : -1;

        return {
          question: String(item?.question ?? "").trim(),
          answers,
          correctIndex,
          host: String(item?.host ?? "").trim()
        };
      })
      .filter((item) => item.question && item.answers.length > 0 && item.correctIndex >= 0 && item.correctIndex < item.answers.length);
  };

  const mergeContent = (content) => {
    return {
      intro: {
        title: content?.intro?.title ?? DEFAULT_CONTENT.intro.title,
        message: content?.intro?.message ?? DEFAULT_CONTENT.intro.message
      },
      final: {
        title: content?.final?.title ?? DEFAULT_CONTENT.final.title,
        message: content?.final?.message ?? DEFAULT_CONTENT.final.message
      },
      defaultHostLine: content?.defaultHostLine ?? DEFAULT_CONTENT.defaultHostLine,
      timeUpHostLine: content?.timeUpHostLine ?? DEFAULT_CONTENT.timeUpHostLine,
      completeHostLine: content?.completeHostLine ?? DEFAULT_CONTENT.completeHostLine
    };
  };

  const resolveTheme = (themeConfig) => {
    const requestedName = String(themeConfig?.name ?? DEFAULT_THEME_NAME).trim().toLowerCase();
    const themeName = THEME_PRESETS[requestedName] ? requestedName : DEFAULT_THEME_NAME;
    const baseTokens = THEME_PRESETS[themeName];
    const rawOverrides = themeConfig?.overrides && typeof themeConfig.overrides === "object" ? themeConfig.overrides : {};
    const normalizedOverrides = Object.entries(rawOverrides).reduce((accumulator, [key, value]) => {
      const tokenKey = String(key || "").trim();
      if (!tokenKey) {
        return accumulator;
      }
      const cssToken = tokenKey.startsWith("--") ? tokenKey : `--${tokenKey}`;
      accumulator[cssToken] = String(value);
      return accumulator;
    }, {});

    return {
      name: themeName,
      tokens: {
        ...baseTokens,
        ...normalizedOverrides
      }
    };
  };

  const applyThemeTokens = (themeTarget, resolvedTheme) => {
    if (!themeTarget || !resolvedTheme) {
      return;
    }
    themeTarget.dataset.theme = resolvedTheme.name;
    Object.entries(resolvedTheme.tokens).forEach(([token, value]) => {
      themeTarget.style.setProperty(token, value);
    });
  };

  const DEFAULT_MANIFEST_PATH = "asset/data/quizzes/manifest.json";
  const DEFAULT_DATASET_PATH = "asset/data/quizzes/general/general-001.json";

  const getDatasetPathFromQuery = () => {
    const params = new URLSearchParams(window.location.search);
    const datasetPath = (params.get("dataset") || "").trim();
    return datasetPath || null;
  };

  const fetchJson = async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    return response.json();
  };

  const resolveDatasetPath = async () => {
    const requestedPath = getDatasetPathFromQuery();
    if (requestedPath) {
      return requestedPath;
    }

    try {
      const manifest = await fetchJson(DEFAULT_MANIFEST_PATH);
      if (typeof manifest?.defaultDataset === "string" && manifest.defaultDataset.trim()) {
        return manifest.defaultDataset.trim();
      }
      if (Array.isArray(manifest?.datasets) && manifest.datasets.length > 0) {
        const firstPath = String(manifest.datasets[0]?.path || "").trim();
        if (firstPath) {
          return firstPath;
        }
      }
    } catch (_error) {
    }

    return DEFAULT_DATASET_PATH;
  };

  const loadQuizConfigFromDataset = async () => {
    const datasetPath = await resolveDatasetPath();
    const datasetConfig = await fetchJson(datasetPath);
    window.activeQuizDatasetPath = datasetPath;
    return datasetConfig;
  };

  let activeCleanup = null;

  window.initializeQuiz = (config = {}) => {
    if (typeof activeCleanup === "function") {
      activeCleanup();
      activeCleanup = null;
    }

    const timerBar = document.getElementById("timerBar");
    const timerText = document.getElementById("timerText");
    const progressEl = document.querySelector(".progress");
    const timerWrap = document.querySelector(".timer-wrap");
    const quizShell = document.querySelector(".quiz-shell");
    const introScreen = document.getElementById("introScreen");
    const introTitle = document.getElementById("introTitle");
    const introMessage = document.getElementById("introMessage");
    const finalScreen = document.getElementById("finalScreen");
    const finalTitle = document.getElementById("finalTitle");
    const finalMessage = document.getElementById("finalMessage");
    const questionText = document.getElementById("questionText");
    const questionPill = document.getElementById("questionPill");
    const hostLine = document.getElementById("hostLine");
    const answerButtons = [0, 1, 2, 3].map((index) => document.getElementById(`answer${index}`)).filter(Boolean);

    if (!timerBar || !timerText || !progressEl || !timerWrap || !quizShell || !questionText || !questionPill || !hostLine || answerButtons.length === 0) {
      return { ok: false, reason: "missing_dom_elements" };
    }

    const mergedTiming = {
      questionSeconds: toPositiveNumber(config?.timing?.questionSeconds, DEFAULT_TIMING.questionSeconds),
      revealDurationMs: toPositiveNumber(config?.timing?.revealDurationMs, DEFAULT_TIMING.revealDurationMs),
      introDelayMs: toPositiveNumber(config?.timing?.introDelayMs, DEFAULT_TIMING.introDelayMs),
      urgentThresholdSeconds: toPositiveNumber(config?.timing?.urgentThresholdSeconds, DEFAULT_TIMING.urgentThresholdSeconds),
      tickIntervalMs: toPositiveNumber(config?.timing?.tickIntervalMs, DEFAULT_TIMING.tickIntervalMs)
    };
    const mergedContent = mergeContent(config?.content);
    const questionBank = normalizeQuestions(config?.questions, answerButtons.length);
    const mergedTheme = resolveTheme(config?.theme);
    applyThemeTokens(document.documentElement, mergedTheme);
    applyThemeTokens(quizShell, mergedTheme);

    if (questionBank.length === 0) {
      questionPill.textContent = "Quiz not initialized";
      hostLine.textContent = "Call window.initializeQuiz({ questions, timing }) with a valid question set.";
      if (introTitle) {
        introTitle.textContent = mergedContent.intro.title;
      }
      if (introMessage) {
        introMessage.textContent = mergedContent.intro.message;
      }
      return { ok: false, reason: "no_questions" };
    }

    const soundPaths = {
      ...DEFAULT_SOUND_PATHS,
      ...(config?.sounds || {})
    };
    const sounds = {
      ticking: new Audio(soundPaths.ticking),
      applause: new Audio(soundPaths.applause),
      cheers: new Audio(soundPaths.cheers)
    };
    sounds.ticking.loop = true;
    Object.values(sounds).forEach((sound) => {
      sound.preload = "auto";
    });

    let remaining = mergedTiming.questionSeconds;
    let questionIndex = 0;
    let revealDone = false;
    let quizCompleted = false;
    let isRevealing = false;
    let audioReady = false;
    let quizStarted = false;
    let timerInterval;
    let revealTimeout;
    let introTimeout;
    const disposers = [];

    const playSound = (sound, { restart = false } = {}) => {
      if (!sound) {
        return;
      }
      if (restart) {
        sound.pause();
        sound.currentTime = 0;
      }
      sound.play().catch(() => {});
    };

    const stopSound = (sound) => {
      if (!sound) {
        return;
      }
      sound.pause();
      sound.currentTime = 0;
    };

    const stopAllSounds = () => {
      Object.values(sounds).forEach((sound) => {
        stopSound(sound);
      });
    };

    const startTicking = () => {
      stopSound(sounds.applause);
      stopSound(sounds.cheers);
      playSound(sounds.ticking, { restart: true });
    };

    const syncTickingWithState = () => {
      if (quizCompleted || isRevealing || remaining <= 0) {
        return;
      }
      if (sounds.ticking.paused) {
        startTicking();
      }
    };

    const unlockAudio = async () => {
      if (audioReady) {
        return;
      }
      for (const sound of Object.values(sounds)) {
        try {
          sound.muted = true;
          sound.currentTime = 0;
          await sound.play();
        } catch (_error) {
        }
        sound.pause();
        sound.currentTime = 0;
        sound.muted = false;
      }
      audioReady = true;
      if (!quizCompleted && !isRevealing && remaining > 0) {
        syncTickingWithState();
      }
    };

    const addWindowListener = (type, handler, options) => {
      window.addEventListener(type, handler, options);
      disposers.push(() => window.removeEventListener(type, handler, options));
    };

    const attachAudioFallbackUnlock = () => {
      const pointerOptions = { once: true, passive: true };
      addWindowListener("pointerdown", unlockAudio, pointerOptions);
      addWindowListener("touchstart", unlockAudio, pointerOptions);
      addWindowListener("keydown", unlockAudio, { once: true });
    };

    const clearAnswerState = () => {
      answerButtons.forEach((button) => {
        button.classList.remove("is-correct");
        button.disabled = false;
        button.hidden = false;
      });
    };

    const renderQuestion = () => {
      const current = questionBank[questionIndex];
      questionText.textContent = current.question;
      hostLine.textContent = current.host || mergedContent.defaultHostLine;
      questionPill.textContent = `Question ${questionIndex + 1} / ${questionBank.length}`;

      answerButtons.forEach((button, index) => {
        const optionLabel = String.fromCharCode(65 + index);
        const answerText = current.answers[index];
        button.hidden = !answerText;
        button.disabled = !answerText;
        button.textContent = answerText ? `${optionLabel}. ${answerText}` : `${optionLabel}.`;
      });
    };

    const revealAnswer = () => {
      if (revealDone) {
        return;
      }
      const current = questionBank[questionIndex];
      revealDone = true;

      answerButtons.forEach((button, index) => {
        button.disabled = true;
        if (index === current.correctIndex) {
          button.classList.add("is-correct");
        }
      });
      hostLine.textContent = mergedContent.timeUpHostLine;
    };

    const runTransition = () => {
      quizShell.classList.add("is-transitioning");
      setTimeout(() => {
        quizShell.classList.remove("is-transitioning");
      }, 260);
    };

    const nextQuestion = () => {
      questionIndex += 1;
      remaining = mergedTiming.questionSeconds;
      revealDone = false;
      isRevealing = false;
      timerBar.classList.remove("is-urgent");
      timerBar.classList.add("progress-bar-animated");
      timerWrap.classList.remove("urgent");
      clearAnswerState();
      runTransition();
      renderQuestion();
      setTimeout(() => {
        syncTickingWithState();
      }, 260);
    };

    const completeQuiz = () => {
      if (quizCompleted) {
        return;
      }
      quizCompleted = true;
      isRevealing = false;
      clearInterval(timerInterval);
      clearTimeout(revealTimeout);
      stopAllSounds();
      timerBar.classList.remove("progress-bar-animated");
      timerWrap.classList.remove("urgent");
      questionPill.textContent = `Completed ${questionBank.length} / ${questionBank.length}`;
      timerText.textContent = "Done";
      hostLine.textContent = mergedContent.completeHostLine;
      playSound(sounds.cheers, { restart: true });
      quizShell.classList.add("is-final");
      if (finalScreen) {
        finalScreen.setAttribute("aria-hidden", "false");
      }
    };

    const beginRevealPhase = () => {
      if (isRevealing || quizCompleted) {
        return;
      }
      isRevealing = true;
      stopSound(sounds.ticking);
      timerBar.classList.remove("progress-bar-animated");
      revealAnswer();
      playSound(sounds.applause, { restart: true });

      clearTimeout(revealTimeout);
      revealTimeout = setTimeout(() => {
        stopSound(sounds.applause);
        if (questionIndex >= questionBank.length - 1) {
          completeQuiz();
          return;
        }
        nextQuestion();
      }, mergedTiming.revealDurationMs);
    };

    const tick = () => {
      if (quizCompleted || isRevealing) {
        return;
      }

      const percent = Math.max(0, Math.round((remaining / mergedTiming.questionSeconds) * 100));
      timerBar.style.width = `${percent}%`;
      timerBar.textContent = "";
      timerText.textContent = `${remaining}s`;
      progressEl.setAttribute("aria-valuenow", String(remaining));
      progressEl.setAttribute("aria-valuemax", String(mergedTiming.questionSeconds));

      if (remaining <= mergedTiming.urgentThresholdSeconds) {
        timerBar.classList.add("is-urgent");
        timerWrap.classList.add("urgent");
      }

      if (remaining <= 0) {
        beginRevealPhase();
        return;
      }

      remaining -= 1;
    };

    const hideIntroAndStartQuiz = () => {
      if (quizStarted) {
        return;
      }
      quizStarted = true;
      clearTimeout(introTimeout);
      quizShell.classList.remove("is-intro");
      if (introScreen) {
        introScreen.setAttribute("aria-hidden", "true");
      }
      renderQuestion();
      unlockAudio().finally(() => {
        startTicking();
        tick();
        timerInterval = setInterval(tick, mergedTiming.tickIntervalMs);
      });
    };

    const destroy = () => {
      clearInterval(timerInterval);
      clearTimeout(revealTimeout);
      clearTimeout(introTimeout);
      stopAllSounds();
      while (disposers.length > 0) {
        const dispose = disposers.pop();
        if (dispose) {
          dispose();
        }
      }
    };

    timerBar.classList.add("progress-bar-animated");
    timerBar.classList.remove("is-urgent");
    timerWrap.classList.remove("urgent");
    quizShell.classList.remove("is-final");
    quizShell.classList.add("is-intro");

    if (introTitle) {
      introTitle.textContent = mergedContent.intro.title;
    }
    if (introMessage) {
      introMessage.textContent = mergedContent.intro.message;
    }
    if (finalTitle) {
      finalTitle.textContent = mergedContent.final.title;
    }
    if (finalMessage) {
      finalMessage.textContent = mergedContent.final.message;
    }
    if (finalScreen) {
      finalScreen.setAttribute("aria-hidden", "true");
    }
    if (introScreen) {
      introScreen.setAttribute("aria-hidden", "false");
    }

    attachAudioFallbackUnlock();
    introTimeout = setTimeout(() => {
      hideIntroAndStartQuiz();
    }, mergedTiming.introDelayMs);

    if (introScreen) {
      const onIntroClick = () => {
        unlockAudio().then(() => {
          hideIntroAndStartQuiz();
        });
      };
      introScreen.addEventListener("click", onIntroClick, { once: true });
      disposers.push(() => introScreen.removeEventListener("click", onIntroClick));
    }

    activeCleanup = destroy;
    return {
      ok: true,
      destroy,
      questionCount: questionBank.length,
      timing: mergedTiming,
      theme: mergedTheme.name
    };
  };

  const bootstrapQuiz = async () => {
    try {
      const config = await loadQuizConfigFromDataset();
      window.initializeQuiz(config);
    } catch (error) {
      console.error("Failed to load quiz configuration.", error);
      window.initializeQuiz({
        content: {
          intro: {
            title: "Quiz setup error",
            message: "Unable to load the selected quiz dataset JSON."
          }
        },
        questions: []
      });
    }
  };

  bootstrapQuiz();
})();
