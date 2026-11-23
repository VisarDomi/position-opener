# Architecture Decisions

This file describes the current behavior of the app and why it works this way. History lives in git.

## Global Architecture Principles

1. **Mobile First:** We optimize for iOS Safari quirks (viewports, tap delays). If a generic web solution fights with iOS behavior, the iOS workaround wins.
2. **Explicit Architecture:** We use separate Service/Store/Controller layers. Do not inline domain logic into Svelte components.
3. **Event Bus:** Cross-domain communication happens via `bus` (`core/events/globalBus.ts`). Do not import stores deeply across domains.
4. **Comments are Warnings:** The code has few comments. Where a comment explains a workaround, assume it prevents a specific bug. Read the matching note in this file before you remove it.

## Data Authority & Ownership

**Two ownership contexts for candle data**:

1. **Completed candles (past minutes)**: API is the absolute source of truth for all four fields (open, high, low, close). Any mismatch is overwritten by API data. `MarketDataPump` runs a history sync once a minute, between second 30 and second 35. If the newest history bar is more than one minute behind the live candle (a previous-bar gap, for example after a resume), the sync runs every second until the gap closes.

2. **Live candle (current minute)**: Four-field ownership split because the API snapshot is seconds stale while ticks are real-time:
   - **Close** — tick owns. Always. The latest tick price is more current than any API snapshot.
   - **Open** — API owns. The API saw the first trade of the minute; the tick stream may have connected mid-candle.
   - **High/Low** — intelligent merge, no single owner. `Math.max(tick.high, api.high)`, `Math.min(tick.low, api.low)`. Tick may have seen spikes the API missed, or vice versa.

**CandleAggregator implements the live candle rules**: `merge(frame)` applies API open, best-of high/low, and never touches close. The type system backs this up: `CandleFrame` has no `close` field, and the sync removes `close` from the API's current bar before it calls `mergeExternalData`.

**CandleTimeline owns candle order**: Every input is sorted by time and duplicate timestamps are dropped (`dedupAsc`). For each duplicate time, the first candle after the sort is kept and each dropped one is logged with `log.warn`. Every mutation builds a new array; the internal array is never changed in place.

**CandleTimeline.append replaces on same-time instead of dropping**: When a candle completes at minute rollover, the timeline may already have that time slot from the history fetch. The completed candle (tick-accurate close, intelligent-merged h/l) replaces the stale API snapshot — 99% accurate immediately. The next sync overwrites it with API truth. Only candles strictly older than the newest are dropped.

**CandleTimeline.merge is non-destructive**: Replaces overlapping bars with API data (full overwrite for completed candles) and extends if API has newer bars. Never trims — existing bars beyond the new data's range are preserved. This prevents the sync (which splits off the current bar) from deleting the last completed bar in the timeline.

**MarketStore mergeLatestHistory publishes only when the timeline extends**: If the merge did not move the newest bar forward, the chart already has the right bars, so `publishHistory` and the `setData` cycle are skipped to save CPU. The merge still runs, so the API overwrites completed candles in the timeline; the chart shows those corrections on the next history publish.

**MarketStore mergeLatestHistory does not call recalcLiveState**: The live candle is maintained by the feed aggregator via updateLive(). Overwriting it with the last history candle causes the chart to briefly lose the current-minute bar, and series.update() re-adding it shifts the view right by one bar.

**AccountStore localStorage as source of truth**: AccountStore loads accounts from the API but enforces localStorage as the absolute source of truth for which account is active. Server session may not match our localStorage selection (e.g. after a fresh login created a default-account session) — we detect this mismatch and call switchAccount to fix it.

**MarketStore publishes new array references**: `_bidTimeline`/`_askTimeline` are private `CandleTimeline` instances. `publishHistory()` assigns `timeline.toArray()` to `history` (`$state.raw`). Because `CandleTimeline` never mutates its array in place, each publish after a change hands Svelte a new reference, and reference-equality tracking sees it. High-frequency ticks only update `lastCandle` via `publishLiveCandle()` — no history snapshot needed. Candle completion (once/minute) is the only tick-path that calls `publishHistory()`.

**ChartPluginManager functional core / imperative shell**: `$effect` subscribes to reactive state and captures render intent into `pendingHistory`. A single `requestAnimationFrame` callback (`flush()`) reads the queue and makes ALL LWC imperative calls in one synchronous pass per frame. Multiple `$effect` runs between RAFs coalesce — at most one RAF is pending at a time. This prevents Svelte's microtask scheduling from interleaving with LWC's internal RAF render loop.

