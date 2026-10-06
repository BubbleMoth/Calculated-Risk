// Each distribution is { min, p }: p[i] is the chance of rolling min + i.

export const MODES = Object.freeze({
  ADVANTAGE: "advantage",
  NORMAL: "normal",
  DISADVANTAGE: "disadvantage"
});

// Used when a formula has something we can't calculate exactly.
export class UnsupportedFormulaError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedFormulaError";
  }
}

const MAX_FACES = 1000;
const MAX_DICE = 100;
const MAX_BRUTE_FORCE_OUTCOMES = 200_000;

// Basic distributions

export function constant(value) {
  return { min: value, p: [1] };
}

export function uniform(faces) {
  return { min: 1, p: Array(faces).fill(1 / faces) };
}

export function negate(dist) {
  const n = dist.p.length;
  return { min: -(dist.min + n - 1), p: dist.p.slice().reverse() };
}

export function convolve(a, b) {
  const p = new Array(a.p.length + b.p.length - 1).fill(0);
  for (let i = 0; i < a.p.length; i++) {
    if (!a.p[i]) continue;
    for (let j = 0; j < b.p.length; j++) p[i + j] += a.p[i] * b.p[j];
  }
  return { min: a.min + b.min, p };
}

export function sumOf(dist, count) {
  let out = constant(0);
  for (let i = 0; i < count; i++) out = convolve(out, dist);
  return out;
}

