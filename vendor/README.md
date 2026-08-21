# vendor/

The four libraries the app runs on, kept here rather than fetched from a CDN.

`build.mjs` inlines all of them into `public/index.html`, so the built file has
no external dependencies at all: it opens on a machine with no internet, and
the native shell can bundle the one file without a folder of assets beside it.

Pinned versions — these are exactly what the app was tested against:

| file           | package                | version |
|----------------|------------------------|---------|
| react.js       | react (UMD, production)| 18      |
| react-dom.js   | react-dom (UMD, prod)  | 18      |
| xlsx.js        | xlsx-js-style          | 1.2.0   |
| leaflet.js     | leaflet                | 1.9.4   |
| leaflet.css    | leaflet                | 1.9.4   |

`leaflet.css` is not the stock file: its three `url(images/…png)` references
have been replaced with inline data URIs, so the stylesheet needs no image
folder beside it.

To update one, install the version from npm and copy the UMD build in — then
run `npm run check && npm run build` and walk the app before committing.

## The one thing still off-site

Map tiles. `FleetMap` draws its background from
`tile.openstreetmap.org`, which is a live picture of the world and cannot be
bundled. With no internet the map shows its markers on an empty background and
everything else in the app works normally - the tiles are the only thing that
needs the outside world, and losing them costs a backdrop rather than a
function.
