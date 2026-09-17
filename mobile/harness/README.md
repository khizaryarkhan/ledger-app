# Mobile visual preview

Screenshots of the **real** app — the actual React Native screens rendered
through react-native-web, driven by Playwright at iPhone-13 size against a
mock API. Nothing is redrawn: change a screen, re-run, see the change.

```bash
cd mobile
npm run shots          # build for web + capture everything
npm run shots:only     # capture without rebuilding (after a harness edit)
npm run shots:only -- today   # only screens whose name matches
```

Output lands in `harness/shots/` (git-ignored — regenerate, don't commit).

## Files

- `mock-api.mjs` — zero-dep HTTP server standing in for the backend. An
  endpoint with no fixture returns a loud 404 with the path, so a missing
  mock shows up as a visible error rather than a blank screen.
- `fixtures.mjs` — the data. Shapes mirror `src/api/types.ts`. Deliberately
  awkward: long customer names, mixed EUR/GBP, a broken promise, an open
  dispute — layout bugs hide behind tidy data.
- `shots.mjs` — the Playwright driver.

## Two things that will bite you

**Type, never `fill()`.** react-native-web's `TextInput` updates React state
only from real key events. `fill()` sets the DOM value directly, React never
sees `onChangeText`, and a button gated on `disabled={!email || !password}`
stays disabled while visibly showing the text you just typed.

**Press with focus+Enter, not `click()`.** RNW renders `Pressable` as a bare
`<div tabindex="0">` with no `role="button"`, and it does not respond to
Playwright's synthetic mouse click — the handler never fires and the screen
silently does nothing. Keyboard activation works.

## Known gap

Invoice detail is not captured — tapping a row in the invoice list has not
been made to work yet. Everything else is covered.
