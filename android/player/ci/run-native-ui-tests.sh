#!/usr/bin/env bash
set -euo pipefail

# The emulator runner stops the device when its script returns. Pull only the
# three named synthetic fixtures while it is still alive, including on failure.
ui_test_status=0
./gradlew --no-daemon --max-workers=2 :app:connectedDevelopmentDebugAndroidTest || ui_test_status=$?

screenshot_directory=app/build/reports/androidTests/screenshots
mkdir -p "$screenshot_directory"
screenshot_status=0
for screenshot_name in compact-login.png compact-screens.png compact-events.png; do
  screenshot_path="$screenshot_directory/$screenshot_name"
  if adb exec-out run-as nl.dartflow.app.dev cat "files/$screenshot_name" > "$screenshot_path" && [[ -s "$screenshot_path" ]]; then
    printf 'Collected synthetic UI fixture: %s\n' "$screenshot_name"
  else
    rm -f "$screenshot_path"
    printf '::warning::Synthetic UI screenshot unavailable: %s\n' "$screenshot_name" >&2
    screenshot_status=1
  fi
done

if (( ui_test_status != 0 )); then
  exit "$ui_test_status"
fi
exit "$screenshot_status"