// Turn a map of results and their chances back into { min, p }.
function fromMap(map) {
  const values = [...map.keys()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const p = new Array(max - min + 1).fill(0);
  for (const [value, prob] of map) p[value - min] += prob;
  return { min, p };
}

// Change each result, then combine any that end up with the same value.
export function mapValues(dist, fn) {
  const map = new Map();
  dist.p.forEach((prob, i) => {
    if (!prob) return;
    const value = fn(dist.min + i);
    map.set(value, (map.get(value) ?? 0) + prob);
  });
  return fromMap(map);
}

// Odds for keeping the highest or lowest of `count` independent rolls.
export function extremeOf(dist, count, highest = true) {
  if (count <= 1) return { min: dist.min, p: dist.p.slice() };
  const n = dist.p.length;
  const p = new Array(n).fill(0);
  if (highest) {
    let below = 0;
    for (let i = 0; i < n; i++) {
      const atOrBelow = below + dist.p[i];
      p[i] = (atOrBelow ** count) - (below ** count);
      below = atOrBelow;
    }
  } else {
    let above = 0;
    for (let i = n - 1; i >= 0; i--) {
      const atOrAbove = above + dist.p[i];
      p[i] = (atOrAbove ** count) - (above ** count);
      above = atOrAbove;
    }
  }
  return { min: dist.min, p };
}

// Add up the chances of meeting or beating the target.
export function atLeast(dist, target) {
  const start = Math.max(0, Math.ceil(target) - dist.min);
  let total = 0;
  for (let i = start; i < dist.p.length; i++) total += dist.p[i];
  return total;
}

// Dice modifiers

function compare(value, comparison, target) {
  switch (comparison) {
    case "=":
    case "==":
      return value === target;
    case "<":
      return value < target;
    case "<=":
    case "=<":
      return value <= target;
    case ">":
      return value > target;
    case ">=":
    case "=>":
      return value >= target;
    default:
      throw new UnsupportedFormulaError(`Unsupported comparison "${comparison}"`);
  }
}

// Foundry rerolls: r1 rerolls 1s once, r1=1 allows one reroll of a 1,
// r<3 rerolls anything under 3, and rr keeps rerolling matches.
function applyReroll(dist, match) {
  let [, token, max, comparison, target] = match;
  if (max && !(target || comparison)) {
    target = max;
    max = null;
  }
  target = target !== undefined ? parseInt(target) : 1;
  comparison = comparison || "=";
  const recursive = token.toLowerCase() === "rr";

  let rerollChance = 0;
  dist.p.forEach((prob, i) => {
    if (compare(dist.min + i, comparison, target)) rerollChance += prob;
  });
  if (!rerollChance) return dist;

  if (recursive) {
    if (rerollChance >= 1) throw new UnsupportedFormulaError("Recursive reroll matches every result");
    return {
      min: dist.min,
      p: dist.p.map((prob, i) => compare(dist.min + i, comparison, target) ? 0 : prob / (1 - rerollChance))
    };
  }

  // Keep the second roll.
  return {
    min: dist.min,
    p: dist.p.map((prob, i) => {
      const kept = compare(dist.min + i, comparison, target) ? 0 : prob;
      return kept + (rerollChance * prob);
    })
  };
}

// Try every combination and keep the highest or lowest `keep` dice.
function keepBruteForce(perDie, number, keep, highest) {
  const n = perDie.p.length;
  if ((n ** number) > MAX_BRUTE_FORCE_OUTCOMES) {
    throw new UnsupportedFormulaError("Too many dice to keep exactly");
  }
  const totals = new Map();
  const indices = new Array(number).fill(0);
  for (;;) {
    let prob = 1;
    const values = [];
    for (const i of indices) {
      prob *= perDie.p[i];
      values.push(perDie.min + i);
    }
    if (prob) {
      values.sort((a, b) => highest ? b - a : a - b);
      const total = values.slice(0, keep).reduce((sum, v) => sum + v, 0);
      totals.set(total, (totals.get(total) ?? 0) + prob);
    }
    let position = 0;
    while (position < number) {
      indices[position]++;
      if (indices[position] < n) break;
      indices[position] = 0;
      position++;
    }
    if (position === number) break;
  }
  return fromMap(totals);
}

/**
 * Work out one dice term, like 1d20, 2d6, 1d20adv, 2d20kh, 1d20min10, or 1d20r1=1.
 * @param {object} term
 * @param {number} term.faces
 * @param {number} term.number
 * @param {string[]} [term.modifiers]
 */
export function dieDistribution({ faces, number, modifiers = [] }) {
  if (!Number.isInteger(faces) || (faces < 1) || (faces > MAX_FACES)) {
    throw new UnsupportedFormulaError("Die faces must be a fixed number");
  }
  if (!Number.isInteger(number) || (number < 0) || (number > MAX_DICE)) {
    throw new UnsupportedFormulaError("Dice count must be a fixed number");
  }
  if (number === 0) return constant(0);

  let perDie = uniform(faces);
  let selection = null;
  const clamps = [];

  for (const raw of modifiers) {
    const modifier = String(raw).trim();
    if (!modifier) continue;
    let match;
    if ((match = modifier.match(/^(adv|dis)(\d*)$/i))) {
      selection = { type: match[1].toLowerCase(), count: parseInt(match[2] || "1") };
    } else if ((match = modifier.match(/^k([hl])?(\d*)$/i))) {
      const low = (match[1] ?? "h").toLowerCase() === "l";
      selection = { type: low ? "kl" : "kh", count: parseInt(match[2] || "1") };
    } else if ((match = modifier.match(/^(min|max)(\d+)$/i))) {
      clamps.push({ type: match[1].toLowerCase(), value: parseInt(match[2]) });
    } else if ((match = modifier.match(/^(rr?)(\d+)?([<>=]+)?(\d+)?$/i))) {
      perDie = applyReroll(perDie, match);
    } else {
      throw new UnsupportedFormulaError(`Unsupported dice modifier "${modifier}"`);
    }
  }

  // Applying min/max before picking dice gives the same result as doing it after.
  for (const { type, value } of clamps) {
    perDie = mapValues(perDie, v => type === "min" ? Math.max(v, value) : Math.min(v, value));
  }

  if (selection && ((selection.type === "adv") || (selection.type === "dis"))) {
    return extremeOf(sumOf(perDie, number), selection.count + 1, selection.type === "adv");
  }
  if (selection && (selection.count < number)) {
    const highest = selection.type === "kh";
    if (selection.count === 1) return extremeOf(perDie, number, highest);
    return keepBruteForce(perDie, number, selection.count, highest);
  }
  return sumOf(perDie, number);
}

/**
 * Use the requested advantage mode instead of whatever the d20 already has.
 * @param {object} term The d20 term.
 * @param {string} mode One of MODES.
 * @param {object} [options]
 * @param {boolean} [options.elvenAccuracy] Use three dice for advantage instead of two.
 */
export function d20Distribution(term, mode, { elvenAccuracy = false } = {}) {
  const modifiers = (term.modifiers ?? []).filter(m => !/^(adv|dis)\d*$/i.test(m) && !/^k[hl]?\d*$/i.test(m));
  if (mode === MODES.ADVANTAGE) modifiers.push(elvenAccuracy ? "adv2" : "adv");
  else if (mode === MODES.DISADVANTAGE) modifiers.push("dis");
  return dieDistribution({ faces: term.faces, number: 1, modifiers });
}

// Reading a roll

const isOperator = term => typeof term?.operator === "string";
const isDie = term => Array.isArray(term?.modifiers) && ("faces" in term) && ("number" in term)
  && String(term.denomination ?? `d${term.faces}`).startsWith("d");
const isNumeric = term => !("faces" in (term ?? {})) && (typeof term?.number === "number");

/**
 * Separate the main d20 from the rest of the roll.
 * Plain objects work too, which makes this easier to test.
 * @param {object} roll
 * @param {object} [options]
 * @param {Function} [options.evaluate] Get a number from a fixed term we can't read here.
 * @returns {{ d20Term: object|null, rest: object }}
 */
export function analyzeRoll(roll, { evaluate } = {}) {
  const terms = roll?.terms ?? [];
  const hasD20 = roll?.validD20Roll ?? (isDie(terms[0]) && (terms[0].faces === 20));
  let d20Term = null;
  let rest = constant(0);
  let sign = 1;

  terms.forEach((term, index) => {
    if (isOperator(term)) {
      if (term.operator === "-") sign *= -1;
      else if (term.operator !== "+") throw new UnsupportedFormulaError(`Unsupported operator "${term.operator}"`);
      return;
    }

    let dist;
    if (isDie(term)) {
      if ((index === 0) && hasD20 && (sign === 1)) {
        d20Term = term;
        return;
      }
      dist = dieDistribution({ faces: term.faces, number: term.number, modifiers: term.modifiers });
    } else if (isNumeric(term)) {
      dist = constant(term.number);
    } else {
      const value = evaluate?.(term);
      if (!Number.isFinite(value)) {
        throw new UnsupportedFormulaError(`Unsupported term "${term?.formula ?? term}"`);
      }
      dist = constant(value);
    }
    rest = convolve(rest, sign < 0 ? negate(dist) : dist);
    sign = 1;
  });

  return { d20Term, rest };
}

/**
 * Work out the chance of meeting or beating the target.
 * @param {object} d20 Main d20 distribution, or null when there isn't one.
 * @param {object} rest Distribution of everything else in the formula.
 * @param {number} target
 * @param {object} [options]
 * @param {boolean} [options.isAttack] Apply natural 20 and natural 1 rules.
 * @param {number} [options.criticalSuccess] Lowest d20 result that always hits.
 * @param {number} [options.criticalFailure] Highest d20 result that always misses.
 */
export function successChance(d20, rest, target, { isAttack = false, criticalSuccess = 20, criticalFailure = 1 } = {}) {
  if (!d20) return atLeast(rest, target);
  let total = 0;
  d20.p.forEach((prob, i) => {
    if (!prob) return;
    const result = d20.min + i;
    if (isAttack && (result >= criticalSuccess)) total += prob;
    else if (isAttack && (result <= criticalFailure)) return;
    else total += prob * atLeast(rest, target - result);
  });
  return Math.min(1, Math.max(0, total));
}

/**
 * Get the odds for advantage, normal, and disadvantage.
 * @returns {{ advantage: number, normal: number, disadvantage: number }}
 */
export function oddsForRoll(roll, target, { isAttack = false, evaluate } = {}) {
  const { d20Term, rest } = analyzeRoll(roll, { evaluate });
  const critOptions = {
    isAttack,
    criticalSuccess: Number(d20Term?.options?.criticalSuccess ?? roll?.options?.criticalSuccess ?? 20),
    criticalFailure: Number(d20Term?.options?.criticalFailure ?? roll?.options?.criticalFailure ?? 1)
  };
  const elvenAccuracy = Boolean(d20Term?.options?.elvenAccuracy ?? roll?.options?.elvenAccuracy);
  const odds = {};
  for (const mode of Object.values(MODES)) {
    const d20 = d20Term ? d20Distribution(d20Term, mode, { elvenAccuracy }) : null;
    odds[mode] = successChance(d20, rest, target, critOptions);
  }
  return odds;
}

// Display helpers

// Pick a bracket using the two percentage cutoffs.
export function bracketFor(probability, likelyAt = 65, riskyAt = 35) {
  const [low, high] = [Math.min(likelyAt, riskyAt), Math.max(likelyAt, riskyAt)];
  const percent = probability * 100;
  if (percent >= high) return "likely";
  if (percent >= low) return "risky";
  return "longshot";
}

// Use whole percentages, but save 0% and 100% for actual certainties.
export function formatPercent(probability) {
  if (probability <= 0) return "0%";
  if (probability >= 1) return "100%";
  const percent = probability * 100;
  if (percent < 1) return "<1%";
  if (percent > 99) return ">99%";
  return `${Math.round(percent)}%`;
}

