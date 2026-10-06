import { bracketFor, formatPercent, MODES, oddsForRoll, UnsupportedFormulaError } from "./odds.mjs";

const MODULE_ID = "odds-on";
const BUTTON_MODES = [MODES.ADVANTAGE, MODES.NORMAL, MODES.DISADVANTAGE];

/**
 * Keep track of each dialog's target and where it came from.
 * @type {WeakMap<object, { source: "manual"|"roll"|"token", target: number|null, touched?: boolean,
 *   name?: string, count?: number }>}
 */
const dialogState = new WeakMap();

// Settings

Hooks.once("init", () => {
  const register = (key, data) => game.settings.register(MODULE_ID, key, {
    name: `ODDSON.Settings.${key}.Name`,
    hint: `ODDSON.Settings.${key}.Hint`,
    config: true,
    ...data
  });

  register("playerDisplay", {
    scope: "world",
    type: String,
    choices: {
      exact: "ODDSON.Settings.playerDisplay.Exact",
      bracket: "ODDSON.Settings.playerDisplay.Bracket",
      off: "ODDSON.Settings.playerDisplay.Off"
    },
    default: "exact"
  });

  register("useTargets", { scope: "world", type: Boolean, default: false });
  register("targetedDisplay", {
    scope: "world",
    type: String,
    choices: {
      bracket: "ODDSON.Settings.playerDisplay.Bracket",
      exact: "ODDSON.Settings.playerDisplay.Exact"
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

function initialState(app) {
  const known = toNumber(app.rolls?.[0]?.options?.target);
  if (known !== null) return { source: "roll", target: known };
  const targeted = isAttack(app) ? findTargetedAC() : null;
  if (targeted) return { source: "token", target: targeted.ac, name: targeted.name, count: targeted.count };
  return { source: "manual", target: null, touched: false };
}

// Show exact odds, a bracket label, or nothing, depending on the settings.
function displayMode(state) {
  if (game.user.isGM) return "exact";
  const playerDisplay = setting("playerDisplay");
  if (playerDisplay === "off") return "off";
  if (state.source === "token") return setting("targetedDisplay");
  return playerDisplay;
}

function bracketLabel(bracket) {
  const custom = {
    likely: setting("labelLikely"),
    risky: setting("labelRisky"),
    longshot: setting("labelLongshot")
  }[bracket]?.trim();
  return custom || game.i18n.localize(`ODDSON.Bracket.${bracket}`);
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
    if (!root.querySelector(".odds-on")) buttons.before(buildPanel(app));
    refresh(app, root);
  } catch (err) {
    console.error(`${MODULE_ID} | Couldn't add odds to the roll dialog.`, err);
  }
});

function buildPanel(app) {
  const panel = document.createElement("section");
  panel.className = "odds-on";
  panel.innerHTML = `
    <div class="odds-on-row">
      <label class="odds-on-label"></label>
      <input type="number" class="odds-on-target" inputmode="numeric" step="1" min="0" max="99" placeholder="—">
      <span class="odds-on-token">
        <i class="fa-solid fa-crosshairs" inert></i>
        <span class="odds-on-token-name"></span>
      </span>
      <button type="button" class="odds-on-manual">
        <i class="fa-solid fa-pen" inert></i>
      </button>
    </div>
    <p class="odds-on-hint" aria-live="polite"></p>`;

  const inputId = `odds-on-target-${foundry.utils.randomID()}`;
  const input = panel.querySelector(".odds-on-target");
  input.id = inputId;
  panel.querySelector(".odds-on-label").htmlFor = inputId;

  const manual = panel.querySelector(".odds-on-manual");
  const manualLabel = game.i18n.localize("ODDSON.EnterManually");
  manual.dataset.tooltip = manualLabel;
  manual.setAttribute("aria-label", manualLabel);

  input.addEventListener("input", () => {
    const state = dialogState.get(app);
    state.source = "manual";
    state.touched = true;
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
    // Clear the field for players so switching to manual doesn't give away a hidden AC.
    if (!game.user.isGM) state.target = null;
    state.source = "manual";
    state.touched = true;
    refresh(app, app.element);
    app.element?.querySelector(".odds-on-target")?.focus();
  });

  return panel;
}

function refresh(app, root) {
  const state = dialogState.get(app);
  const panel = root?.querySelector(".odds-on");
  if (!state || !panel) return;

  const attack = isAttack(app);
  const mode = displayMode(state);
  const tokenMode = state.source === "token";
  const input = panel.querySelector(".odds-on-target");

  panel.querySelector(".odds-on-label").textContent = game.i18n.localize(attack ? "ODDSON.TargetAC" : "ODDSON.TargetDC");
  panel.classList.toggle("token-mode", tokenMode);
  if (document.activeElement !== input) {
    input.value = (tokenMode && !game.user.isGM) ? "" : (state.target ?? "");
  }

  const name = state.name ?? "";
  panel.querySelector(".odds-on-token-name").textContent = game.user.isGM
    ? game.i18n.format("ODDSON.TokenWithAC", { name, ac: state.target })
    : name;

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
  if (unsupported) hint = game.i18n.localize("ODDSON.Hint.Unsupported");
  else if (state.target === null) hint = game.i18n.localize("ODDSON.Hint.Empty");
  else if (tokenMode && (state.count > 1)) hint = game.i18n.format("ODDSON.Hint.FirstTarget", { name, count: state.count });
  else if (tokenMode && !game.user.isGM) hint = game.i18n.localize("ODDSON.Hint.Hidden");
  panel.querySelector(".odds-on-hint").textContent = hint;

  // Update the odds label on each roll button.
  const likelyAt = setting("likelyThreshold");
  const riskyAt = setting("riskyThreshold");
  for (const buttonMode of BUTTON_MODES) {
    const button = root.querySelector(`button[data-action="${buttonMode}"]`);
    if (!button) continue;
    let chip = button.querySelector(".odds-on-chip");
    if (!odds) {
      chip?.remove();
      button.classList.remove("odds-on-has-chip");
      continue;
    }
    if (!chip) {
      chip = document.createElement("span");
      button.append(chip);
    }
    const probability = odds[buttonMode];
    const bracket = bracketFor(probability, likelyAt, riskyAt);
    chip.className = `odds-on-chip ${bracket}`;
    if (mode === "exact") {
      chip.textContent = formatPercent(probability);
      chip.dataset.tooltip = bracketLabel(bracket);
    } else {
      chip.textContent = bracketLabel(bracket);
      delete chip.dataset.tooltip;
    }
    button.classList.add("odds-on-has-chip");
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
      Object.assign(state, { source: "token", target: targeted.ac, name: targeted.name, count: targeted.count });
    } else if (state.source === "token") {
      Object.assign(state, { source: "manual", target: null, touched: false, name: undefined, count: undefined });
    }
    refresh(app, app.element);
  }
});

