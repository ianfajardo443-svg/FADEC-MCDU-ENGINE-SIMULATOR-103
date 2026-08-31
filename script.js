/* =========================================================
   FADEC ENGINE CBT SIMULATOR
   LIVE / DYNAMIC ENGINE SENSOR VERSION

   FEATURES:
   - Dynamic N1 / N2
   - Dynamic EGT
   - Dynamic Pressure
   - Dynamic Fuel Flow
   - Dynamic Airflow
   - Smooth sensor movement
   - Engine spool-up / spool-down
   - Realistic sensor fluctuation
   - Air-volume dependent engine behavior
   - FADEC caution / warning monitoring
   - Fault logging
   - MCDU
   - Diagnostics
   - CBT assessment
   - Sound
   - Theme
========================================================= */


/* =========================================================
   SHORTCUT
========================================================= */

const $ = id => document.getElementById(id);


/* =========================================================
   SYSTEM VARIABLES
========================================================= */

let engineRunning = false;

let engineStarting = false;

let engineStopping = false;

let soundEnabled = true;

let currentPage = "engine";

let faults = [];

let eventHistory = [];
let mcduScratchpad = "";

let score = 0;

let questions = 0;

let currentQuestionIndex = 0;

let currentLevel = "normal";

let previousLevel = "normal";

let audioContext = null;
let engineLoopAudio = null;
let alertLoopAudio = null;
let alertLoopLevel = "";
let alertAudioGeneration = 0;
let audioFiles = {};


/* =========================================================
   LIVE SENSOR STATE
========================================================= */

/*
   These are the actual moving sensor values.

   The values do NOT directly equal the mathematical
   calculation anymore.

   Instead:

   AIR VOLUME
        ↓
   ENGINE TARGET
        ↓
   SENSOR DYNAMICS
        ↓
   LIVE VALUE
        ↓
   FADEC
*/

let liveValues = {

  airflow: 0,

  n1: 0,

  n2: 0,

  egt: 0,

  pressure: 0,

  fuelFlow: 0

};


/* =========================================================
   SENSOR TARGETS
========================================================= */

let sensorTargets = {

  airflow: 0,

  n1: 0,

  n2: 0,

  egt: 0,

  pressure: 0,

  fuelFlow: 0

};


/* =========================================================
   SENSOR NOISE
========================================================= */

let sensorNoise = {

  airflow: 0,

  n1: 0,

  n2: 0,

  egt: 0,

  pressure: 0,

  fuelFlow: 0

};


/* =========================================================
   SENSOR TIMER
========================================================= */

let sensorTimer = null;

let lastFADECCheck = 0;

let lastAlertKey = "";

let lastAlertTime = 0;

let acknowledgedAlertKey = "";
let currentAlertKey = "normal";


/* =========================================================
   ENGINE CALCULATION
   BASE ENGINE MODEL

   These are TARGET values.

   The displayed values will fluctuate around
   these targets instead of remaining static.
========================================================= */

function calculateEngine(airVolume) {

  const air = Number(airVolume);


  /*
     BASE ENGINE RELATIONSHIPS

     These values represent the nominal operating
     condition for the selected air-volume input.
  */

  const airflow =
    0.4 +
    (air * 0.018);


  const n1 =
    20 +
    (air * 0.65);


  const n2 =
    25 +
    (air * 0.60);


  const egt =
    300 +
    (air * 7);


  const pressure =
    20 +
    (air * 0.35);


  const fuelFlow =
    200 +
    (air * 8);


  return {

    airflow,

    n1,

    n2,

    egt,

    pressure,

    fuelFlow

  };

}


/* =========================================================
   PARAMETER LIMITS
========================================================= */

const ENGINE_LIMITS = {

  N1: {

    cautionHigh: 85,

    warningHigh: 95

  },


  N2: {

    cautionHigh: 85,

    warningHigh: 95

  },


  EGT: {

    cautionHigh: 750,

    warningHigh: 850

  },


  PRESSURE: {

    cautionLow: 20,

    warningLow: 10

  },


  FUEL: {

    cautionHigh: 800,

    warningHigh: 1000

  },


  AIRFLOW: {

    cautionHigh: 1.6,

    warningHigh: 2.0

  },


  AIR_VOLUME: {

    cautionHigh: 75,

    warningHigh: 90

  }

};


/* =========================================================
   REALISTIC SENSOR FLUCTUATION RANGES
========================================================= */

/*
   These represent normal small sensor variations.

   They are intentionally small so the readings look
   alive without becoming unrealistically unstable.
*/

const SENSOR_VARIATION = {

  n1: 0.45,

  n2: 0.35,

  egt: 3.0,

  pressure: 0.45,

  fuelFlow: 8,

  airflow: 0.025

};


/* =========================================================
   RANDOM VALUE
========================================================= */

function randomBetween(min, max) {

  return (
    Math.random() *
    (max - min)
  ) + min;

}


/* =========================================================
   CLAMP VALUE
========================================================= */

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );

}


/* =========================================================
   CREATE SENSOR TARGET
========================================================= */

function updateSensorTargets() {

  if (!engineRunning) {

    sensorTargets = {

      airflow: 0,

      n1: 0,

      n2: 0,

      egt: 0,

      pressure: 0,

      fuelFlow: 0

    };

    return;

  }


  const air =
    Number(
      $("airVolume")
        ? $("airVolume").value
        : 50
    );


  const base =
    calculateEngine(
      air
    );


  /*
     Generate a small new sensor deviation.

     This changes gradually rather than producing
     completely random numbers every update.
  */

  Object.keys(
    SENSOR_VARIATION
  ).forEach(
    key => {

      const variation =
        SENSOR_VARIATION[key];


      sensorNoise[key] =
        randomBetween(
          -variation,
          variation
        );

    }
  );


  sensorTargets = {

    n1:
      base.n1 +
      sensorNoise.n1,

    n2:
      base.n2 +
      sensorNoise.n2,

    egt:
      base.egt +
      sensorNoise.egt,

    pressure:
      base.pressure +
      sensorNoise.pressure,

    fuelFlow:
      base.fuelFlow +
      sensorNoise.fuelFlow,

    airflow:
      base.airflow +
      sensorNoise.airflow

  };

}


/* =========================================================
   SMOOTH SENSOR MOVEMENT
========================================================= */

function smoothSensorValues() {

  const smoothing =
    engineStarting
      ? 0.08
      : engineStopping
        ? 0.12
        : 0.18;


  Object.keys(
    liveValues
  ).forEach(
    key => {

      liveValues[key] +=

        (
          sensorTargets[key] -
          liveValues[key]
        ) *
        smoothing;

    }
  );


  /*
     Prevent tiny negative sensor values.
  */

  liveValues.airflow =
    Math.max(
      0,
      liveValues.airflow
    );


  liveValues.n1 =
    Math.max(
      0,
      liveValues.n1
    );


  liveValues.n2 =
    Math.max(
      0,
      liveValues.n2
    );


  liveValues.egt =
    Math.max(
      0,
      liveValues.egt
    );


  liveValues.pressure =
    Math.max(
      0,
      liveValues.pressure
    );


  liveValues.fuelFlow =
    Math.max(
      0,
      liveValues.fuelFlow
    );

}


/* =========================================================
   GET LIVE ENGINE VALUES
========================================================= */

function getLiveEngineValues() {

  return {

    airflow:
      liveValues.airflow,

    n1:
      liveValues.n1,

    n2:
      liveValues.n2,

    egt:
      liveValues.egt,

    pressure:
      liveValues.pressure,

    fuelFlow:
      liveValues.fuelFlow

  };

}


/* =========================================================
   GET PARAMETER STATUS
========================================================= */

function getParameterStatus(
  type,
  value
) {

  const numericValue =
    Number(value);


  if (type === "N1") {

    if (
      numericValue >
      ENGINE_LIMITS.N1.warningHigh
    ) {

      return "WARNING";

    }


    if (
      numericValue >
      ENGINE_LIMITS.N1.cautionHigh
    ) {

      return "CAUTION";

    }

  }


  if (type === "N2") {

    if (
      numericValue >
      ENGINE_LIMITS.N2.warningHigh
    ) {

      return "WARNING";

    }


    if (
      numericValue >
      ENGINE_LIMITS.N2.cautionHigh
    ) {

      return "CAUTION";

    }

  }


  if (type === "EGT") {

    if (
      numericValue >
      ENGINE_LIMITS.EGT.warningHigh
    ) {

      return "WARNING";

    }


    if (
      numericValue >
      ENGINE_LIMITS.EGT.cautionHigh
    ) {

      return "CAUTION";

    }

  }


  if (type === "PRESSURE") {

    if (
      numericValue <
      ENGINE_LIMITS.PRESSURE.warningLow
    ) {

      return "WARNING";

    }


    if (
      numericValue <
      ENGINE_LIMITS.PRESSURE.cautionLow
    ) {

      return "CAUTION";

    }

  }


  if (type === "FUEL") {

    if (
      numericValue >
      ENGINE_LIMITS.FUEL.warningHigh
    ) {

      return "WARNING";

    }


    if (
      numericValue >
      ENGINE_LIMITS.FUEL.cautionHigh
    ) {

      return "CAUTION";

    }

  }


  if (type === "AIRFLOW") {

    if (
      numericValue >
      ENGINE_LIMITS.AIRFLOW.warningHigh
    ) {

      return "WARNING";

    }


    if (
      numericValue >
      ENGINE_LIMITS.AIRFLOW.cautionHigh
    ) {

      return "CAUTION";

    }

  }


  return "NORMAL";

}


