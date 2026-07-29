# Trip Map

Drop a folder of photos onto a web page and get your actual route back: pins on a
map, grouped into trips and days, read from the GPS coordinates and timestamps
your camera already wrote into each file.

Everything runs in the browser. No upload, no server, no accounts, no database.
The photos never leave the machine — there is nowhere for them to go.

## Using it

Open `index.html` and drag a folder of photos onto the page, or click to pick one.

- **Map** — one colored route per trip, pins numbered in time order. Zoomed out,
  nearby photos collapse into counted clusters; zoom past 17 and the individual
  pins return.
- **Sidebar** — trips, each expanding into days, each day into photos. Click a
  trip or day to zoom to it, a photo to open its pin.
- **Unplaced** — photos with no usable coordinates, listed rather than discarded.

## Your library

Photos accumulate. Importing a second folder adds to the map rather than
replacing it, and the library survives reloads — coordinates are kept in
IndexedDB, a database inside the browser. Nothing is uploaded.

A photo's identity is `filename | byte size | capture time`. Photos are
immutable, so that triple is stable and re-importing a folder you have already
added is recognized and skipped:

```
import 1 (Athens, 3 photos)      -> added 3, known 0
import 1 again, same folder      -> added 0, known 3
import 2 (overlaps + 2 new)      -> added 2, known 3
```

**Export** writes the whole library to a JSON file. Keep it somewhere synced and
you have both a backup and a way to move between machines — **Import** merges
one back in, skipping anything already present. **Clear** empties the database
after confirming; it never touches your actual photo files.

Browser storage is per-browser and per-machine, and clearing site data wipes it.
That is what export is for.

## How trips get split

Photos are sorted by timestamp, then a new trip begins when the next photo is
more than **300 km** away or more than **48 hours** later.

Distance is the reliable signal. Time alone is not — a 20-hour overnight gap in
one city is just sleep, so time only splits a trip after a gap long enough that
you were plainly doing something else. Barcelona → Girona stays one trip;
Barcelona → Madrid does not.

## Installing it on a phone

Open the deployed site and use **Add to Home Screen** — Share menu on iOS,
the browser menu on Android. It then launches full-screen with its own icon and
works offline, because a service worker caches the app and the place-name table.
Your library is already local, so once cached there is nothing left that needs a
connection.

On iOS, use **Choose photos** rather than the folder picker: `webkitdirectory`
isn't supported there. Location data does survive the iOS photo picker when
selecting from the library, though photos captured through the picker itself are
reported to lose it.

Phone and laptop keep separate libraries — browser storage is per device, and
nothing is uploaded. Use Export on one and Import on the other to move between
them; the merge skips anything already present.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app — markup, styles, logic |
| `cities.js` | 46,548 place names for labeling trips, offline |
| `sw.js` | Service worker; caches the app for offline use |
| `manifest.json` | Web app manifest — name, colors, icons |
| `probe.html` | Diagnostic page: dumps raw EXIF per photo, exports CSV |

`index.html` needs `cities.js` beside it. Both must be deployed together.

**Bump `CACHE_VERSION` in `sw.js` whenever you change `index.html` or
`cities.js`** — otherwise returning visitors keep being served the cached copy.

Third-party code is loaded from CDNs at runtime: Leaflet, Leaflet.markercluster,
and exifr.

## Things worth knowing

**HEIC works, but not straightforwardly.** Reading EXIF and decoding pixels are
separate operations — exifr finds the metadata without touching image data, so
iPhone photos need no conversion. However, exifr 7.1.3 refuses to open a HEIC
whose `ftyp` box is longer than 50 bytes, and recent iPhones write 52. The app
detects that case and locates the TIFF block itself. When scanning for it, the
literal string `Exif` also appears earlier in the file as an item-type
declaration inside the `iinf` box, so a valid TIFF header must follow or you
parse garbage.

**Hemispheres live in separate tags.** `GPSLatitude` carries a magnitude;
`GPSLatitudeRef` carries N/S/E/W. Read the coordinate without the ref and a San
Francisco photo lands in the Yellow Sea.

**Missing GPS is normal, not an error.** Anything through WhatsApp, Slack, or a
screenshot has coordinates stripped. Separately, cameras with no GPS receiver —
a Canon EOS 650D, for instance — write the tags filled with zeros rather than
omitting them, and 0°, 0° is a real place in the Gulf of Guinea. Both cases go to
the unplaced list.

**Only metadata is read.** Files are matched by extension before being opened, so
a 4 GB video sitting in the folder costs one regular-expression test. For HEICs
the app reads a 256 KB prefix rather than the whole file — pulling all 3.8 MB per
photo is roughly 15x the necessary I/O, which is what makes a large import crawl
once the OS file cache stops absorbing it.

## Known limitations

- Timestamps are local camera time with no timezone. Photos taken either side of
  a border read in their own local time, and nothing corrects for it.
- No thumbnails. Rendering HEIC previews outside Safari needs a WebAssembly
  decoder — roughly 2.7 MB to load and 1–3 seconds per photo.
- Place names come from settlements of 5,000 people or more, matched within
  30 km. Smaller places fall back to coordinates, which is deliberate: naming
  somewhere 40 km away is worse than admitting the app doesn't know.
- RAW formats other than DNG (`.CR2`, `.NEF`, `.ARW`) are skipped.

## Regenerating `cities.js`

```bash
npm install all-the-cities
node build-cities.js
```

Neighborhood-level entries (GeoNames feature code `PPLX`) are excluded —
without that filter central Barcelona resolves to "Eixample" and downtown San
Francisco to "Chinatown".