**ChartPluginManager uses historyVersion as the render trigger**: The chart tracks `renderedVersion` against `marketStore.historyVersion`. When they differ, the next flush calls `setData()`. The prepend count for a version is read once with `consumePrependCount(version)`.

**ChartStateManager owns staleness check**: This class owns the saved state, so it owns the staleness check. If the last data at save time is >24h old, the view is stale — discard it and clear the candle cache for that instrument rather than restoring a misleading viewport.

**Live tracking is owned by ChartCamera**: The chart options do not set `shiftVisibleRangeOnNewBar`, so LWC's default (`true`) applies: LWC shifts the view on a new bar only while the last bar is visible. The camera does its own live tracking with `enforceLivePosition`, which runs only when `anchorChanged` is true (once per minute, new candle) and tracking is on. When the user pans, tracking is lost immediately (binary comparison, no threshold). When tracking is lost, the camera makes no viewport writes — the viewport belongs to the user until they hit reset.

**PositionPoller injects initialBalance**: Business logic injects the initial balance into each position because the API doesn't provide it. When the stored trade context does not match the `dealId`, the current deposit is saved as that position's initial balance (one trade context in localStorage) and reused after that. This relies on accountStore being up to date.

**MarketDataPump stale seed prevention**: On reconnect, only seed the CandleAggregator with a candle that belongs to the current minute. A stale seed from before sleep is zombie data — neither tick-owned nor API-owned. It would get "completed" with wrong OHLC on the first tick, then replaced by sync, causing a visible teleport.

## iOS PWA Workarounds

**Full-screen chart under translucent iOS status bar**: The chart page renders its canvas at full `screen.height`, extending behind the translucent iOS status bar. `app.html` sets `--app-height` from `screen.height`, `body` uses `height: var(--app-height, 100vh)`, and `viewport-fit=cover` plus `apple-mobile-web-app-status-bar-style=black-translucent` make the status bar blend into the chart background. HUD overlays use `env(safe-area-inset-top)` to sit below the bar, while non-chart pages still get `padding-top: env(safe-area-inset-top)` via the layout's `.safe-area` class.

**setData preserves viewport on prepend — no manual correction**: LWC v5 `setData()` preserves the visible time range when data is prepended. The logical indices shift by +prependCount, but the same candles remain visible. Do not add a manual `setVisibleLogicalRange` correction after a prepend: `setData` shifts synchronously, LWC applies the manual call one frame later, and the view shifts twice. MarketStore stamps prepends via `_prependAtVersion` for observability — the `prepend-stamp` / `chart-render` / `prepend-apply` log chain tracks each prepend.

**Binary pan detection for tracking loss**: On `pointerdown` on the chart, `userAcquire` captures the visible range. On `pointerup` or `pointercancel`, `userRelease` compares immediately — if the range moved at all, `isTracking = false`. A wheel event counts as a full acquire and release. No arbitrary thresholds, no timers, no drift tolerance. Deterministic: if you moved the chart, you own it.

**No programmatic viewport writes when user owns the chart**: While the pointer is down (`userOwnsViewport`) or when `isTracking` is false, `updateAnchor` does not call `enforceLivePosition`. The viewport is entirely user-controlled until they hit reset (`resetZoom`). This prevents all classes of "jump to live edge" bugs during scroll-back.

**TOP_LABEL_OFFSET is 50px**: The fee overlay draws its top label 50px from the top of the chart, which keeps it below the iOS safe area inset at the top of the chart HUD.

**Crosshair suppression uses an API-level guard, not DOM event blocking**: Overlays (`ChartHud`, `TradePopup`) sit above the chart. On iOS, touching an overlay or closing a modal produces synthetic pointer/mouse events that activate LWC's crosshair. Blocking DOM events does not work here: LWC listens on `document`, not just the canvas; the synthetic events come in several types; and a timed block can end before a long touch does. So the app controls the output, not the input: `ChartController` subscribes to `chart.subscribeCrosshairMove()`, and when `crosshairBlocked` is true it clears the crosshair via `clearCrosshairPosition()` in `requestAnimationFrame`.

