# locato Refactor Plan

## Goal

Rebuild the current static flag guessing prototype into a lightweight, high-quality game platform that is easy to extend with new solo modes and future multiplayer modes.

The current app should be treated as starter inspiration only. The new architecture should separate game rules, data validation, rendering, persistence, and multiplayer transport.

## Core Direction

Use:

- TypeScript
- Vite
- Vitest
- Vanilla DOM rendering
- CSS modules by file/area, not a large framework

Avoid React, Redux, Next, Socket.io, and other heavier tools unless a later requirement proves they are necessary.

The most important architectural rule:

> The game engine must work without the browser.

Game rules, scoring, country matching, round selection, and mode behavior should be testable with plain TypeScript unit tests. The browser UI should only render state and dispatch commands.

## Target Architecture

```text
src/
  main.ts

  core/
    countries/
      countries.ts
      types.ts
      normalize.ts
      indexCountries.ts
      validateCountries.ts

    game/
      types.ts
      commands.ts
      events.ts
      GameEngine.ts
      reducer.ts
      selectors.ts
      scoring.ts
      roundQueue.ts
      random.ts

    modes/
      types.ts
      classic.ts
      timed.ts
      streak.ts
      continent.ts
      registry.ts

    multiplayer/
      protocol.ts
      publicState.ts
      roomTypes.ts

  app/
    App.ts
    createApp.ts
    router.ts

  ui/
    dom/
      createElement.ts
      bindings.ts
      renderApp.ts
      renderFlag.ts
      renderStats.ts
      renderBoard.ts
      renderFeedback.ts
      renderControls.ts

    screens/
      HomeScreen.ts
      ModeSelectScreen.ts
      SoloGameScreen.ts
      ResultsScreen.ts
      MultiplayerLobbyScreen.ts
      MultiplayerGameScreen.ts

  storage/
    localSave.ts
    settings.ts

  styles/
    tokens.css
    base.css
    layout.css
    home.css
    game.css
    board.css
    multiplayer.css
    responsive.css
```

Optional future server:

```text
server/
  index.ts

  rooms/
    Room.ts
    RoomManager.ts

  transport/
    websocket.ts

  protocol/
    parseMessage.ts
    handlers.ts
```

## Design Principles

### 1. Pure Game Core

The core game logic must not import or reference:

- `window`
- `document`
- DOM nodes
- CSS classes
- localStorage
- WebSocket

The engine should expose commands and events.

Example command model:

```ts
export type GameCommand =
  | { readonly type: "START_GAME"; readonly seed: string; readonly modeId: string; readonly now: number }
  | { readonly type: "SUBMIT_GUESS"; readonly value: string; readonly now: number }
  | { readonly type: "REQUEST_HINT"; readonly now: number }
  | { readonly type: "SKIP_ROUND"; readonly now: number }
  | { readonly type: "RESET_GAME"; readonly now: number };
```

Example event model:

```ts
export type GameEvent =
  | { readonly type: "GAME_STARTED"; readonly currentCountryId: CountryId }
  | { readonly type: "GUESS_CORRECT"; readonly countryId: CountryId; readonly nextCountryId: CountryId | null }
  | { readonly type: "GUESS_WRONG"; readonly countryId: CountryId }
  | { readonly type: "ROUND_SKIPPED"; readonly previousCountryId: CountryId; readonly nextCountryId: CountryId | null }
  | { readonly type: "HINT_REVEALED"; readonly countryId: CountryId; readonly hint: Hint }
  | { readonly type: "GAME_COMPLETED" }
  | { readonly type: "GAME_RESET" };
```

### 2. Modes as Plugins

The engine should not hardcode classic-mode scoring or completion rules. Modes should define their own behavior.

Initial modes:

- Classic
- Continent Challenge
- Timed Rush
- Streak Mode

Mode interface shape:

```ts
export interface GameMode {
  readonly id: string;
  readonly label: string;
  readonly description: string;

  readonly allowSkip: boolean;
  readonly allowHints: boolean;
  readonly acceptCountryCodes: boolean;
  readonly acceptAliases: boolean;

  readonly createCountryPool: (countries: readonly Country[], options?: ModeOptions) => readonly CountryId[];
  readonly scoreCorrectGuess: (input: ScoreInput) => ScoreDelta;
  readonly scoreWrongGuess: (input: ScoreInput) => ScoreDelta;
  readonly isComplete: (state: GameState) => boolean;
}
```

