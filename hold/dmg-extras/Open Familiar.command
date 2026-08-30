#!/bin/bash
# Familiar is signed, but not notarised — that needs a paid Apple Developer account.
# macOS therefore quarantines it on download. This removes that flag and opens the app.
# You only need this once.
set -u
APP=""
for p in "/Applications/Familiar.app" "$HOME/Applications/Familiar.app" "$(dirname "$0")/Familiar.app"; do
  [ -d "$p" ] && APP="$p" && break
done

if [ -z "$APP" ]; then
  echo "Drag Familiar into your Applications folder first, then run this again."
  echo; read -n 1 -s -r -p "Press any key to close."; exit 1
fi

echo "Clearing the download quarantine on $APP…"
find "$APP" -exec xattr -d com.apple.quarantine {} \; 2>/dev/null
echo "Opening Familiar…"
open "$APP"
sleep 1
echo
echo "Done. You will not need this again."
sleep 2
