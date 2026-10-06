import { bracketFor, formatPercent, MODES, oddsForRoll, UnsupportedFormulaError } from "./odds.mjs";

const MODULE_ID = "calculated-risk";
const BUTTON_MODES = [MODES.ADVANTAGE, MODES.NORMAL, MODES.DISADVANTAGE];

/**
 * Keep track of each dialog's target and where it came from.
 * @type {WeakMap<object, { source: "manual"|"roll"|"token", target: number|null, hidden: boolean,
 *   touched?: boolean, name?: string, count?: number }>}
 */
const dialogState = new WeakMap();

// Settings

Hooks.once("init", () => {
  const register = (key, data) => game.settings.register(MODULE_ID, key, {
    name: `CALCULATEDRISK.Settings.${key}.Name`,
    hint: `CALCULATEDRISK.Settings.${key}.Hint`,
    config: true,
    ...data
  });

  register("playerDisplay", {
    scope: "world",
    type: String,
    choices: {
      exact: "CALCULATEDRISK.Settings.playerDisplay.Exact",
      bracket: "CALCULATEDRISK.Settings.playerDisplay.Bracket",
      off: "CALCULATEDRISK.Settings.playerDisplay.Off"
    },
    default: "exact"
  });

  register("useTargets", { scope: "world", type: Boolean, default: false });
  register("hideFilledValues", {
    scope: "world",
    type: String,
    choices: {
      match: "CALCULATEDRISK.Settings.hideFilledValues.Match",
      always: "CALCULATEDRISK.Settings.hideFilledValues.Always",
      never: "CALCULATEDRISK.Settings.hideFilledValues.Never"
    },
    default: "match"
  });
  register("targetedDisplay", {
    scope: "world",
    type: String,
    choices: {
      bracket: "CALCULATEDRISK.Settings.playerDisplay.Bracket",
      exact: "CALCULATEDRISK.Settings.playerDisplay.Exact"
    },
    default: "bracket"
  });

  register("likelyThreshold", { scope: "world", type: Number, range: { min: 1, max: 99, step: 1 }, default: 65 });
  register("riskyThreshold", { scope: "world", type: Number, range: { min: 1, max: 99, step: 1 }, default: 35 });
  register("labelLikely", { scope: "world", type: String, default: "" });
  register("labelRisky", { scope: "world", type: String, default: "" });
  register("labelLongshot", { scope: "world", type: String, default: "" });
  register("showOdds", { scope: "client", type: Boolean, default: true });
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = {
    oddsForRoll: (roll, target, options = {}) => oddsForRoll(roll, target, {
      evaluate: evaluateDeterministic,
      ...options
    })
  };
});

const setting = key => game.settings.get(MODULE_ID, key);

// Helpers