**Overlay crosshair blocking protocol**: Overlays emit `overlay:block-crosshair` / `overlay:unblock-crosshair` on `bus`. `ChartController` waits 400ms after an unblock before it clears `crosshairBlocked`, to catch post-interaction synthetic events. `ChartHud` blocks on `touchstart`/`mousedown` and unblocks on `touchend`/`mouseup`, and also blocks while `isClosingPosition` is true because unmounting the position section triggers synthetic events. `TradePopup` blocks while open and unblocks on close. Its backdrop remains `pointer-events: none` so chart taps still pass through and let the user re-plan at a different price.

**AppEngine background sentinel**: iOS PWA visibilitychange often doesn't fire on screen unlock. The sentinel interval timer gets frozen by iOS when JS is suspended. When iOS resumes JS, the interval fires with a large time delta (more than 3s) — the most reliable wake signal. Only acts if page is actually visible (screen unlocked) and status is still BACKGROUND.

**ConnectionMonitor backup signals**: pageshow and focus events are backup signals for iOS PWA when visibilitychange doesn't fire on screen unlock.

**Service worker no-op fetch handler**: The fetch listener must exist for iOS 18 PWA installability, but not calling respondWith() lets the browser handle requests natively. Calling respondWith(fetch()) would break ES module caching and cause triple module evaluation. The service worker has no offline cache; `CACHE_NAME` in `sw.js` is unused.

## State Machine & Resume

**AppEngine Exit/Enter pattern**: Hibernate only on EXIT from READY, wakeUp only on ENTER to READY. This prevents double-starts or double-stops when transitioning between non-READY states.

**AppEngine single resume entry point**: All signals (visibility, focus, pageshow, sentinel, online) funnel through handleResume(). Re-entrancy guard prevents concurrent recovery from rapid-fire signals. A resume after 5s or less in the background goes straight back to READY; a longer one runs the full recovery.

**AppEngine no blocking data fetches on resume**: Session validation is the only call the full recovery waits for. After READY it starts a non-blocking account refresh. MarketDataPump's first tick after reconnect runs the history sync, a position refresh and an account refresh.

**AuthStore validates both modes**: validateSession validates BOTH Real and Demo modes (in parallel) so that loadAll() doesn't fail with stale tokens for the non-active mode. In the showcase profile it validates the demo session only.

## Logging

**No log.info — all server logging goes through typed serverLog events**: `log` has no `info` method. If something is worth logging to the server, it must have a typed `LogEntry` variant in the discriminated union. `log.warn` and `log.error` remain for boundary failures that can't be predicted at design time. `log.trace` is for chart diagnostics and only sends while the chart trace is on (see below). `history-publish` fires for the first two history versions and when the candle count changes by more than 5. `chart-render` fires on the first render, for the first two versions, and on every prepend.

**Prepend observability chain**: Three log events form a complete audit trail: (1) `prepend-stamp` — store logs the version-to-count binding when created, (2) `chart-render` — renderer logs that it consumed the prepend count for a given version, (3) `prepend-apply` — renderer logs the viewport logical range before/after `setData()` (LWC handles the shift natively). A canary `log.warn` fires if candle count grows by >100 with no prepend found — the signature of a regression where the count was lost or consumed by the wrong version.

**LogBuffer ownership model**: buffer[] holds entries waiting to be sent (at most 200; the oldest is dropped). inFlight[] holds entries currently in a fetch() call (temporarily transferred). On fetch success, inFlight is dropped. On fetch failure, inFlight is reclaimed back into buffer. On page hide, getAllPending() (inFlight + buffer) is persisted to sessionStorage and beacon-flushed — no entry is ever unowned.

**LogBuffer queueMicrotask on visibilitychange:hidden**: Ensures logs pushed by other visibilitychange handlers (AppEngine, ConnectionMonitor) are captured before the persist + beacon flush runs.

**LogBuffer coalesced persist**: Multiple push() calls within the same microtask result in a single sessionStorage write, avoiding thrash during rapid-fire logging such as a resume.

**Flush-level viewport tracing**: Every `setData` call logs the logical range before and after (`flush-trace`). Any viewport drift >5 bars during a flush is logged as `flush-jump`. `series.update()` jumps of >5 bars are logged as `update-jump`. Every viewport write in ChartCamera logs its caller, the resulting logical range, and tracking/userOwns state (`viewport-write`). These traces are the primary diagnostic tool for viewport bugs — they tell the full story of who moved the chart and when.

