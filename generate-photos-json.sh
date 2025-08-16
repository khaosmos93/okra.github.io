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

# Collect relative image paths (jpg/jpeg/png), including subfolders
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

# Try EXIF path
if have_cmd exiftool && have_cmd jq; then
  echo "🔎 Using exiftool + jq to extract GPS…"
  TMP_JSON="$(mktemp)"
  exiftool -json -n -r \
    -ext jpg -ext JPG -ext jpeg -ext JPEG -ext png -ext PNG \
    "$DIR" > "$TMP_JSON" || true

  jq --arg dir_prefix "$DIR/" '
    [ .[]
      | select(.GPSLatitude != null and .GPSLongitude != null)
      | {
          src: (.SourceFile | sub("^" + ($dir_prefix|gsub("/";"\\/")); "")),
          lat: .GPSLatitude,
          lon: .GPSLongitude
        }
    ]
  ' "$TMP_JSON" > "$OUT" || true
  rm -f "$TMP_JSON"

  COUNT=$(jq 'length' "$OUT" 2>/dev/null || echo 0)
  if [ "$COUNT" -gt 0 ]; then
    echo "✅ Wrote $OUT with $COUNT geotagged photos."
    exit 0
  else
    echo "⚠️  No images with GPS EXIF found. Falling back to filenames."
  fi
else
  if ! have_cmd exiftool; then
    echo "⚠️  'exiftool' not found (brew install exiftool)."
  fi
  if ! have_cmd jq; then
    echo "⚠️  'jq' not found (brew install jq)."
  fi
  echo "   Falling back to filename-only JSON."
fi

# Fallback: filenames only
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