function toNumber(value) {
  if ((value === null) || (value === undefined) || (value === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isAttack(app) {
  if (app.config?.hookNames?.includes("attack")) return true;
  const AttackDialog = globalThis.dnd5e?.applications?.dice?.AttackRollConfigurationDialog;
  return AttackDialog ? app instanceof AttackDialog : false;
}

function isInitiative(app) {
  return Boolean(app.config?.hookNames?.includes("initiativeDialog"));
}

// Let Foundry handle fixed terms, like parentheses with no dice.
function evaluateDeterministic(term) {
  try {
    if (!term?.isDeterministic || !term.formula) return undefined;
    const roll = new Roll(term.formula);
    roll.evaluateSync();
    return roll.total;
  } catch {
    return undefined;
  }
}

// Use the first target with an AC, but only when the GM has this enabled.
function findTargetedAC() {
  if (!setting("useTargets")) return null;
  const targets = [...(game.user.targets ?? [])];
  for (const token of targets) {
    const actor = token.actor;
    if (!actor || actor.statuses?.has("coverTotal")) continue;
    const ac = toNumber(actor.system?.attributes?.ac?.value);
    if (ac !== null) return { ac, name: token.document?.name ?? token.name, count: targets.length };
  }
  return null;
}

// Check whether D&D 5e is already showing this DC to the player.
function systemShowsDC(app) {
  const clicked = app.config?.event?.target;

  // Inline roll links in journals and chat can be written with hideDC.
  if (clicked?.closest?.("[data-hide-d-c]")) return false;

  // Save and check buttons on item cards point back to the card they came from.
  // Roll request cards swap between a label with the DC and one without.
  let messageId = foundry.utils.getProperty(app.message ?? {}, "data.system.origin");
  if (!messageId && clicked?.closest?.("button")?.querySelector(".visible-dc")) {
    messageId = clicked.closest("[data-message-id]")?.dataset.messageId;
  }
  const message = messageId ? game.messages.get(messageId) : null;
  return message?.shouldDisplayChallenge ?? true;
}

// Check whether D&D 5e shows AC on attack rolls.
function systemShowsAC() {
  try {
    return game.settings.get("dnd5e", "attackRollVisibility") === "all";
  } catch {
    return false;
  }
}

// Decide whether a number filled in for the player should stay hidden.
function isHiddenFromPlayer(app, source) {
  if (game.user.isGM || (source === "manual")) return false;
  const mode = setting("hideFilledValues");
  if (mode === "always") return true;
  if (mode === "never") return false;
  return source === "token" ? !systemShowsAC() : !systemShowsDC(app);
}

function initialState(app) {
  const known = toNumber(app.rolls?.[0]?.options?.target);
  if (known !== null) return { source: "roll", target: known, hidden: isHiddenFromPlayer(app, "roll") };
  const targeted = isAttack(app) ? findTargetedAC() : null;
  if (targeted) return {
    source: "token",
    target: targeted.ac,
    name: targeted.name,
    count: targeted.count,
    hidden: isHiddenFromPlayer(app, "token")
  };
  return { source: "manual", target: null, touched: false, hidden: false };
}

// Show exact odds, a bracket label, or nothing, depending on the settings.
function displayMode(state) {
  if (game.user.isGM) return "exact";
  const playerDisplay = setting("playerDisplay");
  if (playerDisplay === "off") return "off";
  if (state.hidden) return setting("targetedDisplay");
  return playerDisplay;
}

function bracketLabel(bracket) {
  const custom = {
    likely: setting("labelLikely"),
    risky: setting("labelRisky"),
    longshot: setting("labelLongshot")
  }[bracket]?.trim();
  return custom || game.i18n.localize(`CALCULATEDRISK.Bracket.${bracket}`);
}

// Roll dialog

Hooks.on("renderD20RollConfigurationDialog", (app, element) => {
  try {
    if (!setting("showOdds") || isInitiative(app)) return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;

    let state = dialogState.get(app);
    if (!state) {
      state = initialState(app);
      dialogState.set(app, state);
    }
    if (displayMode(state) === "off") return;

    const buttons = root.querySelector('[data-application-part="buttons"]') ?? root.querySelector(".dialog-buttons");
    if (!buttons) return;
    if (!root.querySelector(".calculated-risk")) buttons.before(buildPanel(app));
    refresh(app, root);
  } catch (err) {
    console.error(`${MODULE_ID} | Couldn't add odds to the roll dialog.`, err);
  }
});

function buildPanel(app) {
  const panel = document.createElement("section");
  panel.className = "calculated-risk";
  panel.innerHTML = `
    <div class="calculated-risk-row">
      <label class="calculated-risk-label"></label>
      <input type="number" class="calculated-risk-target" inputmode="numeric" step="1" min="0" max="99" placeholder="—">
      <span class="calculated-risk-source">
        <i class="fa-solid fa-crosshairs" inert></i>
        <span class="calculated-risk-source-name"></span>
      </span>
      <button type="button" class="calculated-risk-manual">
        <i class="fa-solid fa-pen" inert></i>
      </button>
    </div>
    <p class="calculated-risk-hint" aria-live="polite"></p>`;

  const inputId = `calculated-risk-target-${foundry.utils.randomID()}`;
  const input = panel.querySelector(".calculated-risk-target");
  input.id = inputId;
  panel.querySelector(".calculated-risk-label").htmlFor = inputId;

  const manual = panel.querySelector(".calculated-risk-manual");
  const manualLabel = game.i18n.localize("CALCULATEDRISK.EnterManually");
  manual.dataset.tooltip = manualLabel;
  manual.setAttribute("aria-label", manualLabel);

  input.addEventListener("input", () => {
    const state = dialogState.get(app);
    state.source = "manual";
    state.touched = true;
    state.hidden = false;
    state.target = toNumber(input.value);
    refresh(app, app.element);
  });

  // Don't rebuild the rolls when the target changes.
  // Enter also shouldn't roll while the player is still typing.
  input.addEventListener("change", event => event.stopPropagation());
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") event.preventDefault();
  });

  manual.addEventListener("click", () => {
    const state = dialogState.get(app);
    // Clear the field so switching to manual doesn't give away a hidden number.
    if (state.hidden) state.target = null;
    state.source = "manual";
    state.touched = true;
    state.hidden = false;
    refresh(app, app.element);
    app.element?.querySelector(".calculated-risk-target")?.focus();
  });

  return panel;
}

function refresh(app, root) {
  const state = dialogState.get(app);
  const panel = root?.querySelector(".calculated-risk");
  if (!state || !panel) return;

  const attack = isAttack(app);
  const mode = displayMode(state);
  const tokenMode = state.source === "token";
  const input = panel.querySelector(".calculated-risk-target");

  panel.querySelector(".calculated-risk-label").textContent = game.i18n.localize(attack ? "CALCULATEDRISK.TargetAC" : "CALCULATEDRISK.TargetDC");

  // Targets and hidden numbers show where the number came from instead of an editable field.
  panel.classList.toggle("locked", tokenMode || state.hidden);
  if (document.activeElement !== input) {
    input.value = state.hidden ? "" : (state.target ?? "");
  }

  const name = state.name ?? "";
  panel.querySelector(".calculated-risk-source > i").className = tokenMode
    ? "fa-solid fa-crosshairs"
    : "fa-solid fa-eye-slash";
  let sourceText = game.i18n.localize("CALCULATEDRISK.Hidden");
  if (tokenMode) sourceText = state.hidden
    ? name
    : game.i18n.format("CALCULATEDRISK.TokenWithAC", { name, ac: state.target });
  panel.querySelector(".calculated-risk-source-name").textContent = sourceText;

  let odds = null;
  let unsupported = false;
  const roll = app.rolls?.[0];
  if (roll && (state.target !== null)) {
    try {
      odds = oddsForRoll(roll, state.target, { isAttack: attack, evaluate: evaluateDeterministic });
    } catch (err) {
      if (err instanceof UnsupportedFormulaError) unsupported = true;
      else throw err;
    }
  }

  // Explain missing odds or where the target came from.
  let hint = "";
  if (unsupported) hint = game.i18n.localize("CALCULATEDRISK.Hint.Unsupported");
  else if (state.target === null) hint = game.i18n.localize("CALCULATEDRISK.Hint.Empty");
  else if (tokenMode && (state.count > 1)) hint = game.i18n.format("CALCULATEDRISK.Hint.FirstTarget", { name, count: state.count });
  else if (state.hidden) hint = game.i18n.localize(tokenMode ? "CALCULATEDRISK.Hint.Hidden" : "CALCULATEDRISK.Hint.HiddenDC");
  panel.querySelector(".calculated-risk-hint").textContent = hint;

  // Update the odds label on each roll button.
  const likelyAt = setting("likelyThreshold");
  const riskyAt = setting("riskyThreshold");
  for (const buttonMode of BUTTON_MODES) {
    const button = root.querySelector(`button[data-action="${buttonMode}"]`);
    if (!button) continue;
    let chip = button.querySelector(".calculated-risk-chip");
    if (!odds) {
      chip?.remove();
      button.classList.remove("calculated-risk-has-chip");
      continue;
    }
    if (!chip) {
      chip = document.createElement("span");
      button.append(chip);
    }
    const probability = odds[buttonMode];
    const bracket = bracketFor(probability, likelyAt, riskyAt);
    chip.className = `calculated-risk-chip ${bracket}`;
    if (mode === "exact") {
      chip.textContent = formatPercent(probability);
      chip.dataset.tooltip = bracketLabel(bracket);
    } else {
      chip.textContent = bracketLabel(bracket);
      delete chip.dataset.tooltip;
    }
    button.classList.add("calculated-risk-has-chip");
  }
}

// Update open dialogs when targets change

Hooks.on("targetToken", user => {
  if (user !== game.user) return;
  for (const app of foundry.applications.instances?.values?.() ?? []) {
    const state = dialogState.get(app);
    if (!state || !isAttack(app)) continue;
    const followsTargets = (state.source === "token") || ((state.source === "manual") && !state.touched);
    if (!followsTargets) continue;
    const targeted = findTargetedAC();
    if (targeted) {
      Object.assign(state, {
        source: "token",
        target: targeted.ac,
        name: targeted.name,
        count: targeted.count,
        hidden: isHiddenFromPlayer(app, "token")
      });
    } else if (state.source === "token") {
      Object.assign(state, {
        source: "manual", target: null, touched: false, hidden: false, name: undefined, count: undefined
      });
    }
    refresh(app, app.element);
  }
});

