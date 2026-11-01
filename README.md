# Original Gangster

An HD reimagining of *Gangsters: Organized Crime* (1998): a Prohibition-era crime
strategy game set in the fictional city of New Temperance. Plan your gang's week at
the desk, then watch it play out on the streets of a fully 3D city.

Original Gangster is a fan project. It is not affiliated with or endorsed by
Hothouse Creations, Eidos Interactive or the rights holders of the original game.
All art, models, music and sound were made for this project.

## Requirements

- [Node.js](https://nodejs.org/) 20.19+, 22.12+ or 24+ (`.node-version` pins 24.19.0)
- npm 11

## Getting started

```bash
npm install
npm run dev
```

Then open the URL Vite prints (port 5180 by default).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Check the save schema, typecheck and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | Run the TypeScript compiler without emitting |
| `npm test` | Run the full test suite (slow: allow 40+ minutes) |
| `npm run test:acceptance` | Run the core acceptance tests |
| `npm run test:long` | Run the long playthrough and integrity tests |
| `npm run desktop` | Build and launch the Electron desktop app |
| `npm run desktop:dev` | Run the desktop app against the dev server |
| `npm run package` | Build desktop installers for the current platform |
| `npm run package:win` | Build the Windows installer and portable exe |
| `npm run package:linux` | Build a Linux `.tar.gz` |

Packaged builds go to `release/`. A checkout inside OneDrive packages to
`%LOCALAPPDATA%\OriginalGangster-release` instead, because OneDrive locks the
folders electron-builder renames; set `OG_RELEASE_DIR` to override.

## Project layout

```
src/
  app/      game state, saves, scenarios and tutorials
  sim/      the simulation: economy, combat, AI gangs, elections, police
  render/   the Three.js city, characters, vehicles and effects
  ui/       React interface: desk, menus, city view
  audio/    music and street sound
electron/   desktop shell and on-disk save store
public/     art, models and audio
scripts/    build, packaging and asset tools
tests/      Vitest suites
```

## Credits

*Gangsters: Organized Crime* was designed by Martin Capel, developed by Hothouse
Creations and published by Eidos Interactive in 1998.

Built with Three.js, React, Vite, Zustand, Electron and Vitest. Fonts are Barlow,
Barlow Condensed, Special Elite and Cinzel from Google Fonts (SIL Open Font License).

## License

[MIT](LICENSE)
