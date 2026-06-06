# Flag Rush

Flag Rush is a lightweight TypeScript flag guessing game built for fast solo play and future multiplayer modes.

The current app uses a pure browser-independent game engine, typed country indexing, deterministic seeded rounds, local save persistence, and a vanilla DOM UI. Multiplayer is represented by a typed protocol and mock lobby shell so a real server can be added without changing UI contracts.

## Run locally

```sh
npm install
npm run dev
```

Then visit the Vite URL printed in the terminal.

## Build and test

```sh
npm test
npm run build
```

## Architecture

```text
src/
  core/           Pure country, game, mode, and multiplayer protocol logic
  app/            App routing/controller layer
  ui/             Vanilla DOM screens and renderers
  storage/        Versioned local persistence and settings
  styles/         CSS design system and responsive layout
public/assets/    Static flag SVG files
```

Key rules:

- Game rules do not depend on `window`, `document`, localStorage, or WebSocket.
- Country state uses stable IDs/codes, not display names.
- Round order is seeded and deterministic.
- Modes are plugins around shared engine behavior.
- Multiplayer clients receive public round state only; server-side validation can keep answers private.

See `PROJECT.md` for the full refactor plan and extension roadmap.
