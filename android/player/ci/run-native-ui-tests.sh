#!/usr/bin/env bash
set -euo pipefail

# The emulator runner stops the device when its script returns. Pull only the
# named synthetic fixtures while it is still alive, including on failure.
# The shell-owned directory survives Gradle uninstalling the fixture app.
# Keep the real display larger than every requiredSize fixture, including its
# system bars. A 320 px default emulator silently clips a 360 dp capture.
adb shell wm size 480x1000
adb shell wm density 160
adb shell rm -rf /data/local/tmp/dartflow-ui-fixtures
adb shell mkdir -p /data/local/tmp/dartflow-ui-fixtures
ui_test_status=0
./gradlew --no-daemon --info --max-workers=2 :app:connectedDevelopmentDebugAndroidTest || ui_test_status=$?

screenshot_directory=app/build/reports/androidTests/screenshots
mkdir -p "$screenshot_directory"
screenshot_status=0
for screenshot_name in compact-login.png compact-screens.png compact-events.png score-status-default.png score-status-large-font.png compact-home-feed.png clubhouse-premium-dark.png clubhouse-premium-light-large-font.png clubhouse-wizard-review.png clubhouse-theme-dartflow-dark.png clubhouse-theme-dartflow-light.png clubhouse-theme-blue-dark.png clubhouse-theme-blue-light.png clubhouse-theme-magenta-dark.png clubhouse-theme-magenta-light.png support-owner.png notification-settings.png release-campaign-preview.png; do
  screenshot_path="$screenshot_directory/$screenshot_name"
  if adb exec-out cat "/data/local/tmp/dartflow-ui-fixtures/$screenshot_name" > "$screenshot_path" &&
    [[ "$(od -An -tx1 -N8 "$screenshot_path" | tr -d ' \n')" == 89504e470d0a1a0a ]]; then
    printf 'Collected synthetic UI fixture: %s\n' "$screenshot_name"
  else
    rm -f "$screenshot_path"
    printf '::warning::Synthetic UI screenshot unavailable or invalid PNG: %s\n' "$screenshot_name" >&2
    screenshot_status=1
  fi
done

if (( ui_test_status != 0 )); then
  exit "$ui_test_status"
fi
python3 -B ../ci/verify_native_tests.py --app player --kind ui
exit "$screenshot_status"