**Chart traces are opt-in production telemetry**: `flush-trace`, `prepend-trace`, `update-jump`, `flush-jump` and `viewport-write` use `log.trace`. They ship in production builds but only send while the chart trace is on: the Preferences page turns it on for one hour, with the expiry stored in localStorage. The failure mode here is timing-sensitive iOS/LWC viewport drift under real device conditions, so these traces are the substitute for a traditional unit-test harness on that boundary. Treat them as observability infrastructure, not leftover debug noise.

## Trading Logic

**BreachDetector is a pure function — trading domain owns breach detection**: Given a price and position, detects if SL or TP has been breached. Owns no state, mutates nothing. Market domain emits ticks via the event bus; trading domain (PositionPoller) subscribes and runs breach detection. Market domain never reaches into position state.

**TradeApiService confirmation validation with retry**: Fetches and validates trade confirmation from the broker. A `REJECTED` status throws at once. If the confirmation has no `dealId` or a level of 0 or less, it retries once after 300ms, since the confirmation endpoint can lag behind order execution. Throws if still invalid after retry — callers must not propagate garbage into PnL or balance.

**AccountStore optimistic update**: Immediate local balance update ensures TradePlanner sees correct funds instantly after a trade closes. Assumes single-position mode: floating PnL is reset to 0, available = deposit. Then the store refreshes the account 5 times, 1s apart, to pick up the broker's balance.

**RiskService waitForBrokerPosition**: Polls the broker until the dealId appears in the positions list. Prevents 404s when the broker hasn't persisted the position yet. Uses exponential backoff: 100, 200, 400, 800, 1600, 3200ms (~6.3s total).

**TradePlanner stop loss safety**: Stop loss must result in loss strictly <= 50% of balance.

**TradingDomain click direction**: Click ABOVE offer = Buy (expecting price to go up from offer). Click BELOW bid = Sell (expecting price to go down from bid). Click between bid and offer = ambiguous, ignored for safety.

**CurrentPrice two modes**: Default (no position) = the series' native last-price line and label ON, custom line OFF. Active trading = native line OFF, custom PnL-colored line ON.

## API & Architecture

**MarketRepository date format**: API requires YYYY-MM-DDTHH:mm:ss with no milliseconds and no 'Z' suffix.

**MarketRepository request pattern**: We send 'to' and 'max' (not 'from'). The server counts backwards 'max' rows from 'to'.

**Write calls go through the Node proxy**: `switchAccount`, `updatePreferences` and `updatePosition` use raw fetch to the SvelteKit server routes (`/api/accounts`, `/api/preferences`, `/api/positions`), which forward the PUT to Capital.com. Reads such as `getAccounts` and `getPreferences` use `ApiClient` and call Capital.com directly.

**Login autofill env variables use dynamic/public**: `PUBLIC_API_KEY`, `PUBLIC_IDENTIFIER` and `PUBLIC_PASSWORD` are read from `$env/dynamic/public` at runtime, not at build time, and only in dev. In a production build they are empty.

**calcPriceLine is a pure function**: It is a function, not a class, to avoid object allocation in the hot render loop.

**ChartCamera is a thin utility, not a viewport controller**: Camera handles view restore from localStorage (`initializeView`), resize preservation (`captureViewport`/`applyResize`), reset (`resetZoom`), and live tracking once per new candle (`enforceLivePosition`, only on `anchorChanged` while tracking). It tracks `isTracking` and `userOwnsViewport` to gate live tracking. It does no per-frame enforcement and no drift detection. `pointerdown` captures the visible range, `pointerup` compares immediately — if moved, tracking is lost.

**IndexedDB candle cache for instant restore**: `CandleCache` stores bid `ChartCandle[]` per epic in IndexedDB. On load, cached candles are used as the base and only newer candles are fetched from the API. `loadMoreHistory` writes the published history (`marketStore.history`) back to the cache after each prepend. Cache is invalidated alongside the saved view state when data is >24h stale. Ask candles are not cached, so scroll-back while the chart shows ask (a sell position) is a known edge case.

## Rotation / Resize View Preservation

**ChartUI owns physical dimensions, Camera owns logical viewport**: `ChartUI` (`ChartResizer.svelte.ts`) tracks `lastWidth`/`lastHeight` as plain fields (not $state) and calls the `onBeforeResize`/`onAfterResize` callbacks. Camera's `captureViewport()`/`applyResize()` handle the logical viewport transition. No cross-ownership.

**ChartUI tracks previous dimensions as plain fields**: The resize `$effect` fires because `viewportService.width`/`height` $state already changed, so reading the viewport during the cycle returns the new value, not the old one. ChartUI compares the new size with `lastWidth`/`lastHeight`, which it updates at the end of each resize cycle. It skips the cycle when the size did not change, and it skips the callbacks on the first sizing.