/* =========================================================
   OVERALL PARAMETER STATUS
========================================================= */

function getOverallParameterStatus(
  values
) {

  const statuses = [

    getParameterStatus(
      "N1",
      values.n1
    ),

    getParameterStatus(
      "N2",
      values.n2
    ),

    getParameterStatus(
      "EGT",
      values.egt
    ),

    getParameterStatus(
      "PRESSURE",
      values.pressure
    ),

    getParameterStatus(
      "FUEL",
      values.fuelFlow
    ),

    getParameterStatus(
      "AIRFLOW",
      values.airflow
    )

  ];


  if (
    statuses.includes(
      "WARNING"
    )
  ) {

    return "warning";

  }


  if (
    statuses.includes(
      "CAUTION"
    )
  ) {

    return "caution";

  }


  return "normal";

}


/* =========================================================
   AIR VOLUME CONDITION
========================================================= */

function getAirVolumeLevel(
  airVolume
) {

  const air =
    Number(airVolume);


  if (
    air >=
    ENGINE_LIMITS.AIR_VOLUME.warningHigh
  ) {

    return "warning";

  }


  if (
    air >=
    ENGINE_LIMITS.AIR_VOLUME.cautionHigh
  ) {

    return "caution";

  }


  return "normal";

}


/* =========================================================
   CLOCK
========================================================= */

function timeNow() {

  return new Date()
    .toLocaleTimeString(
      [],
      {
        hour12: false
      }
    );

}


/* =========================================================
   EVENT LOG
========================================================= */

function logEvent(
  message
) {

  const timestamp = timeNow();

  eventHistory.unshift({
    time: timestamp,
    message: String(message).replace(/<[^>]*>/g, "")
  });

  // Keep the in-memory MCDU event list bounded.
  if (eventHistory.length > 50) {
    eventHistory.length = 50;
  }

  const log =
    $("eventLog");

  if (!log)
    return;

  const event =
    document.createElement(
      "div"
    );

  event.className =
    "event";

  event.innerHTML = `

    <span class="time">
      ${timestamp}
    </span>

    ${message}

  `;

  log.prepend(
    event
  );

  const count =
    $("logCount");

  if (count) {

    count.textContent =
      `${log.children.length} EVENTS`;

  }

}


/* =========================================================
   FULL-SCREEN CAUTION / WARNING FLASH
   Visual alert only — existing UI is unchanged.
========================================================= */
function flashAlert(level) {
  let flash = $("screenAlertFlash");
  if (!flash) {
    flash = document.createElement("div");
    flash.id = "screenAlertFlash";
    flash.setAttribute("aria-hidden", "true");
    document.body.appendChild(flash);
  }

  if (level !== "caution" && level !== "warning") {
    flash.className = "screen-alert-flash";
    flash.style.display = "none";
    stopAlertAudio();
    return;
  }

  // Flash and alert audio are one synchronized state: if the flash is active,
  // the matching alert sound is allowed to loop; otherwise it is stopped.
  flash.style.display = "block";
  flash.className = "screen-alert-flash " + level + " active";

  if (engineRunning && currentLevel === level && acknowledgedAlertKey !== currentAlertKey) {
    startAlertAudio(level);
  } else {
    stopAlertAudio();
  }
}


/* =========================================================
   AUDIO — CUSTOM FADEC SOUND SET
========================================================= */

function getAudio(name) {
  if (!soundEnabled) return null;
  if (!audioFiles[name]) {
    audioFiles[name] = new Audio("sounds/" + name + ".wav");
    audioFiles[name].preload = "auto";
  }
  return audioFiles[name];
}

function playFile(name, volume = 0.75) {
  const audio = getAudio(name);
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = volume;
    const promise = audio.play();
    if (promise && promise.catch) promise.catch(() => {});
  } catch (error) {
    console.log("Audio unavailable");
  }
}

function startEngineAudio() {
  if (!soundEnabled) return;

  playFile("engine_start", 0.92);

  const startLoop = () => {
    if (!engineRunning || !soundEnabled) return;
    if (!engineLoopAudio) {
      engineLoopAudio = getAudio("engine_loop");
    }
    if (!engineLoopAudio) return;
    engineLoopAudio.loop = true;
    engineLoopAudio.volume = 0.32;
    engineLoopAudio.currentTime = 0;
    const promise = engineLoopAudio.play();
    if (promise && promise.catch) promise.catch(() => {});
  };

  setTimeout(startLoop, 900);
}

function stopEngineAudio() {
  if (engineLoopAudio) {
    try {
      engineLoopAudio.pause();
      engineLoopAudio.currentTime = 0;
    } catch (error) {}
  }
  playFile("engine_stop", 0.90);
}

function startAlertAudio(level) {
  // Audio is allowed ONLY when the exact alert state is active and flashing.
  if (!soundEnabled || !engineRunning || (level !== "caution" && level !== "warning") || currentLevel !== level || acknowledgedAlertKey === currentAlertKey) {
    stopAlertAudio();
    return;
  }

  if (alertLoopAudio && alertLoopLevel === level && !alertLoopAudio.paused) return;

  stopAlertAudio();
  const generation = alertAudioGeneration;
  const audio = getAudio(level);
  if (!audio) return;

  alertLoopAudio = audio;
  alertLoopLevel = level;
  alertLoopAudio.loop = true;
  alertLoopAudio.volume = level === "warning" ? 0.90 : 0.82;
  alertLoopAudio.currentTime = 0;

  const promise = alertLoopAudio.play();
  if (promise && promise.then) {
    promise.then(() => {
      // A play request may resolve after the alert has already cleared.
      if (generation !== alertAudioGeneration ||
          !engineRunning ||
          currentLevel !== level ||
          acknowledgedAlertKey === currentAlertKey) {
        stopAlertAudio();
      }
    }).catch(() => {});
  }
}

function stopAlertAudio() {
  // Invalidate any pending play() promise so stale warning/caution audio
  // cannot restart after the condition has cleared.
  alertAudioGeneration++;

  if (alertLoopAudio) {
    try {
      alertLoopAudio.pause();
      alertLoopAudio.currentTime = 0;
      alertLoopAudio.loop = false;
      alertLoopAudio.onended = null;
    } catch (error) {}
  }
  alertLoopAudio = null;
  alertLoopLevel = "";
}

function playSound(type) {
  if (!soundEnabled) return;

  const map = {
    input: "slider",
    click: "button_click",
    acknowledge: "acknowledge",
    caution: "caution",
    warning: "warning"
  };

  const file = map[type];
  if (file) playFile(file, type === "warning" ? 0.9 : type === "caution" ? 0.82 : 0.65);
}

/* =========================================================
   OPTIONAL WELCOME / RETURN AUDIO
   Add welcome.wav and thank_you.wav to sounds/.
========================================================= */
function playOptionalSound(name, volume = 0.75) {
  if (!soundEnabled) return null;
  const candidates = [`sounds/${name}.mp3`, `sounds/${name}.wav`];
  let index = 0;
  let audio = null;
  const tryNext = () => {
    if (index >= candidates.length) return;
    audio = new Audio(candidates[index++]);
    audio.volume = volume;
    audio.preload = "auto";
    audio.addEventListener("error", tryNext, { once: true });
    audio.play().catch(() => {});
  };
  tryNext();
  return audio;
}
function playWelcomeSound() { return playOptionalSound("welcome", 0.78); }
function playThankYouSound() {
  if (!soundEnabled) return null;

  return new Promise(resolve => {
    const candidates = ["sounds/thank_you.wav", "sounds/thank_you.mp3"];
    let index = 0;

    const tryNext = () => {
      if (index >= candidates.length) {
        resolve(false);
        return;
      }

      const audio = new Audio(candidates[index++]);
      audio.preload = "auto";
      audio.volume = 0.82;

      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      audio.addEventListener("ended", () => finish(true), { once: true });
      audio.addEventListener("error", tryNext, { once: true });

      const promise = audio.play();
      if (promise && promise.catch) {
        promise.catch(() => finish(false));
      }
    };

    tryNext();
  });
}

