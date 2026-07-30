# Trip Map — working notes

Context for anyone (or any Claude) picking this up. The README describes what the
app does; this file records **why it is built the way it is**, so hard-won
findings don't get re-derived or accidentally undone.

- Live: https://trip-map-henna.vercel.app/
- Repo: https://github.com/penguinmaster17/trip-map
- Deploys automatically from `main` on push. No build step.

## What this is

A single static page that reads GPS coordinates and timestamps out of the user's
own photos, plots the route, groups it into trips and days, and can replay a trip
as an animation. Everything runs in the browser. Photos never leave the device.

It was built as a first ship-it project. Scope discipline matters more than
completeness — resist adding infrastructure it doesn't need.

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app: markup, styles, logic. Deliberately one file. |
| `cities.js` | 46,548 place names, generated. Never hand-edit. |
| `sw.js` | Service worker. Caches the app and map tiles. |
| `manifest.json` | PWA manifest. |
| `probe.html` | Diagnostic page. Dumps raw EXIF per photo, exports CSV. |
| `build-cities.js` | Regenerates `cities.js` from the `all-the-cities` package. |
| `deploy.ps1`, `watch-deploy.ps1` | Only needed when the agent can't push. See Deploying. |

## Established findings — do not re-derive

These cost real debugging time. Each is load-bearing.

**Hemispheres live in a separate EXIF tag.** `GPSLatitude` is a magnitude;
`GPSLatitudeRef` carries N/S/E/W. Omit the ref tags from exifr's `pick` list and
a San Francisco photo lands in the Yellow Sea. Both refs must stay in `PICK`.

**exifr 7.1.3 rejects modern iPhone HEICs.** Its format check bails when the
`ftyp` box exceeds 50 bytes; recent iPhones write 52 (major brand `heic`, nine
compatible brands). The workaround finds the TIFF block directly. When scanning
for it, the literal string `Exif` also appears earlier in the file as an
item-type declaration inside the `iinf` box — a valid TIFF header (`MM\0*` or
`II*\0`) must follow or you parse garbage. Verified: decoy at offset 2868, real
payload at 95931.

**Cameras without GPS write zeros, not nothing.** A Canon EOS 650D emits
`GPSLatitude: [0,0,0]`, and 0°,0° is a real place in the Gulf of Guinea. `hasFix()`
rejects exact 0/0, NaN, and out-of-range. A photo genuinely on the equator with a
real longitude still passes.

**Read a prefix, not the whole file.** EXIF sits ~96 KB into a typical HEIC.
Reading all 3.8 MB is ~15x the necessary I/O — 37 GB versus 2.4 GB across 10,000
photos — and that is what makes a large import crawl once the OS file cache
saturates. `parseStubbornHeic` sniffs 12 bytes for the `ftyp` container, then
reads growing prefixes.

**iOS specifics, all verified on device:**
- `webkitdirectory` is unsupported. There must be a plain multi-file input too.
- File inputs must be triggered by a `<label for>`, not `.click()` from script.
  A hidden input triggered programmatically opens the Files browser instead of
  the photo library.
- Hide inputs with clip-based CSS, not `display: none` — a fully hidden input
  can't always be activated by its label.
- Location data **does** survive the iOS photo picker when selecting from the
  library. Photos captured through the picker are reported to lose it.
- Match files on MIME type as well as filename; the picker can return a UUID
  name or none at all.

**EXIF orientation.** Phones store the sensor frame as captured — landscape —
and record the rotation in the `Orientation` tag. Browsers disagree about whether
`createImageBitmap` applies it, so the code **checks**: a quarter-turned photo
comes back with stored width and height swapped if the decoder already did the
work. Rotate by hand only when it clearly didn't, or you get double rotation.
Embedded EXIF thumbnails are bare JPEG with no orientation of their own and
always need it applied manually.

**Leaflet rounds marker positions to whole pixels.** A marker moving less than a
pixel per frame snaps between two integers, which looks like vibration. Playback
draws to a canvas renderer (`L.circleMarker`, `L.canvas()`) for sub-pixel motion.
Don't move playback back to `L.marker`.

**Web Mercator can't fill a portrait screen.** The projection stops near 85°, so
the world is square; zoom out far enough and blank bands appear above and below.
`clampMinZoom()` computes the smallest zoom that still covers the container
(`256 × 2^zoom` pixels tall) and sets `minZoom` there. Recomputed on resize.

**Any permanently-mounted overlay must gate `pointer-events` on its visible
state.** The playback photo card sat at `opacity: 0` with `pointer-events: auto`
above the trip sheet and silently swallowed taps on the Play button. Applies to
`#playphoto`, `#playbar`, `#viewer`, `#intro`, `#mMenu`.

**PowerShell scripts must be plain ASCII.** Windows PowerShell 5.1 reads a `.ps1`
without a BOM using the system codepage, where the bytes of a UTF-8 em dash
decode to a curly quote — which PowerShell treats as a string delimiter. The
script then fails to parse with a misleading error pointing at the wrong line.

