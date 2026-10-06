# Target Odds

Target Odds is a small Foundry VTT module for D&D 5e that shows your chance of success before you roll.

Enter a DC or AC in the roll dialog and the Advantage, Normal, and Disadvantage buttons will show the odds for each option.

## Settings

Settings are under **Configure Settings --> Target Odds**.

You can choose whether players see exact percentages, simple labels like **Likely** or **Risky**, or nothing at all.

Target Odds can also pull AC from a targeted token. By default, players only see a probability bracket when this is enabled so the AC is harder to work out.

## Installation

### Manifest URL

1. From Foundry's **Setup** screen, open **Add-on Modules**.
2. Click **Install Module**.
3. Paste the module's manifest URL into the **Manifest URL** field:

   `https://github.com/BubbleMoth/Target-Odds/releases/latest/download/module.json`

4. Click **Install**.
5. Launch your world and go to **Game Settings → Manage Modules**.
6. Enable **Effective Critical Hits**.


### Manual
Copy the `target-odds` folder into your Foundry `Data/modules` folder, restart Foundry, and enable **Target Odds** under **Manage Modules**.


## Compatibility

- Foundry VTT v14+
- D&D 5e 5.0+
- Built against D&D 5e 6.0.5

## How it works

Odds are calculated from the roll formula.

Some unusual formulas are not supported. If Target Odds cannot calculate a roll accurately, it will show the odds as unavailable instead of guessing.