**barSpacing is set once at init, never on resize**: `ChartUI.initBarSpacing()` sets `barSpacing` on chart creation. `updateTimeScaleOptions()` only updates `minimumHeight` on resize (legitimately changes between landscape/portrait). barSpacing is the user's zoom state — overwriting it on resize destroys the view.

**chart.resize() is asynchronous**: LWC's `chart.resize()` does not reflow synchronously. The logical range and `timeScale().width()` remain stale until LWC's deferred reflow (~50ms later). Any corrections must account for this — barSpacing set via `applyOptions` before the reflow will be respected by the deferred reflow.

**LWC priceScale.getVisibleRange() lies after resize**: The API returns stale values that don't match what's rendered on screen. `series.coordinateToPrice()` returns pixel-truth but operates in a different coordinate system (full chartElement height including time scale) than `setVisibleRange` (price area only). Mixing the two compounds errors on every rotation.

**Price capture and restore must use the same coordinate system**: Capture with `priceScale.getVisibleRange()` (API), restore with `priceScale.setVisibleRange()` (API). The API is internally consistent — lies cancel out in the round-trip. Never mix `coordinateToPrice` (pixel truth) with `setVisibleRange` (API truth) — different coordinate systems cause compounding drift.

**Price range scales by height ratio to preserve bar aspect ratio**: `newSpan = oldSpan × (newPriceAreaH / oldPriceAreaH)`, centered on the same midpoint. Price area height = `chartElement().clientHeight - timeScale().height()`. This keeps price-per-pixel constant — bars maintain their visual height. Landscape chops top/bottom of the price range, portrait extends it.

**barSpacing preservation keeps bar width constant**: Camera captures `timeScale().options().barSpacing` before resize and restores it via `applyOptions` after `chart.resize()`. LWC's deferred reflow respects this value and adjusts the visible logical range to fit — more bars visible in landscape, fewer in portrait. The right edge stays pinned, the left edge extends/contracts.

## Margin Buffer & Broker Close-Out

**Position sizing applies `MARGIN_BUFFER_RATIO = 0.98`** to the raw `balance * leverage / price` calculation, so an order uses at most 98% of the balance as margin. The constant lives in `trading.ts` and is consumed by `TradePlanner.calculatePositionSize()`.

**The broker's margin threshold is not confirmed.** The 0.98 buffer assumes Capital.com rejects orders above about 98% margin utilization (`RC_NOT_ENOUGH_MARGIN`). An automated test, however, had an order at 102% of full margin (ratio 1.02) accepted, which suggests the broker computes margin differently from us. The exact threshold needs manual testing: ratios 0.98, 0.99 and 1.00, then finer steps around the boundary, BUY and SELL at each ratio.

**Stop loss vs broker close-out interaction** (assuming the 0.98 buffer is the binding limit):

| Component | Trigger | Loss level |
|---|---|---|
| User stop (`STOP_LOSS_RATIO = 0.5`) | Equity drops to 50% of initial balance | 50% × balance |
| Broker force close-out (50% of used margin) | Equity drops to 50% of used margin | (1 − 0.50 × 0.98) × balance = 51% × balance |

The 2% free margin creates a 1% safety buffer between the user's stop (50% loss) and the broker's force close-out (51% loss). The stop fires first. If the user wants more headroom, `STOP_LOSS_RATIO` can be lowered (e.g. 0.45 gives a 6% buffer).

**Edge cases:**
- **Minimum deal size**: If `balance × MARGIN_BUFFER_RATIO × leverage / price < minDealSize`, the position can't be opened — `calculatePositionSize()` returns null and the planner shows an error.
- **Maximum deal size**: Already capped by `maxDealSize` in the dealing rules — applies after the buffer.
- **Very small balance**: The 2% free margin becomes negligible in dollar terms (e.g. $0.04 on a $2 balance) but the ratio holds.

**Testing against the demo API:**
1. Test one ratio at a time and wait for the confirmation before the next. Do not automate broad sweeps.
2. Respect the rate limits: 1000 POST /positions per hour in demo, 10 req/s general, 1 POST /session per second, 100 topUp per day per account.
3. Do not use topUp. The ratio test does not depend on the balance.
4. Pace every API call with at least 150ms delay.
5. Validate each order via `GET /confirms/{dealRef}`, not just POST 200 OK.
