# Calculated Risk
<p>
  <img src="assets/attack-roll-percent.png" alt="Calculated Risk showing exact percentages" height="500">
  <img src="assets/attack-roll-vague.png" alt="Calculated Risk showing Likely, Risky, and Long shot" height="500">
</p>
Calculated Risk is a small Foundry VTT module for D&D 5e that shows the chance of success before you make a roll.

## Settings

Settings are under **Configure Settings --> Calculated Risk**.

the GM can choose whether players see exact percentages, simple labels like **Likely** or **Risky**, or nothing at all.

<img src="assets/settings.png" alt="Calculated Risk settings" width="700">

## Installation

### Manifest URL

1. From Foundry's **Setup** screen, open **Add-on Modules**.
2. Click **Install Module**.
3. Paste the module's manifest URL into the **Manifest URL** field:

   `https://github.com/BubbleMoth/Calculated-Risk/releases/latest/download/module.json`

4. Click **Install**.
5. Launch your world and go to **Game Settings → Manage Modules**.
6. Enable **Effective Critical Hits**.


### Manual
Copy the `calculated-risk` folder into your Foundry `Data/modules` folder, restart Foundry, and enable **Calculated Risk** under **Manage Modules**.


## Compatibility

- Foundry VTT v14+
- D&D 5e 5.0+
- Built against D&D 5e 6.0.5

## How it works

Odds are calculated from the roll formula.

Some unusual formulas are not supported. If Calculated Risk cannot calculate a roll accurately, it will show the odds as unavailable instead of guessing.
