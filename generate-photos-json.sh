#!/usr/bin/env bash
set -euo pipefail

DIR="travel"
OUT="$DIR/photos.json"

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# Ensure travel/ exists
if [ ! -d "$DIR" ]; then
  echo "❌ Directory '$DIR' not found. Create it and put images inside."
  exit 1
fi

# Collect relative image paths (jpg/jpeg/png), including subfolders (sorted)
RELFILES=()
while IFS= read -r -d '' f; do
  rel="${f#$DIR/}"       # strip "travel/" prefix
  RELFILES+=("$rel")
done < <(find "$DIR" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0 | sort -z)

if [ ${#RELFILES[@]} -eq 0 ]; then
  echo "⚠️  No images found in $DIR (jpg/jpeg/png)."
  echo "[]" > "$OUT"
  echo "✅ Wrote empty $OUT"
  exit 0
fi

# If we have exiftool + jq, build a GPS map and emit mixed array:
#   - {src,lat,lon} for files with GPS
#   - "filename" for files without GPS
if have_cmd exiftool && have_cmd jq; then
  echo "🔎 Using exiftool + jq to extract GPS…"
  TMP_JSON="$(mktemp)"
  exiftool -json -n -r \
    -ext jpg -ext JPG -ext jpeg -ext JPEG -ext png -ext PNG \
    "$DIR" > "$TMP_JSON" || true

  # Build a JSON array of filenames from RELFILES
  FILES_JSON=$(printf '%s\n' "${RELFILES[@]}" | jq -R -s 'split("\n") | map(select(length>0))')

  # Create a map of { "relative/path.jpg": {lat:..., lon:...}, ... }
  GPSMAP_JSON=$(jq --arg dir_prefix "$DIR/" '
    ( map(select(.GPSLatitude != null and .GPSLongitude != null)
          | { ( .SourceFile | sub("^" + ($dir_prefix|gsub("/";"\\/")); "") )
              : { lat: .GPSLatitude, lon: .GPSLongitude } })
    | add ) // {}
  ' "$TMP_JSON")

  # Merge: for each filename, output object if GPS exists, else the filename string
  jq -n --argjson files "$FILES_JSON" --argjson gps "$GPSMAP_JSON" '
    $files
    | map( if ($gps[.] and ($gps[.].lat != null) and ($gps[.].lon != null))
            then { src: ., lat: $gps[.].lat, lon: $gps[.].lon }
            else .
          end )
  ' > "$OUT"

  rm -f "$TMP_JSON"
  COUNT=$(jq 'length' "$OUT" 2>/dev/null || echo 0)
  echo "✅ Wrote $OUT with $COUNT entries (objects for geotagged, strings for others)."
  exit 0
fi

# Fallback: no exiftool and/or no jq → filenames only
if ! have_cmd exiftool; then
  echo "⚠️  'exiftool' not found (brew install exiftool)."
fi
if ! have_cmd jq; then
  echo "⚠️  'jq' not found (brew install jq)."
fi
echo "   Falling back to filename-only JSON."

{
  echo "["
  for i in "${!RELFILES[@]}"; do
    f="${RELFILES[$i]}"
    esc="${f//\\/\\\\}"
    esc="${esc//\"/\\\"}"
    [ "$i" -gt 0 ] && echo ","
    printf '  "%s"' "$esc"
  done
  echo
  echo "]"
} > "$OUT"

COUNT=${#RELFILES[@]}
echo "✅ Wrote fallback $OUT with $COUNT filenames (no GPS)."
