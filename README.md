# Odds On

Odds On is a small Foundry VTT module for D&D 5e that shows your chance of success before you roll.

Enter a DC or AC in the roll dialog and the Advantage, Normal, and Disadvantage buttons will show the odds for each option.

## Features

- Shows success chance directly on roll buttons.
- Updates when modifiers change, including bonuses like `1d4` from Bless.
- Automatically fills in some DCs, including death saves, concentration checks, and saves from chat cards.
- Supports attack rules like natural 1s, natural 20s, and expanded critical ranges.
- Accounts for Reliable Talent, Elven Accuracy, and Halfling Lucky.

## Settings

Settings are under **Configure Settings --> Odds On**.

You can choose whether players see exact percentages, simple labels like **Likely** or **Risky**, or nothing at all.

Odds On can also pull AC from a targeted token. By default, players only see a probability bracket when this is enabled so the AC is harder to work out.

## Installation

Copy the `odds-on` folder into your Foundry `Data/modules` folder, restart Foundry, and enable **Odds On** under **Manage Modules**.

## Compatibility

- Foundry VTT v13+
- D&D 5e 5.0+
- Built against D&D 5e 6.0.5

## How it works

Odds are calculated directly from the roll formula rather than simulated.

Some unusual formulas, such as exploding dice or multiplication, are not supported. If Odds On cannot calculate a roll accurately, it will show the odds as unavailable instead of guessing.

Halfling Lucky has one small approximation when rolling with advantage: each d20 is treated as rerolling its own 1. The difference only matters when both dice roll a 1.