### 3. Deterministic Round Selection

Use seeded randomness for question order.

This supports:

- repeatable tests
- daily challenges
- replays
- multiplayer fairness
- easier debugging

The same seed and country pool should always produce the same flag order.

### 4. Stable Country Identity

Do not key state by display name.

Use:

- numeric `CountryId` internally
- country `code` for saves and network protocol
- display `name` only for UI

### 5. Thin UI

Screens render state and dispatch commands. They should not contain game rules.

Good:

```ts
engine.dispatch({ type: "SUBMIT_GUESS", value, now: Date.now() });
```

Bad:

```ts
if (guess === country.name) {
  score += 1;
  pickNextFlag();
}
```

### 6. Server-Authoritative Multiplayer

For multiplayer, the server should own:

- room state
- current country
- answer validation
- scoring
- timing
- round winners
- final results

Clients should only render public state and submit input.

Before a round ends, clients should receive only public round data:

```ts
export interface PublicRoundState {
  readonly roundNumber: number;
  readonly flagSrc: string;
  readonly startedAt: number;
  readonly endsAt: number | null;
}
```

The server should keep country names, codes, aliases, and accepted answers private until the round result is revealed.

## Data Model

### Raw Country

```ts
export interface RawCountry {
  readonly name: string;
  readonly code: string;
  readonly aliases: readonly string[];
  readonly continent: Continent;
  readonly flagSrc: string;
}
```

### Indexed Country

```ts
export interface Country {
  readonly id: CountryId;
  readonly name: string;
  readonly code: CountryCode;
  readonly aliases: readonly string[];
  readonly continent: Continent;
  readonly flagSrc: string;
  readonly normalizedName: string;
  readonly acceptedAnswers: readonly string[];
}
```

### Country Index

```ts
export interface CountryIndex {
  readonly countries: readonly Country[];
  readonly byId: readonly Country[];
  readonly byCode: ReadonlyMap<string, Country>;
  readonly byAnswer: ReadonlyMap<string, readonly CountryId[]>;
  readonly answerSetByCountryId: ReadonlyMap<CountryId, ReadonlySet<string>>;
}
```

## Country Matching

Use strict normalization by default.

Normalization should:

- trim input
- lowercase input
- remove accents
- normalize punctuation and spacing
- convert `&` to `and`
- preserve meaningful country words such as `united`, `kingdom`, `state`, and `and`

The current prototype removes too many words. For example, `United Kingdom` can normalize incorrectly if both `united` and `kingdom` are stripped.

Accepted answers should include:

- normalized country name
- normalized country code, if the mode allows code guesses
- normalized aliases, if the mode allows aliases

Loose matching can be added later as an explicit mode/config option, not hidden inside the default matcher.

## Game State

```ts
export interface GameState {
  readonly status: "idle" | "playing" | "complete";

  readonly modeId: string;
  readonly seed: string;

  readonly currentCountryId: CountryId | null;
  readonly roundNumber: number;

  readonly guessedCountryIds: ReadonlySet<CountryId>;
  readonly skippedCountryIds: ReadonlySet<CountryId>;

  readonly attempts: number;
  readonly correctAnswers: number;
  readonly wrongAnswers: number;

  readonly streak: number;
  readonly bestStreak: number;

  readonly startedAt: number | null;
  readonly endedAt: number | null;

  readonly lastResult: GuessResult | null;
  readonly queue: RoundQueue;
}
```

## Multiplayer Protocol Foundation

Client messages:

```ts
export type ClientMessage =
  | { readonly type: "CREATE_ROOM"; readonly playerName: string; readonly modeId: string }
  | { readonly type: "JOIN_ROOM"; readonly roomCode: string; readonly playerName: string }
  | { readonly type: "LEAVE_ROOM" }
  | { readonly type: "SET_READY"; readonly ready: boolean }
  | { readonly type: "START_GAME" }
  | { readonly type: "SUBMIT_ANSWER"; readonly answer: string; readonly clientSentAt: number }
  | { readonly type: "REQUEST_HINT" };
```