// Welcome announcement: play when the simulator document is entered.
// If the browser blocks autoplay, retry on the first user interaction.
let welcomePlayed = false;
function playWelcomeOnSimulatorEntry() {
  if (welcomePlayed) return;
  welcomePlayed = true;
  const audio = playWelcomeSound();
  if (!audio) return;
  let started = false;
  const markStarted = () => { started = true; };
  audio.addEventListener("play", markStarted, { once: true });
  audio.addEventListener("playing", markStarted, { once: true });
  setTimeout(() => {
    if (!started) {
      welcomePlayed = false;
      const retry = () => {
        if (welcomePlayed) return;
        welcomePlayed = true;
        playWelcomeSound();
        document.removeEventListener("pointerdown", retry);
        document.removeEventListener("keydown", retry);
      };
      document.addEventListener("pointerdown", retry, { once: true });
      document.addEventListener("keydown", retry, { once: true });
    }
  }, 350);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", playWelcomeOnSimulatorEntry, { once: true });
} else {
  playWelcomeOnSimulatorEntry();
}


/* =========================================================
   MCDU ROW
========================================================= */

function mcduRow(
  label,
  value
) {

  return `

    <div class="mcdu-row">

      <span>
        ${label}
      </span>

      <strong>
        ${value}
      </strong>

    </div>

  `;

}


/* =========================================================
   MCDU
========================================================= */

function mcduStatusClass(status) {
  if (status === "WARNING") return "mcdu-status-warning";
  if (status === "CAUTION") return "mcdu-status-caution";
  return "mcdu-status-normal";
}

function mcduSetPage(page) {
  const valid = ["engine", "fadec", "events", "diagnostic"];
  if (!valid.includes(page)) return;
  currentPage = page;
  mcduScratchpad = "";
  logEvent(`MCDU PAGE — ${page.toUpperCase()}`);
  updateMCDU();
}

function mcduSetScratchpad(text) {
  mcduScratchpad = String(text).slice(0, 3);
  const input = $("mcduInput");
  if (input) {
    input.textContent = mcduScratchpad || "READY";
  }
}

function handleMcduKey(key) {
  const value = String(key).trim().toUpperCase();

  if (/^\d$/.test(value)) {
    if (mcduScratchpad.length < 3) {
      mcduScratchpad += value;
    }
      updateMCDU();
    return;
  }

  if (value === "CLR") {
    mcduScratchpad = "";
      updateMCDU();
    return;
  }

  if (value === "DEL") {
    mcduScratchpad = mcduScratchpad.slice(0, -1);
      updateMCDU();
    return;
  }

  if (value === "ENT") {
    if (mcduScratchpad !== "") {
      const numeric = Number(mcduScratchpad);
      if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 100) {
        setAirVolume(numeric, true);
        logEvent(`MCDU INPUT — AIR VOLUME SET ${Math.round(numeric)}%`);
        mcduSetPage("engine");
      } else {
        logEvent(`MCDU INPUT REJECTED — AIR VOLUME ${mcduScratchpad}%`);
        mcduSetScratchpad("");
        updateMCDU();
      }
    }
      return;
  }

  if (value === "MENU") {
    const order = ["engine", "fadec", "events", "diagnostic"];
    const next = order[(order.indexOf(currentPage) + 1) % order.length];
    mcduSetPage(next);
      return;
  }

  // Letter keys are accepted as MCDU scratchpad text.
  if (/^[A-Z]$/.test(value)) {
    if (mcduScratchpad.length < 12) mcduScratchpad += value;
      updateMCDU();
  }
}

function handleMcduLineSelect(side, index) {

  if (currentPage === "engine") {
    if (side === "L" && index === 0) startEngine();
    else if (side === "L" && index === 1) stopEngine();
    else if (side === "L" && index === 2) resetSystem();
    else if (side === "R" && index === 0) {
      if (mcduScratchpad !== "") handleMcduKey("ENT");
      else logEvent("MCDU LSK R1 — NO INPUT");
    }
    else if (side === "R" && index === 1) {
      mcduScratchpad = "";
      updateMCDU();
      logEvent("MCDU SCRATCHPAD CLEARED");
    }
  }

  else if (currentPage === "fadec") {
    if (side === "L" && index === 0) mcduSetPage("engine");
    else if (side === "R" && index === 0) acknowledgeWarning();
    else if (side === "R" && index === 1) mcduSetPage("diagnostic");
  }

  else if (currentPage === "events") {
    if (side === "L" && index === 0) mcduSetPage("engine");
    else if (side === "R" && index === 0) {
      faults = [];
      eventHistory = [];
      const log = $("eventLog");
      if (log) log.innerHTML = "";
      const count = $("logCount");
      if (count) count.textContent = "0 EVENTS";
      updateFaultDisplay();
      updateMCDU();
      logEvent("MCDU EVENT LOG CLEARED");
    }
  }

  else if (currentPage === "diagnostic") {
    if (side === "L" && index === 0) runDiagnostic();
    else if (side === "R" && index === 0) mcduSetPage("engine");
    else if (side === "R" && index === 1) mcduSetPage("fadec");
  }
}