**Git reports success on stderr.** `git push` writes `To https://github.com/...`
to stderr. With `$ErrorActionPreference = 'Stop'` and `2>&1`, a successful push
becomes a terminating error. Judge native commands by `$LASTEXITCODE` only.

## Design decisions

**Trip splitting: >300 km or >48 h.** Distance is the reliable signal; time alone
is not, because a 20-hour overnight gap in one city is just sleep. Barcelona →
Girona stays one trip; Barcelona → Madrid splits.

**Playback is paced by distance, not elapsed time.** Timing legs by how long they
actually took gives most of the replay to gaps where nothing happened — sleeping
took 5.1 of 22 seconds in testing while a burst of three photos got 0.08. What
the viewer watches is the line crossing the map, so pace by distance.

**Stops, not photos.** Consecutive photos within 75 m and 45 minutes collapse
into one stop, and only one photo shows. The representative is chosen by file
size — within a burst of the same scene and format, the larger file has more
detail, because a soft frame compresses smaller. It is a proxy for sharpness, not
taste. Ties within 3% go to the later shot.

**Replay length is capped.** Above 28 stops, the route still runs through all of
them but photos appear only at the stops with the most photos — how long someone
lingered is the only signal for how much they cared. Pass-through beats come out
of a separate budget. Every trip lands between 20 and 40 seconds regardless of
size; without these caps a 600-stop trip ran 316 seconds.

**Route curves are centripetal Catmull-Rom.** It passes exactly through every
stop, so the dot lands where the photo was taken, and the centripetal
parameterisation cannot form loops or cusps at sharp turns — which a walking
route doubling back would produce with the uniform version.

**No road routing — decided against, twice.** It needs a routing server, so
coordinates would leave the device and it would stop working offline. Worse, it
assumes road travel: ferries, trains, flights between cities, and pedestrian-only
old towns all produce nonsense. Map tiles are raster images and contain no road
topology — a bridge and a crossroads look identical — so it can't be done from
the cached map either. If revisited, the honest options are vector tiles with
geometry snapping (means replacing Leaflet with MapLibre) or a bundled OSM
extract with a WASM router (tens of MB per region).

**Storage.** IndexedDB, one store, keyed on `filename|size|capture-time`. Photos
are immutable so that triple is stable, which makes merges idempotent and
re-importing a folder a no-op. Records upgrade in place, so re-importing adds
thumbnails to older entries without duplicating. Timestamps persist as epoch
milliseconds; JSON export excludes thumbnail blobs (base64 would turn 300 KB into
hundreds of megabytes).

**Import is two passes.** Metadata for everything first, committed in chunks of
25 — cheap and reliable. Thumbnails second, sequentially. Decoding a 12 MP HEIC
inflates to ~48 MB in memory and running eight in parallel is how a mobile tab
gets killed, taking an uncommitted import with it. Read concurrency adapts:
three on a phone, up to eight on a laptop.

**Crash breadcrumbs.** Each import stage writes a marker to `localStorage`,
cleared on success. A killed tab reloads silently and looks identical to nothing
happening; a leftover marker reports how far it got.

## Conventions

- **Bump `CACHE_VERSION` in `sw.js` on every change to `index.html` or
  `cities.js`.** Otherwise the service worker keeps serving the old build and
  you will waste time wondering why nothing changed.
- American English throughout, in prose and in comments.
- Comments explain *why*, especially where the obvious approach was tried and
  failed. Several comments in `index.html` record a wrong turn on purpose.
- Verify against real files before building on an assumption. The project has
  repeatedly been saved by testing first: the EXIF probe on day one, the HEIC
  `ftyp` discovery, the Canon zeroed-GPS case, the playback pacing.
- One file for the app. Don't split `index.html` without a reason.

## Deploying

**From Claude Code**, git works directly:

```bash
git add -A && git commit -m "..." && git push
```

Vercel builds from `main` in about 30 seconds.

`watch-deploy.ps1` exists because the Cowork sandbox could commit but not push —
it polls for unpushed commits and pushes them. **Not needed from Claude Code**,
and running it alongside an agent that also uses git causes `.git/refs` lock
collisions.

## Known limitations

- Timestamps are local camera time with no timezone.
- Place names cover settlements of 5,000+ people within 30 km; smaller places
  fall back to coordinates, deliberately.
- RAW other than DNG (`.CR2`, `.NEF`, `.ARW`) is skipped. Untested whether exifr
  reads them.
- Library is per-browser and per-device. Export/import is the only sync.
- Previews are 900 px; entries imported before that are 200 px until re-imported.

## Open threads

- **Sync between devices.** Wanted. The argument made previously: the library is
  a few hundred KB of JSON with a single writer, and records are immutable with a
  stable ID, so merging is a set union — no conflict resolution needed. That
  suits file sync through Dropbox or iCloud far better than standing up a
  database and auth. A backend is only justified by *sharing* a trip publicly,
  which is a different feature.
- **Vector basemap** for road-snapped paths, if the curved line stops being good
  enough.
- **A `.vercelignore`** so the scripts and README aren't served publicly.