Server messages:

```ts
export type ServerMessage =
  | { readonly type: "ROOM_SNAPSHOT"; readonly room: PublicRoomState }
  | { readonly type: "PLAYER_JOINED"; readonly player: PublicPlayerState }
  | { readonly type: "PLAYER_LEFT"; readonly playerId: string }
  | { readonly type: "GAME_STARTED"; readonly round: PublicRoundState }
  | { readonly type: "ROUND_STARTED"; readonly round: PublicRoundState }
  | { readonly type: "ANSWER_ACCEPTED"; readonly playerId: string; readonly points: number }
  | { readonly type: "ANSWER_REJECTED"; readonly reason: string }
  | { readonly type: "ROUND_ENDED"; readonly countryCode: string; readonly countryName: string; readonly results: readonly RoundResult[] }
  | { readonly type: "GAME_COMPLETED"; readonly results: readonly FinalResult[] }
  | { readonly type: "ERROR"; readonly code: string; readonly message: string };
```

Transport abstraction:

```ts
export interface MultiplayerTransport {
  readonly connect: () => Promise<void>;
  readonly disconnect: () => void;
  readonly send: (message: ClientMessage) => void;
  readonly onMessage: (handler: (message: ServerMessage) => void) => () => void;
  readonly onStatusChange: (handler: (status: TransportStatus) => void) => () => void;
}
```

Start with a mock transport for UI development. Add a real WebSocket transport after solo architecture and protocol are stable.

## UI Redesign Direction

The current visual style can inspire the new app, but the UI should be redesigned around clearer screens.

Screens:

- Home
- Mode Select
- Solo Game
- Results
- Multiplayer Lobby
- Multiplayer Game

Desktop game layout:

```text
Header: mode, score, streak, accuracy, remaining

Main area:
  Large flag card
  Guess input
  Result feedback
  Hint / skip / restart controls

Side panel:
  Progress summary
  Recent correct guesses
  Mode info

Progress board:
  Continent-grouped country board
```

Mobile game layout:

```text
Stats strip
Flag card
Guess input
Feedback
Actions
Progress drawer
```

Rendering should use stable DOM nodes. Avoid rebuilding the full board after each guess.

Board renderer shape:

```ts
export interface BoardView {
  readonly element: HTMLElement;
  readonly rowByCountryId: ReadonlyMap<CountryId, HTMLTableRowElement>;
  readonly continentHeaderByContinent: ReadonlyMap<Continent, HTMLElement>;
}
```

## Persistence

Solo progress should be saved locally with a versioned format.

```ts
export interface SoloSaveV1 {
  readonly version: 1;
  readonly modeId: string;
  readonly seed: string;
  readonly currentCountryCode: string | null;
  readonly guessedCountryCodes: readonly string[];
  readonly skippedCountryCodes: readonly string[];
  readonly attempts: number;
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly streak: number;
  readonly bestStreak: number;
  readonly startedAt: number;
  readonly updatedAt: number;
}
```

Storage keys:

```text
locato:solo:v1
locato:settings:v1
```

Bad or outdated save data must not crash the app.

## Testing Plan

Use Vitest.

Required tests:

```text
tests/normalize.test.ts
tests/countries.test.ts
tests/gameEngine.test.ts
tests/roundQueue.test.ts
tests/modes.test.ts
tests/localSave.test.ts
tests/protocol.test.ts
```

Test behavior, not implementation details.

Important coverage:

- `United Kingdom` matches correctly
- aliases and country codes behave according to mode config
- accents normalize correctly
- dataset has expected country count
- country codes are unique
- every flag file exists
- correct guess updates state correctly
- wrong guess resets streak and keeps the flag live
- skip resets streak but does not count as an attempt
- reset clears state
- completion is detected
- seeded round order is deterministic
- saved progress can be restored
- multiplayer public round state does not expose answers

## Implementation Phases

### Phase 1 — Tooling and Project Foundation

Add:

- `package.json`
- `tsconfig.json`
- `vite.config.ts`
- `vitest.config.ts`
- `src/main.ts`

Scripts:

```json
{
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Acceptance:

- Vite dev server starts.
- Build succeeds.
- Test command runs.
- `index.html` loads `src/main.ts` as a module.

### Phase 2 — Country Data and Validation

Convert `data/countries.js` into typed data under `src/core/countries/countries.ts`.

Implement:

- country types
- normalization
- country indexing
- validation
- dataset tests

Acceptance:

- No global `window.COUNTRIES` dependency.
- Dataset validates.
- Matching logic is testable without the browser.

### Phase 3 — Pure Game Engine

Implement:

- game state
- commands
- events
- reducer/dispatcher
- seeded random
- round queue
- classic game behavior

Acceptance:

- Solo game behavior works with no DOM.
- Deterministic seeds produce deterministic flag order.
- Engine tests pass.

### Phase 4 — Mode System

Implement:

- mode interface
- classic mode
- continent mode
- timed mode core rules
- streak mode core rules
- mode registry

Acceptance:

- Adding a mode does not require changing rendering code.
- Mode behavior is covered by tests.

### Phase 5 — App Shell and Routing

Implement:

- app controller
- route model
- screen lifecycle
- Home screen
- Mode Select screen
- Solo Game screen
- Results screen placeholder

Acceptance:

- User can navigate into a solo game.
- Screen event listeners are cleaned up on teardown.

### Phase 6 — Redesigned Solo UI

Implement:

- polished game layout
- flag view
- stats view
- feedback view
- controls
- continent board renderer
- responsive styles
- reduced-motion support

Acceptance:

- Correct, wrong, skip, hint, and reset behavior work.
- Board updates without full table rebuild.
- UI works on desktop and mobile widths.

### Phase 7 — Local Persistence

Implement:

- versioned save format
- save/load helpers
- continue/new game behavior
- settings storage

Acceptance:

- Refreshing preserves solo progress.
- Invalid save data is ignored safely.

### Phase 8 — Multiplayer Protocol Foundation

Implement:

- typed client/server messages
- public room state
- public round state
- transport abstraction
- mock multiplayer transport

Acceptance:

- Multiplayer UI can be developed without a real server.
- Public round state does not include answers.

### Phase 9 — Multiplayer Lobby and Game Shell

Implement against the mock transport:

- player name input
- create room
- join room
- room code display
- player list
- ready toggle
- mock round display
- multiplayer scoreboard shell

Acceptance:

- Multiplayer flow can be clicked through locally with mock state.
- The UI is ready for a real transport.

### Phase 10 — Real Multiplayer Server

Implement after the solo app, mode system, and protocol are stable.

Server responsibilities:

- create room
- join room
- leave room
- ready/unready
- start game
- start round
- validate answer
- score round
- broadcast state
- handle disconnects

Acceptance:

- Two browser clients can join the same room.
- Both receive the same flag.
- Server validates answers.
- Server decides round winner.
- Round result reveals the country.
- Final scoreboard is server-generated.

### Phase 11 — Cutover and Cleanup

Remove or stop using prototype files:

- `app.js`
- `data/countries.js`
- old `styles.css`

Final verification:

- tests pass
- build succeeds
- solo flow works manually
- persistence works after refresh
- responsive layout works
- multiplayer mock flow works
- real multiplayer flow works if Phase 10 is included

## Recommended Build Order

```text
1. Tooling and Vite/TypeScript setup
2. Country data conversion
3. Normalization and country validation tests
4. Pure game engine
5. Classic mode
6. Solo UI redesign
7. Board renderer
8. Local persistence
9. Additional solo modes
10. Multiplayer protocol
11. Multiplayer lobby/game UI with mock transport
12. Real WebSocket server
13. Final cleanup and cutover
```

## Non-Goals for the First Refactor

Do not add these during the foundation rebuild unless they become necessary:

- user accounts
- database persistence
- global leaderboards
- ranked matchmaking
- chat
- payments
- large frontend framework
- complex animation library
- binary multiplayer protocol

The first refactor should create a clean base. Multiplayer should be designed for, but the solo engine and UI should become solid before adding server complexity.
