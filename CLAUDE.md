# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

Excalidraw is a **monorepo** with a clear separation between the core library and the application:

- **`packages/excalidraw/`** — Main React component library published to npm as `@excalidraw/excalidraw`
- **`excalidraw-app/`** — Full-featured web application (excalidraw.com) that consumes the library
- **`packages/common/`** — Shared constants, utilities, event bus, colors (`@excalidraw/common`)
- **`packages/element/`** — Element types, mutation, bounds, delta/store, reconciliation (`@excalidraw/element`)
- **`packages/math/`** — Geometry primitives: points, vectors, curves (`@excalidraw/math`)
- **`packages/utils/`**, **`packages/fractional-indexing/`** — Utility helpers

## Development Commands

```bash
yarn start                  # Start the app (excalidraw-app) in dev mode
yarn test                   # Run vitest in watch mode
yarn test:update            # Run all tests with snapshot updates (run before committing)
yarn test:typecheck         # TypeScript type checking across the monorepo
yarn fix                    # Auto-fix formatting (prettier) and lint (eslint)
yarn test:code              # Lint only (eslint)
yarn test:other             # Prettier check only
yarn build:packages         # Build all packages in dependency order
yarn build:app              # Build the excalidraw-app for production
```

To run a single test file:
```bash
yarn test packages/excalidraw/tests/history.test.tsx
```

## Architecture

### Core rendering: two-canvas split

The editor renders two overlapping `<canvas>` elements managed by `packages/excalidraw/renderer/`:

- **`staticScene.ts`** — Background elements (shapes, text, images). Redrawn only when elements change.
- **`interactiveScene.ts`** — Selections, transform handles, snap lines, remote cursors. Redrawn on every pointer event.

Element rendering dispatches to `packages/element/src/renderElement.ts` (roughjs for sketchy shapes).

### App class and AppState

`packages/excalidraw/components/App.tsx` is a class component (`class App extends React.Component<AppProps, AppState>`) that holds all editor state in `this.state` (`AppState`). It owns event handlers, tool state, and canvas interactions.

**State mutations happen via two paths:**
1. `this.setState(...)` for pure UI state (cursor, tool mode, etc.)
2. `this.updateScene({ elements, appState, captureUpdate })` which routes through the `Store` to capture undo-able deltas

### Action system

User operations are modeled as `Action` objects (`packages/excalidraw/actions/types.ts`). Each action has:
- `name: ActionName` — unique string identifier
- `perform(elements, appState, formData, app): ActionResult` — returns `{ elements?, appState?, captureUpdate }` or `false`

`App` holds an `ActionManager` that registers all built-in actions, dispatches them from keyboard/UI/contextMenu, and merges the result back into scene state. Add new editor behaviors as actions in `packages/excalidraw/actions/`.

### Element model

All elements extend `_ExcalidrawElementBase` (defined in `packages/element/src/types.ts`). Key fields:
- `version` / `versionNonce` — collision-free reconciliation in collaboration
- `index: FractionalIndex` — ordering in multi-user scenarios
- `isDeleted` — soft-delete (elements are never removed from the array)
- `boundElements` — bidirectional binding between arrows and shapes

Mutate elements via `newElementWith` or `mutateElement` (never direct assignment — they bump `version`).

### Store, undo/redo, and CaptureUpdateAction

`packages/element/src/store.ts` observes each `updateScene` call and emits `StoreIncrement` events. The `History` class in `packages/excalidraw/history.ts` listens to those events and stacks `HistoryDelta` objects (element + appState diffs) for undo/redo.

The `captureUpdate` field on every `ActionResult` controls undo granularity:
- `CaptureUpdateAction.IMMEDIATELY` — captured right away (most edits)
- `CaptureUpdateAction.EVENTUALLY` — deferred until the next immediate capture (e.g. mid-drag)
- `CaptureUpdateAction.NEVER` — never recorded (remote updates, initialization)

### State management: Jotai isolation

`packages/excalidraw/editor-jotai.ts` creates an **isolated Jotai store** (`jotai-scope`) so the library's atoms don't bleed into the host app's Jotai tree. Always import `useAtom`, `useAtomValue`, etc. from `@excalidraw/excalidraw/editor-jotai`, not directly from `jotai`.

The app layer (`excalidraw-app/`) has its own separate `appJotaiStore` for app-level atoms (collab state, local storage quota, etc.).

### Collaboration (excalidraw-app only)

`excalidraw-app/collab/Collab.tsx` is a PureComponent that handles:
- WebSocket signaling via Firebase Realtime Database
- Element reconciliation: `reconcileElements` merges remote elements using `version`/`versionNonce` and fractional indices
- File uploads to Firebase Storage (`excalidraw-app/data/firebase.ts`)

Collaboration is **app-layer only** — the `packages/excalidraw` library exposes `isCollaborating`, `onPointerUpdate`, and `reconcileElements` as props/API but contains no Firebase or socket code.

### Persistence (excalidraw-app only)

`excalidraw-app/data/LocalData.ts` handles two storage tiers:
- **localStorage** — `AppState` (non-element state: zoom, theme, active tool, etc.)
- **IndexedDB** (`idb-keyval`) — binary files (images) keyed by `FileId`

### Public API surface

`packages/excalidraw/index.tsx` is the library entry point. The main export is `<Excalidraw>` (wraps `<App>` with providers). Consumers get programmatic control via `ExcalidrawImperativeAPI` (passed back via the `onExcalidrawAPI` prop), which exposes `updateScene`, `getSceneElements`, `setActiveTool`, etc.

### Package aliases in tests

`vitest.config.mts` maps `@excalidraw/*` imports to their TypeScript source (`packages/*/src/index.ts`) so tests run against source, not built output.

## Testing conventions

- Tests live in `packages/excalidraw/tests/` and alongside source files (`*.test.ts(x)`)
- Use `window.h` (exposed via `createTestHook()` in `App.tsx`) to access `h.elements`, `h.state`, `h.app` imperatively inside tests
- `GlobalTestState.interactiveCanvas` / `.canvas` give access to the two canvas elements
- `UI` and `Pointer` helpers in `tests/helpers/ui.ts` provide high-level interactions (click, drag, keyboard)
- Snapshots are committed — always run `yarn test:update` before committing any change that touches rendering or serialization