function renderMcduRows(rows) {
  return rows.map(([label, value, cls = ""]) => `
    <div class="mcdu-row ${cls}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
}

function updateMCDU() {
  const air =
    $("airVolume")
      ? $("airVolume").value
      : 50;

  const values =
    getLiveEngineValues();

  const screen =
    $("mcduScreen");

  if (!screen)
    return;

  const airLevel = getAirVolumeLevel(air);

  if (currentPage === "engine") {
    screen.innerHTML = `
      <div class="mcdu-title">ENGINE 1 — ENGINE CONTROL</div>

      ${renderMcduRows([
        ["ENGINE", engineRunning ? "RUNNING" : "OFF"],
        ["START STATE", engineStarting ? "SPOOL-UP" : engineStopping ? "SPOOL-DOWN" : "STABLE"],
        ["AIR VOLUME", `${Math.round(air)} %`],
        ["N1", `${values.n1.toFixed(1)} %`],
        ["N2", `${values.n2.toFixed(1)} %`],
        ["EGT", `${values.egt.toFixed(0)} °C`]
      ])}

      <div class="mcdu-command-grid">
        <span>L1 START</span><span>L2 STOP</span><span>L3 RESET</span>
      </div>

      <div class="mcdu-input">
        ${mcduScratchpad ? `AIR VOLUME: ${mcduScratchpad}%` : "ENTER AIR VOLUME 0–100"}
      </div>

      <div class="mcdu-note">
        TYPE NUMBERS → ENT TO SET AIR VOLUME
      </div>
    `;
    $("pageNo").textContent = "1 / 4";
  }

  else if (currentPage === "fadec") {
    const overall =
      engineRunning ? currentLevel.toUpperCase() : "OFF";

    screen.innerHTML = `
      <div class="mcdu-title">FADEC — SYSTEM STATUS</div>

      ${renderMcduRows([
        ["FADEC", engineRunning ? "ACTIVE" : "OFF"],
        ["ENGINE", engineRunning ? "RUNNING" : "OFF"],
        ["STATUS", overall, mcduStatusClass(currentLevel.toUpperCase())],
        ["N1 LIMIT", "85 / 95 %"],
        ["N2 LIMIT", "85 / 95 %"],
        ["EGT LIMIT", "750 / 850 °C"],
        ["FAULTS", faults.length ? faults.length : "NONE"],
        ["AIR INPUT", `${Math.round(air)} %`]
      ])}

      <div class="mcdu-input">
        R1 ACKNOWLEDGE ACTIVE ALERT
      </div>

      <div class="mcdu-note">
        FADEC CONTINUOUS LIMIT MONITORING
      </div>
    `;
    $("pageNo").textContent = "2 / 4";
  }

  else if (currentPage === "events") {
    const recent = eventHistory.slice(0, 8);

    screen.innerHTML = `
      <div class="mcdu-title">FADEC — EVENT LOG</div>

      <div class="mcdu-event-list">
        ${
          recent.length
            ? recent.map(event => `
                <div class="mcdu-event">
                  <span>${event.time}</span>
                  <strong>${event.message}</strong>
                </div>
              `).join("")
            : `<div class="mcdu-event empty">NO EVENTS</div>`
        }
      </div>

      <div class="mcdu-input">
        R1 CLEAR EVENT LOG
      </div>

      <div class="mcdu-note">
        ${eventHistory.length} EVENTS STORED
      </div>
    `;
    $("pageNo").textContent = "3 / 4";
  }

  else {
    const checks = [
      ["N1", getParameterStatus("N1", values.n1)],
      ["N2", getParameterStatus("N2", values.n2)],
      ["EGT", getParameterStatus("EGT", values.egt)],
      ["PRESSURE", getParameterStatus("PRESSURE", values.pressure)],
      ["FUEL FLOW", getParameterStatus("FUEL", values.fuelFlow)],
      ["AIRFLOW", getParameterStatus("AIRFLOW", values.airflow)],
      ["AIR VOLUME", airLevel.toUpperCase()]
    ];

    const passed = checks.every(([, status]) => status === "NORMAL");

    screen.innerHTML = `
      <div class="mcdu-title">FADEC — DIAGNOSTICS</div>

      ${checks.map(([name, status]) => `
        <div class="mcdu-diagnostic-line ${mcduStatusClass(status)}">
          <span>${name.padEnd(12, " ")}</span>
          <strong>
            ${status === "NORMAL" ? "✓ NORMAL" : status === "CAUTION" ? "▲ CAUTION" : "✕ FAULT"}
          </strong>
        </div>
      `).join("")}

      <div class="mcdu-input">
        RESULT: ${passed ? "AIRWORTHY" : "REQUIRES MAINTENANCE"}
      </div>

      <div class="mcdu-note">
        L1 RUN DIAGNOSTIC • R2 FADEC STATUS
      </div>
    `;
    $("pageNo").textContent = "4 / 4";
  }
}

/* =========================================================
   UPDATE ENGINE VALUES
========================================================= */

function updateValues() {

  const air =
    Number(
      $("airVolume")
        ? $("airVolume").value
        : 50
    );


  if ($("airDisplay")) {

    $("airDisplay")
      .textContent =
      `${air}%`;

  }


  updateArcSlider(
    air
  );


  /* =====================================================
     ENGINE OFF
  ===================================================== */

  if (!engineRunning) {

    const zeroValues = {

      n1: 0,

      n2: 0,

      egt: 0,

      airflow: 0,

      pressure: 0,

      fuelFlow: 0

    };


    liveValues = {
      ...zeroValues
    };


    updateGauges(
      zeroValues
    );


    updateDiagnosticPanel(
      zeroValues
    );


    updateMCDU();


    return;

  }


  /* =====================================================
     ENGINE RUNNING
  ===================================================== */

  const values =
    getLiveEngineValues();


  updateGauges(
    values
  );


  updateDiagnosticPanel(
    values
  );


  checkFADEC(
    values
  );


  updateMCDU();

}


/* =========================================================
   LIVE ENGINE UPDATE LOOP
========================================================= */

function runLiveEngineLoop() {

  if (engineRunning) {

    updateSensorTargets();

    smoothSensorValues();

  }


  updateValues();

}


/* =========================================================
   START LIVE SENSOR LOOP
========================================================= */

function startSensorLoop() {

  if (sensorTimer)
    return;


  /*
     500 ms gives the display a realistic moving
     instrument feel without excessive CPU usage.
  */

  sensorTimer =
    setInterval(
      runLiveEngineLoop,
      500
    );

}


/* =========================================================
   FADEC MONITORING
========================================================= */

function checkFADEC(
  values
) {

  // Never allow an alert to persist while the engine is not running.
  if (!engineRunning) {
    currentLevel = "normal";
    currentAlertKey = "";
    acknowledgedAlertKey = "";
    stopAlertAudio();
    flashAlert("normal");
    return;
  }

  const now =
    Date.now();


  /*
     Do not run the complete FADEC alert logic
     more than approximately twice per second.
  */

  if (
    now -
    lastFADECCheck <
    450
  ) {

    return;

  }


  lastFADECCheck =
    now;


  const air =
    Number(
      $("airVolume").value
    );


  const parameterLevel =
    getOverallParameterStatus(
      values
    );


  const airLevel =
    getAirVolumeLevel(
      air
    );


  let newLevel =
    "normal";


  /*
     AIR VOLUME HAS PRIORITY
  */

  if (
    airLevel ===
    "warning"
  ) {

    newLevel =
      "warning";

  }

  else if (
    parameterLevel ===
    "warning"
  ) {

    newLevel =
      "warning";

  }

  else if (
    airLevel ===
    "caution"
  ) {

    newLevel =
      "caution";

  }

  else if (
    parameterLevel ===
    "caution"
  ) {

    newLevel =
      "caution";

  }


  currentLevel =
    newLevel;

  // Unique identity for the current alert. Including air volume
  // allows a newly triggered condition at a different air volume
  // to require a fresh acknowledgement.
  let alertIdentity = newLevel;

  if (newLevel !== "normal") {
    alertIdentity += "-AIR-" + Math.round(air);

    if (newLevel === "warning") {
      if (airLevel === "warning") {
        alertIdentity += "-ENGINE-OVERLOAD";
      } else {
        alertIdentity += "-" + getParameterFaults(values)
          .map(f => f.title).join("-");
      }
    } else {
      alertIdentity += "-" + getParameterCautions(values)
        .map(c => c.replace(/\s+/g, "-")).join("-");
    }
  }

  currentAlertKey = alertIdentity;

  // Continuous flash while unacknowledged. Once acknowledged,
  // the flash stops until the condition becomes normal or a new
  // alert identity (such as a different air volume) is triggered.
  if (newLevel === "normal") {
    acknowledgedAlertKey = "";
    flashAlert("normal");
  } else if (acknowledgedAlertKey !== alertIdentity) {
    flashAlert(newLevel);
  } else {
    flashAlert("normal");
  }


  /*
     Build a unique alert key.

     This prevents the simulator from playing
     the warning sound and creating a new log
     entry every 500 ms.
  */

  let alertKey =
    alertIdentity;


  if (
    newLevel ===
    "warning"
  ) {

    if (
      airLevel ===
      "warning"
    ) {

      alertKey +=
        "-AIR";

    }

    else {

      alertKey +=
        "-" +
        getParameterFaults(
          values
        )
          .map(
            f =>
              f.title
          )
          .join("-");

    }

  }


  const alertChanged =
    alertKey !==
    lastAlertKey;


  /*
     ======================================================
     WARNING
     ======================================================
  */

  if (
    newLevel ===
    "warning"
  ) {

    const shouldAlert =
      alertChanged ||
      (
        now -
        lastAlertTime >
        10000
      );


    if (
      airLevel ===
      "warning"
    ) {

      const faultTitle =
        "ENGINE OVERLOAD";


      const faultDescription =
        "Critical air volume input";


      addFaultObject(
        faultTitle,
        faultDescription
      );


      setWarning(

        "warning",

        "⚠ WARNING",

        "AIR VOLUME INPUT CRITICAL"

      );


      if ($("engineStatus")) {

        $("engineStatus")
          .textContent =
          "REQUIRES MAINTENANCE";

      }


      if (shouldAlert) {

        logEvent(
          "WARNING — ENGINE OVERLOAD — AIR VOLUME " +
          air +
          "%"
        );

      }

    }

    else {

      const parameterFaults =
        getParameterFaults(
          values
        );


      parameterFaults.forEach(
        fault => {

          addFaultObject(
            fault.title,
            fault.description
          );

        }
      );


      setWarning(

        "warning",

        "⚠ WARNING",

        parameterFaults
          .map(
            fault =>
              fault.description
          )
          .join(" • ")

      );


      if ($("engineStatus")) {

        $("engineStatus")
          .textContent =
          "REQUIRES MAINTENANCE";

      }


      if (shouldAlert) {

        logEvent(

          "WARNING — " +

          parameterFaults
            .map(
              fault =>
                fault.title
            )
            .join(", ")

        );

      }

    }


    updateFaultDisplay();


    if (alertChanged) {

      lastAlertTime =
        now;

    }


    lastAlertKey =
      alertKey;


    return;

  }


  /*
     ======================================================
     CAUTION
     ======================================================
  */

  if (
    newLevel ===
    "caution"
  ) {

    const shouldAlert =
      alertChanged ||
      (
        now -
        lastAlertTime >
        12000
      );


    let cautionParameters =
      getParameterCautions(
        values
      );


    if (
      airLevel ===
      "caution"
    ) {

      cautionParameters.unshift(
        "AIR VOLUME " +
        air +
        "% ABOVE NORMAL RANGE"
      );

    }


    setWarning(

      "caution",

      "⚠ CAUTION",

      cautionParameters
        .join(" • ")

    );


    if ($("engineStatus")) {

      $("engineStatus")
        .textContent =
        "MAINTENANCE REQUIRED";

    }


    if (shouldAlert) {

      logEvent(
        "CAUTION — " +
        cautionParameters
          .join(", ")
      );


      lastAlertTime =
        now;

    }


    lastAlertKey =
      alertKey;


    updateFaultDisplay();


    return;

  }


  /*
     ======================================================
     NORMAL
     ======================================================
  */

  setWarning(

    "normal",

    "✓ SYSTEM NORMAL",

    "No abnormal parameter detected."

  );


  if ($("engineStatus")) {

    $("engineStatus")
      .textContent =
      "AIRWORTHY";

  }


  lastAlertKey =
    "normal";

  acknowledgedAlertKey =
    "";

  currentAlertKey =
    "normal";


  updateFaultDisplay();

}


/* =========================================================
   GET PARAMETER FAULTS
========================================================= */

function getParameterFaults(
  values
) {

  const result =
    [];


  if (
    getParameterStatus(
      "N1",
      values.n1
    ) ===
    "WARNING"
  ) {

    result.push({

      title:
        "N1 OUT OF LIMIT",

      description:
        `N1 ${values.n1.toFixed(1)}% exceeds warning limit`

    });

  }


  if (
    getParameterStatus(
      "N2",
      values.n2
    ) ===
    "WARNING"
  ) {

    result.push({

      title:
        "N2 OUT OF LIMIT",

      description:
        `N2 ${values.n2.toFixed(1)}% exceeds warning limit`

    });

  }


  if (
    getParameterStatus(
      "EGT",
      values.egt
    ) ===
    "WARNING"
  ) {

    result.push({

      title:
        "EGT HIGH",

      description:
        `EGT ${values.egt.toFixed(0)}°C exceeds warning limit`

    });

  }


  if (
    getParameterStatus(
      "PRESSURE",
      values.pressure
    ) ===
    "WARNING"
  ) {

    result.push({

      title:
        "PRESSURE LOW",

      description:
        `Pressure ${values.pressure.toFixed(1)} PSI below warning limit`

    });

  }


  if (
    getParameterStatus(
      "FUEL",
      values.fuelFlow
    ) ===
    "WARNING"
  ) {

    result.push({

      title:
        "FUEL FLOW HIGH",

      description:
        `Fuel flow ${values.fuelFlow.toFixed(0)} KG/H exceeds warning limit`

    });

  }


  if (
    getParameterStatus(
      "AIRFLOW",
      values.airflow
    ) ===
    "WARNING"
  ) {

    result.push({

      title:
        "AIRFLOW HIGH",

      description:
        `Airflow ${values.airflow.toFixed(2)} KG/S exceeds warning limit`

    });

  }


  return result;

}


/* =========================================================
   GET PARAMETER CAUTIONS
========================================================= */

function getParameterCautions(
  values
) {

  const result =
    [];


  if (
    getParameterStatus(
      "N1",
      values.n1
    ) ===
    "CAUTION"
  ) {

    result.push(
      `N1 ${values.n1.toFixed(1)}% high`
    );

  }


  if (
    getParameterStatus(
      "N2",
      values.n2
    ) ===
    "CAUTION"
  ) {

    result.push(
      `N2 ${values.n2.toFixed(1)}% high`
    );

  }


  if (
    getParameterStatus(
      "EGT",
      values.egt
    ) ===
    "CAUTION"
  ) {

    result.push(
      `EGT ${values.egt.toFixed(0)}°C high`
    );

  }


  if (
    getParameterStatus(
      "PRESSURE",
      values.pressure
    ) ===
    "CAUTION"
  ) {

    result.push(
      `Pressure ${values.pressure.toFixed(1)} PSI low`
    );

  }


  if (
    getParameterStatus(
      "FUEL",
      values.fuelFlow
    ) ===
    "CAUTION"
  ) {

    result.push(
      `Fuel flow ${values.fuelFlow.toFixed(0)} KG/H high`
    );

  }


  if (
    getParameterStatus(
      "AIRFLOW",
      values.airflow
    ) ===
    "CAUTION"
  ) {

    result.push(
      `Airflow ${values.airflow.toFixed(2)} KG/S high`
    );

  }


  return result;

}


/* =========================================================
   FAULT OBJECT
========================================================= */

function addFaultObject(
  title,
  description
) {

  const exists =
    faults.some(
      fault =>
        fault.title ===
        title
    );


  if (exists)
    return;


  faults.push({

    title,

    description,

    time:
      timeNow()

  });

}


/* =========================================================
   UPDATE FAULT DISPLAY
========================================================= */

function updateFaultDisplay() {

  const faultLog =
    $("faultLog");


  if (!faultLog)
    return;


  if (
    faults.length ===
    0
  ) {

    faultLog.innerHTML = `

      <div class="fault-row">

        <span>---</span>

        <span>NO FAULTS</span>

        <span>--:--:--</span>

      </div>

    `;

  }

  else {

    faultLog.innerHTML =

      faults
        .map(
          fault => `

            <div class="fault-row">

              <span>⚠</span>

              <span>
                ${fault.title}
              </span>

              <span>
                ${fault.time}
              </span>

            </div>

          `
        )
        .join("");

  }


  if ($("faultCount")) {

    $("faultCount")
      .textContent =
      `${faults.length} FAULTS`;

  }


  if ($("faultTotal")) {

    $("faultTotal")
      .textContent =
      faults.length;

  }

}


/* =========================================================
   WARNING PANEL
========================================================= */

function setWarning(
  level,
  title,
  subtitle
) {

  const box =
    $("warningBox");


  if (!box)
    return;


  box.classList.remove(

    "normal",

    "caution",

    "warning"

  );


  box.classList.add(
    level
  );


  if ($("warningText")) {

    $("warningText")
      .textContent =
      title;

  }


  if ($("warningSub")) {

    $("warningSub")
      .textContent =
      subtitle;

  }

  if ($("ackBtn")) {

    $("ackBtn")
      .textContent =
      level === "warning"
        ? "ACKNOWLEDGE WARNING"
        : level === "caution"
          ? "ACKNOWLEDGE CAUTION"
          : "ACKNOWLEDGE";

  }

}


/* =========================================================
   START ENGINE
========================================================= */

function startEngine() {

  if (engineRunning)
    return;


  engineRunning =
    true;


  engineStarting =
    true;


  engineStopping =
    false;


  /*
     Start from the nominal NORMAL condition for
     0% air volume. This prevents the initial
     zero-pressure sensor state from being interpreted
     as a warning while the engine starts.
  */

  liveValues = calculateEngine(0);

  sensorNoise = {

    airflow: 0,

    n1: 0,

    n2: 0,

    egt: 0,

    pressure: 0,

    fuelFlow: 0

  };


  updateSensorTargets();

  currentLevel = "normal";
  previousLevel = "normal";
  lastAlertKey = "";
  lastAlertTime = 0;
  flashAlert("normal");

  setWarning(
    "normal",
    "SYSTEM NORMAL",
    "All engine parameters within normal limits."
  );

  if ($("engineStatus")) {
    $("engineStatus").textContent = "NORMAL";
  }


  if ($("engineTop")) {

    $("engineTop")
      .textContent =
      "RUNNING";

  }


  if ($("fadecTop")) {

    $("fadecTop")
      .textContent =
      "ACTIVE";

  }


  startEngineAudio();


  logEvent(
    "ENGINE STARTED — FADEC ACTIVE — SENSOR SPOOL-UP"
  );


  /*
     Engine starting state lasts approximately
     5 seconds before normal sensor response.
  */

  setTimeout(
    () => {

      engineStarting =
        false;

    },
    5000
  );


  updateValues();

}


/* =========================================================
   STOP ENGINE
========================================================= */

function stopEngine() {

  if (!engineRunning)
    return;


  engineRunning =
    false;


  engineStarting =
    false;


  engineStopping =
    true;


  /*
     Keep the last sensor values momentarily,
     then smoothly decay them toward zero.
  */

  sensorTargets = {

    airflow: 0,

    n1: 0,

    n2: 0,

    egt: 0,

    pressure: 0,

    fuelFlow: 0

  };


  if ($("engineTop")) {

    $("engineTop")
      .textContent =
      "OFF";

  }


  if ($("fadecTop")) {

    $("fadecTop")
      .textContent =
      "OFF";

  }


  currentLevel =
    "normal";


  lastAlertKey =
    "";


  setWarning(

    "normal",

    "SYSTEM OFF",

    "Engine stopped. Start engine to resume monitoring."

  );


  if ($("engineStatus")) {

    $("engineStatus")
      .textContent =
      "OFF";

  }


  updateFaultDisplay();


  stopEngineAudio();


  logEvent(
    "ENGINE STOPPED — FADEC OFF"
  );


  /*
     Gradually bring gauges to zero.
  */

  const shutdownTimer =
    setInterval(
      () => {

        Object.keys(
          liveValues
        ).forEach(
          key => {

            liveValues[key] *=
              0.65;

          }
        );


        updateValues();


        const remaining =
          Math.max(
            liveValues.n1,
            liveValues.n2,
            liveValues.egt,
            liveValues.airflow,
            liveValues.pressure,
            liveValues.fuelFlow
          );


        if (
          remaining <
          0.5
        ) {

          clearInterval(
            shutdownTimer
          );


          liveValues = {

            airflow: 0,

            n1: 0,

            n2: 0,

            egt: 0,

            pressure: 0,

            fuelFlow: 0

          };


          engineStopping =
            false;


          updateValues();

        }

      },
      150
    );

}


/* =========================================================
   RESET
========================================================= */

function resetSystem() {

  engineRunning =
    false;


  engineStarting =
    false;


  engineStopping =
    false;


  if ($("airVolume")) {

    $("airVolume")
      .value =
      10;

  }


  faults =
    [];


  currentLevel =
    "normal";


  previousLevel =
    "normal";


  lastAlertKey =
    "";

  acknowledgedAlertKey =
    "";

  currentAlertKey =
    "normal";


  lastAlertTime =
    0;

  flashAlert("normal");

  setWarning(
    "normal",
    "SYSTEM NORMAL",
    "All engine parameters within normal limits."
  );

  liveValues = {

    airflow: 0,

    n1: 0,

    n2: 0,

    egt: 0,

    pressure: 0,

    fuelFlow: 0

  };


  sensorTargets = {

    airflow: 0,

    n1: 0,

    n2: 0,

    egt: 0,

    pressure: 0,

    fuelFlow: 0

  };


  if ($("engineTop")) {

    $("engineTop")
      .textContent =
      "OFF";

  }


  if ($("fadecTop")) {

    $("fadecTop")
      .textContent =
      "OFF";

  }


  eventHistory = [];

  if ($("eventLog")) {

    $("eventLog")
      .innerHTML =
      "";

  }


  if ($("logCount")) {

    $("logCount")
      .textContent =
      "0 EVENTS";

  }


  if ($("faultCount")) {

    $("faultCount")
      .textContent =
      "0 FAULTS";

  }


  if ($("faultTotal")) {

    $("faultTotal")
      .textContent =
      "0";

  }


  if ($("engineStatus")) {

    $("engineStatus")
      .textContent =
      "AIRWORTHY";

  }


  setWarning(

    "normal",

    "✓ SYSTEM RESET",

    "System returned to initial training state."

  );


  logEvent(
    "SYSTEM RESET"
  );


  updateValues();

}


/* =========================================================
   AIR VOLUME
========================================================= */

function airInputChanged() {

  if ($("inputLamp")) {

    $("inputLamp")
      .classList
      .add(
        "active"
      );

  }


  playSound(
    "input"
  );


  /*
     Immediately update the target.

     The actual engine values will then smoothly
     move toward the new operating condition.
  */

  updateSensorTargets();


  updateValues();

}


/* =========================================================
   CURVED SLIDER
========================================================= */

const AIR_START =
  200;


const AIR_END =
  340;


const AIR_CX =
  140;


const AIR_CY =
  125;


const AIR_R =
  105;


/* =========================================================
   POLAR POINT
========================================================= */

function polarPoint(
  cx,
  cy,
  r,
  degrees
) {

  const rad =
    degrees *
    Math.PI /
    180;


  return {

    x:
      cx +
      r *
      Math.cos(rad),

    y:
      cy +
      r *
      Math.sin(rad)

  };

}


/* =========================================================
   UPDATE ARC
========================================================= */

function updateArcSlider(value) {
  const pct = clamp(Number(value), 0, 100);
  const slider = $("airSlider");
  const knob = $("airKnob");
  const fill = $("airThrottleFill");

  if (knob) knob.style.bottom = `calc(${pct}% - 13px)`;
  if (fill) fill.style.height = `${pct}%`;
  if (slider) slider.setAttribute("aria-valuenow", String(Math.round(pct)));
  if ($("airDisplay")) $("airDisplay").textContent = `${Math.round(pct)}%`;

  if ($("throttleMode")) {
    const mode = pct >= 95 ? "TOGA / MAX POWER" : pct >= 80 ? "MAX CONTINUOUS" : pct >= 60 ? "CLIMB POWER" : pct >= 35 ? "CRUISE POWER" : pct > 0 ? "IDLE / LOW POWER" : "CUTOFF";
    $("throttleMode").textContent = mode;
  }
}

function setAirVolume(value, shouldLog = false) {
  const v = Math.round(clamp(value, 0, 100));
  if ($("airVolume")) $("airVolume").value = v;
  if (shouldLog) airInputChanged(); else updateSensorTargets();
  updateValues();
}

function applyThrottleDetent(value) {
  const detents = [0, 18, 35, 55, 75, 90, 100];
  const nearest = detents.reduce((best, d) =>
    Math.abs(d - value) < Math.abs(best - value) ? d : best, detents[0]);
  return Math.abs(nearest - value) <= 1.25 ? nearest : value;
}

function airPointerValue(event) {
  const slider = $("airSlider");
  if (!slider) return 50;
  const gate = slider.querySelector(".throttle-gate");
  if (!gate) return 50;
  const rect = gate.getBoundingClientRect();
  const y = clamp(event.clientY, rect.top, rect.bottom);
  return applyThrottleDetent(((rect.bottom - y) / rect.height) * 100);
}

function initAircraftThrottle() {
  const slider = $("airSlider");
  if (!slider) return;
  let dragging = false;
  let lastValue = Number($("airVolume")?.value || 10);

  const move = e => {
    if (!dragging) return;
    const value = Math.round(airPointerValue(e));
    if (value !== lastValue) {
      lastValue = value;
      setAirVolume(value, false);
      playSound("input");
    }
  };
  const up = () => {
    dragging = false;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };

  slider.addEventListener("pointerdown", e => {
    if (e.target.closest(".throttle-readout")) return;
    dragging = true;
    slider.setPointerCapture?.(e.pointerId);
    lastValue = Math.round(airPointerValue(e));
    setAirVolume(lastValue, false);
    playSound("input");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  slider.addEventListener("keydown", e => {
    const current = Number($("airVolume")?.value || 0);
    let next;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") next = current + 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = current - 1;
    else if (e.key === "PageUp") next = current + 5;
    else if (e.key === "PageDown") next = current - 5;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 100;
    else return;
    e.preventDefault();
    setAirVolume(next, false);
    playSound("input");
  });
}

/* =========================================================
   GAUGES
========================================================= */

function updateGauge(
  id,
  value,
  max,
  unit,
  decimals = 1
) {

  const progress =
    $(id);


  if (!progress)
    return;


  const pct =
    Math.max(

      0,

      Math.min(

        100,

        (
          Number(value) /
          max
        ) *

        100

      )

    );


  const dash =
    pct *
    0.78;


  progress.style.strokeDasharray =

    `${dash} ${100 - dash}`;


  progress.style.strokeDashoffset =
    "-11";


  const gauge =
    progress.closest(
      ".gauge"
    );


  if (gauge) {

    gauge.classList.remove(

      "caution",

      "warning"

    );


    let parameterType =
      null;


    if (
      id ===
      "gaugeN1"
    ) {

      parameterType =
        "N1";

    }


    if (
      id ===
      "gaugeN2"
    ) {

      parameterType =
        "N2";

    }


    if (
      id ===
      "gaugeEGT"
    ) {

      parameterType =
        "EGT";

    }


    if (
      id ===
      "gaugePressure"
    ) {

      parameterType =
        "PRESSURE";

    }


    if (
      id ===
      "gaugeFuel"
    ) {

      parameterType =
        "FUEL";

    }


    if (
      id ===
      "gaugeAirflow"
    ) {

      parameterType =
        "AIRFLOW";

    }


    if (parameterType) {

      const status =
        getParameterStatus(

          parameterType,

          value

        );


      if (
        status ===
        "CAUTION"
      ) {

        gauge.classList.add(
          "caution"
        );

      }


      if (
        status ===
        "WARNING"
      ) {

        gauge.classList.add(
          "warning"
        );

      }

    }

  }


  const valueEl =
    $(id + "Value");


  if (valueEl) {

    valueEl.textContent =

      `${Number(value).toFixed(decimals)} ${unit}`;

  }

}


/* =========================================================
   UPDATE ALL GAUGES
========================================================= */

function updateGauges(
  values
) {

  updateGauge(

    "gaugeN1",

    values.n1,

    100,

    "%",

    1

  );


  updateGauge(

    "gaugeN2",

    values.n2,

    100,

    "%",

    1

  );


  updateGauge(

    "gaugeEGT",

    values.egt,

    900,

    "°C",

    0

  );


  updateGauge(

    "gaugeAirflow",

    values.airflow,

    2.5,

    "KG/S",

    2

  );


  updateGauge(

    "gaugePressure",

    values.pressure,

    80,

    "PSI",

    1

  );


  updateGauge(

    "gaugeFuel",

    values.fuelFlow,

    1200,

    "KG/HR",

    0

  );

}


/* =========================================================
   DIAGNOSTIC PANEL
========================================================= */

function updateDiagnosticPanel(
  values
) {

  const checks = {

    diagN1:

      getParameterStatus(

        "N1",

        values.n1

      ),


    diagN2:

      getParameterStatus(

        "N2",

        values.n2

      ),


    diagEGT:

      getParameterStatus(

        "EGT",

        values.egt

      ),


    diagPressure:

      getParameterStatus(

        "PRESSURE",

        values.pressure

      ),


    diagFuel:

      getParameterStatus(

        "FUEL",

        values.fuelFlow

      )

  };


  Object.entries(
    checks
  ).forEach(

    ([id, status]) => {

      const el =
        $(id);


      if (!el)
        return;


      el.textContent =

        status ===
        "NORMAL"

          ? "✓ NORMAL"

          : status ===
            "CAUTION"

              ? "▲ CAUTION"

              : "✕ FAULT";


      el.classList.remove(

        "caution",

        "warning"

      );


      if (
        status ===
        "CAUTION"
      ) {

        el.classList.add(
          "caution"
        );

      }


      if (
        status ===
        "WARNING"
      ) {

        el.classList.add(
          "warning"
        );

      }

    }

  );


  const totalFaults =

    Object.values(
      checks
    )

    .filter(

      status =>
        status ===
        "WARNING"

    )

    .length;


  if ($("faultTotal")) {

    $("faultTotal")
      .textContent =
      String(
        totalFaults
      );

  }

}


/* =========================================================
   DIAGNOSTIC COMMAND
========================================================= */

function runDiagnostic() {

  if (!engineRunning) {

    if ($("diagResult")) {

      $("diagResult")
        .textContent =
        "START ENGINE FIRST.";

    }


    logEvent(
      "DIAGNOSTIC REQUESTED — ENGINE OFF"
    );


    return;

  }


  const values =
    getLiveEngineValues();


  const checks = [

    [

      "N1",

      getParameterStatus(

        "N1",

        values.n1

      )

    ],


    [

      "N2",

      getParameterStatus(

        "N2",

        values.n2

      )

    ],


    [

      "EGT",

      getParameterStatus(

        "EGT",

        values.egt

      )

    ],


    [

      "PRESSURE",

      getParameterStatus(

        "PRESSURE",

        values.pressure

      )

    ],


    [

      "FUEL FLOW",

      getParameterStatus(

        "FUEL",

        values.fuelFlow

      )

    ],


    [

      "AIRFLOW",

      getParameterStatus(

        "AIRFLOW",

        values.airflow

      )

    ]

  ];


  const airLevel =
    getAirVolumeLevel(

      $("airVolume").value

    );


  const hasWarning =

    checks.some(

      check =>
        check[1] ===
        "WARNING"

    )

    ||

    airLevel ===
    "warning";


  const hasCaution =

    checks.some(

      check =>
        check[1] ===
        "CAUTION"

    )

    ||

    airLevel ===
    "caution";


  const passed =

    !hasWarning &&
    !hasCaution;


  if ($("diagResult")) {

    $("diagResult")
      .textContent =

      "FADEC DIAGNOSTIC\n\n" +

      checks

        .map(

          ([name, status]) =>

            `${name.padEnd(12)} ${
              status ===
              "NORMAL"

                ? "✓ NORMAL"

                : status ===
                  "CAUTION"

                    ? "▲ CAUTION"

                    : "✕ FAULT"

            }`

        )

        .join("\n") +

      "\n\nAIR VOLUME:\n" +

      (

        airLevel ===
        "normal"

          ? "✓ NORMAL"

          : airLevel ===
            "caution"

              ? "▲ CAUTION"

              : "✕ WARNING"

      ) +

      "\n\nRESULT:\n" +

      (

        passed

          ? "AIRWORTHY"

          : "REQUIRES MAINTENANCE"

      );

  }


  currentPage =
    "diagnostic";


  updateMCDU();


  logEvent(

    "DIAGNOSTIC RUN — " +

    (

      passed

        ? "AIRWORTHY"

        : hasWarning

          ? "REQUIRES MAINTENANCE"

          : "CAUTION CONDITION"

    )

  );

}


/* =========================================================
   ACKNOWLEDGE
========================================================= */

function acknowledgeWarning() {

  if (
    currentLevel ===
    "warning" ||
    currentLevel ===
    "caution"
  ) {

    acknowledgedAlertKey =
      currentAlertKey;

    playSound("acknowledge");
    stopAlertAudio();

    // Stop the full-screen flash while keeping the active
    // caution/warning condition visible on the simulator.
    flashAlert("normal");

    if ($("warningSub")) {

      $("warningSub")
        .textContent =
        currentLevel === "warning"
          ? "WARNING ACKNOWLEDGED — fault remains active until resolved."
          : "CAUTION ACKNOWLEDGED — condition remains active.";

    }

    if ($("ackBtn")) {
      $("ackBtn")
        .textContent =
        "ACKNOWLEDGED";
    }

    logEvent(
      currentLevel === "warning"
        ? "WARNING ACKNOWLEDGED"
        : "CAUTION ACKNOWLEDGED"
    );

    return;

  }


  if ($("warningSub")) {

    $("warningSub")
      .textContent =
      "No active warning or caution.";

  }

}


/* =========================================================
   CBT ASSESSMENT — 4 QUESTIONS
========================================================= */

const CBT_QUESTIONS = [
  {
    question: "Question 1 of 4: What should the FADEC system determine when a programmed operating limit is exceeded?",
    answers: {
      A: "AIRWORTHY",
      B: "REQUIRES MAINTENANCE",
      C: "NORMAL",
      D: "IGNORE THE WARNING"
    },
    correct: "B",
    feedback: "EXCEEDED LIMITS REQUIRE MAINTENANCE."
  },
  {
    question: "Question 2 of 4: At what Air Volume level does the FADEC generate a CAUTION?",
    answers: {
      A: "25%",
      B: "50%",
      C: "75%",
      D: "95%"
    },
    correct: "C",
    feedback: "CAUTION begins at 75% Air Volume."
  },
  {
    question: "Question 3 of 4: At what Air Volume level does the FADEC generate a WARNING?",
    answers: {
      A: "60%",
      B: "75%",
      C: "85%",
      D: "90%"
    },
    correct: "D",
    feedback: "WARNING begins at 90% Air Volume."
  },
  {
    question: "Question 4 of 4: What is the purpose of the ACKNOWLEDGE control?",
    answers: {
      A: "Clear the fault permanently",
      B: "Stop the engine automatically",
      C: "Silence the alert and stop the active flash while the fault remains",
      D: "Increase Air Volume"
    },
    correct: "C",
    feedback: "ACKNOWLEDGE silences the alert/flash; it does not clear the fault."
  }
];

function renderCBTQuestion() {
  const q = CBT_QUESTIONS[currentQuestionIndex];
  const questionEl = $("quizQuestion");
  const scoreEl = $("score");
  const resultEl = $("quizResult");

  if (questionEl) questionEl.textContent = q.question;
  if (scoreEl) scoreEl.textContent = `SCORE ${score}/4`;
  if (resultEl) {
    resultEl.textContent = currentQuestionIndex === 0 && questions === 0
      ? "ASSESSMENT READY — 4 QUESTIONS"
      : `QUESTION ${currentQuestionIndex + 1} OF 4`;
    resultEl.style.color = "";
  }

  document.querySelectorAll(".answers button").forEach(button => {
    const key = button.dataset.answer;
    button.textContent = `${key}. ${q.answers[key]}`;
    button.disabled = false;
    button.style.opacity = "";
  });
}

function answerQuestion(answer) {
  const q = CBT_QUESTIONS[currentQuestionIndex];
  const correct = answer === q.correct;
  questions++;
  if (correct) score++;

  document.querySelectorAll(".answers button").forEach(button => {
    button.disabled = true;
    button.style.opacity = button.dataset.answer === q.correct ? "1" : "0.65";
  });

  if ($("score")) $("score").textContent = `SCORE ${score}/4`;

  if ($("quizResult")) {
    $("quizResult").textContent = correct
      ? `✓ CORRECT — ${q.feedback}`
      : `✕ INCORRECT — ${q.feedback}`;
    $("quizResult").style.color = correct ? "var(--green)" : "var(--red)";
  }

  setTimeout(() => {
    if (currentQuestionIndex < CBT_QUESTIONS.length - 1) {
      currentQuestionIndex++;
      renderCBTQuestion();
    } else if ($("quizResult")) {
      $("quizResult").textContent = `ASSESSMENT COMPLETE — FINAL SCORE ${score}/4`;
      $("quizResult").style.color = score === 4 ? "var(--green)" : "var(--cyan)";
    }
  }, 1200);
}

renderCBTQuestion();


/* =========================================================
   INITIAL STATE
========================================================= */

if ($("airVolume")) {

  $("airVolume")
    .value =
    10;

}


liveValues = {

  airflow: 0,

  n1: 0,

  n2: 0,

  egt: 0,

  pressure: 0,

  fuelFlow: 0

};


sensorTargets = {

  airflow: 0,

  n1: 0,

  n2: 0,

  egt: 0,

  pressure: 0,

  fuelFlow: 0

};


updateValues();


initAircraftThrottle();


updateArcSlider(
  10
);


updateMCDU();




startSensorLoop();


logEvent(
  "CBT INITIALIZED — LIVE SENSOR MODEL — AIR VOLUME 10%"
);
function showReturnLoading() {
  const screen = $("returnLoadingScreen");
  const progress = $("returnLoadingProgress");
  const percent = $("returnLoadingPercent");
  const status = $("returnLoadingStatus");
  if (!screen) return;

  screen.classList.add("active");
  screen.setAttribute("aria-hidden", "false");

  const messages = [
    "SAVING SIMULATOR SESSION",
    "STOPPING FADEC SERVICES",
    "CLOSING SENSOR NETWORK",
    "DISCONNECTING MCDU",
    "RETURNING TO HOME SYSTEM"
  ];

  let value = 0;
  let messageIndex = 0;

  // Keep the loading animation running for at least the full announcement.
  // The final navigation is controlled by returnToHome(), after audio ends.
  const duration = 5200;
  const interval = 50;
  const steps = Math.ceil(duration / interval);
  const increment = 100 / steps;

  if (window.returnLoadingTimer) clearInterval(window.returnLoadingTimer);

  window.returnLoadingTimer = setInterval(() => {
    value = Math.min(100, value + increment);

    if (progress) progress.style.width = `${value}%`;
    if (percent) percent.textContent = `${Math.round(value)}%`;

    const nextIndex = Math.min(
      messages.length - 1,
      Math.floor((value / 100) * messages.length)
    );

    if (nextIndex !== messageIndex) {
      messageIndex = nextIndex;
      if (status) status.textContent = messages[messageIndex];
    }

    if (value >= 100) {
      clearInterval(window.returnLoadingTimer);
      window.returnLoadingTimer = null;
      if (status) status.textContent = "HOME SYSTEM READY";
    }
  }, interval);
}

function finishReturnToHome() {
  if (window.returnLoadingTimer) {
    clearInterval(window.returnLoadingTimer);
    window.returnLoadingTimer = null;
  }
  const progress = $("returnLoadingProgress");
  const percent = $("returnLoadingPercent");
  const status = $("returnLoadingStatus");
  if (progress) progress.style.width = "100%";
  if (percent) percent.textContent = "100%";
  if (status) status.textContent = "HOME SYSTEM READY";

  // Give the loading screen a moment to show its final state, then navigate.
  setTimeout(() => {
    window.location.href = "index.html";
  }, 250);
}

/* =========================================================
   UI CONTROL WIRING — RESTORED
========================================================= */
(function wireSimulatorControls() {
  const bind = (id, event, handler) => {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
  };

  async function returnToHome() {
    stopAlertAudio();
    stopEngineAudio();

    // Start the return/loading sequence immediately, but DO NOT navigate
    // away until the complete thank-you announcement has finished.
    const thankYou = playThankYouSound();
    showReturnLoading();

    // The supplied thank_you.wav is about 4.92 seconds long. Waiting on
    // the actual audio 'ended' event prevents the browser from cutting it
    // off when the simulator navigates back to Home.
    if (thankYou && typeof thankYou.then === "function") {
      await thankYou;
    } else {
      // Fallback for browsers that reject/disable audio playback.
      await new Promise(resolve => setTimeout(resolve, 5200));
    }

    finishReturnToHome();
  }

  bind("homeBtn", "click", returnToHome);
  bind("exitBtn", "click", returnToHome);

  bind("soundBtn", "click", () => {
    if (soundEnabled) playSound("click");
    soundEnabled = !soundEnabled;
    if (!soundEnabled) {
      stopAlertAudio();
      stopEngineAudio();
    }
    const el = $("soundBtn");
    if (el) el.innerHTML = soundEnabled ? "🔊<small>SOUND</small>" : "🔇<small>SOUND</small>";
  });

  bind("themeBtn", "click", () => {
    document.body.classList.toggle("blue-bright-mode");
  });

  bind("helpBtn", "click", () => {
    alert("FADEC ENGINE CBT SIMULATOR\n\nMCDU PAGES:\nENGINE — engine controls and air volume input\nFADEC — FADEC status and limits\nEVENT LOG — event history\nDIAGNOSTIC — live FADEC checks\n\nUse the numeric keypad to enter AIR VOLUME, then press ENT. Every simulator button click produces the supplied button-click beep while SOUND is enabled.");
  });

  // Phone UI: compact touch-first layout. Automatically enabled on phones,
  // but the button lets the user switch it on/off manually.
  const phoneUiBtn = $("phoneUiBtn");
  const phoneQuery = window.matchMedia ? window.matchMedia("(max-width: 700px)") : null;
  const setPhoneUi = (enabled, save = true) => {
    document.body.classList.toggle("phone-ui", enabled);
    if (phoneUiBtn) {
      phoneUiBtn.setAttribute("aria-pressed", String(enabled));
      phoneUiBtn.classList.toggle("active", enabled);
      phoneUiBtn.innerHTML = enabled ? "📱<small>PHONE UI ON</small>" : "📱<small>PHONE UI</small>";
    }
    if (save) localStorage.setItem("amt103-phone-ui", enabled ? "1" : "0");
  };
  const savedPhoneUi = localStorage.getItem("amt103-phone-ui");
  setPhoneUi(savedPhoneUi === "1" || (savedPhoneUi === null && !!phoneQuery?.matches), false);
  bind("phoneUiBtn", "click", () => setPhoneUi(!document.body.classList.contains("phone-ui")));
  phoneQuery?.addEventListener?.("change", e => {
    if (localStorage.getItem("amt103-phone-ui") === null) setPhoneUi(e.matches, false);
  });

  bind("startBtn", "click", () => startEngine());
  bind("stopBtn", "click", () => stopEngine());
  bind("resetBtn", "click", () => resetSystem());
  bind("diagBtn", "click", () => runDiagnostic());
  bind("ackBtn", "click", () => acknowledgeWarning());

  bind("clearLogBtn", "click", () => {
    faults = [];
    eventHistory = [];
    updateFaultDisplay();
    const log = $("eventLog");
    if (log) log.innerHTML = "";
    const count = $("logCount");
    if (count) count.textContent = "0 EVENTS";
    updateMCDU();
  });

  // MCDU page navigation
  document.querySelectorAll(".mcdu-nav button[data-page]").forEach(button => {
    button.addEventListener("click", () => mcduSetPage(button.dataset.page));
  });

  // Physical line-select keys
  document.querySelectorAll(".left-selectors .ls-key:not(.blank)").forEach((button, index) => {
    button.addEventListener("click", () => handleMcduLineSelect("L", index));
  });

  document.querySelectorAll(".right-selectors .ls-key:not(.blank)").forEach((button, index) => {
    button.addEventListener("click", () => handleMcduLineSelect("R", index));
  });

  // Numeric / alphanumeric MCDU keypad
  document.querySelectorAll(".mcdu-keypad button[data-key]").forEach(button => {
    button.addEventListener("click", () => handleMcduKey(button.dataset.key));
  });

  // A beep for every clickable simulator button while sound is enabled.
  // Capture phase prevents individual handlers from accidentally suppressing it.
  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || button.disabled || button.id === "soundBtn") return;
    if (!button.dataset.mcduSilentBeep) playSound("click");
  }, true);

  document.querySelectorAll(".answers button").forEach(button => {
    button.addEventListener("click", () => answerQuestion(button.dataset.answer));
  });

  // Physical keyboard support for the MCDU numeric keys.
  document.addEventListener("keydown", event => {
    if (/^\d$/.test(event.key)) {
      handleMcduKey(event.key);
    } else if (event.key === "Enter") {
      handleMcduKey("ENT");
    } else if (event.key === "Backspace") {
      handleMcduKey("DEL");
    } else if (event.key === "Escape") {
      handleMcduKey("CLR");
    }
  });
})();
