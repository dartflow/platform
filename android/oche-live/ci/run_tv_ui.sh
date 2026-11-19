#!/usr/bin/env bash
# TV has no phone swipe lock. Wait for usable Android services before testing.
set -euo pipefail

test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "${RUNNER_OS:-}" = Linux
: "${ANDROID_HOME:?Android SDK is required}"
: "${RUNNER_TEMP:?GitHub runner temp directory is required}"
test -c /dev/kvm

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
reports="$project_dir/app/build/reports/androidTests/tv-runner"
mkdir -p "$reports"
export ANDROID_AVD_HOME="$RUNNER_TEMP/oche-tv-avd"
mkdir -p "$ANDROID_AVD_HOME"
adb="$ANDROID_HOME/platform-tools/adb"
emulator="$ANDROID_HOME/emulator/emulator"
sdkmanager="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
avdmanager="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
serial='emulator-5554'
emulator_pid=''

cleanup() {
  result=$?
  trap - EXIT INT TERM
  set +e
  if [[ -n "$emulator_pid" ]]; then
    timeout 15 "$adb" -s "$serial" logcat -d -v threadtime > "$reports/logcat.txt" 2>&1
    timeout 10 "$adb" -s "$serial" shell getprop > "$reports/properties.txt" 2>&1
    timeout 10 "$adb" -s "$serial" emu kill >> "$reports/emulator-cleanup.txt" 2>&1
    for _ in {1..10}; do
      kill -0 "$emulator_pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$emulator_pid" 2>/dev/null; then
      kill -TERM "$emulator_pid"
      for _ in {1..5}; do
        kill -0 "$emulator_pid" 2>/dev/null || break
        sleep 1
      done
    fi
    if kill -0 "$emulator_pid" 2>/dev/null; then
      kill -KILL "$emulator_pid"
      for _ in {1..3}; do
        kill -0 "$emulator_pid" 2>/dev/null || break
        sleep 1
      done
    fi
    # Reap only an exited child; cleanup must never wait indefinitely.
    if ! kill -0 "$emulator_pid" 2>/dev/null; then
      wait "$emulator_pid" 2>/dev/null
    else
      echo "Emulator PID $emulator_pid did not exit after bounded TERM/KILL cleanup." >&2
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

timeout 120 "$sdkmanager" --licenses < <(printf 'y\n%.0s' {1..50}) > "$reports/sdk-licenses.txt"
timeout 600 "$sdkmanager" 'platform-tools' 'emulator' 'platforms;android-36' 'build-tools;36.0.0' 'system-images;android-36;android-tv;x86_64'
timeout 60 "$avdmanager" create avd --force --name oche-tv-ci --package 'system-images;android-36;android-tv;x86_64' --device tv_1080p <<< 'no'
timeout 15 "$adb" start-server
"$emulator" -avd oche-tv-ci -port 5554 -no-window -gpu swiftshader_indirect -no-snapshot -no-audio -no-boot-anim -no-metrics > "$reports/emulator.log" 2>&1 &
emulator_pid=$!

# sys.boot_completed alone precedes InputManager/WindowManager readiness on TV.
# Every readiness operation is bounded; none of the application tests is ignored.
device_ready() {
  timeout 5 "$adb" -s "$serial" shell getprop sys.boot_completed | tr -d '\r' | grep -qx 1 || return 1
  timeout 5 "$adb" -s "$serial" shell cmd package path android | grep -q '^package:' || return 1
  for service in package input window; do
    timeout 5 "$adb" -s "$serial" shell service check "$service" | grep -q ': found' || return 1
  done
  timeout 5 "$adb" -s "$serial" shell wm dismiss-keyguard || return 1
  timeout 5 "$adb" -s "$serial" shell input keyevent KEYCODE_WAKEUP || return 1
}
ready=0
deadline=$((SECONDS + 600))
while ((SECONDS < deadline)); do
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    echo 'Android TV emulator exited before Android services became ready.' >&2
    tail -80 "$reports/emulator.log" >&2
    exit 1
  fi
  printf '\nReadiness attempt at %ss\n' "$SECONDS" >> "$reports/readiness.log"
  if device_ready >> "$reports/readiness.log" 2>&1; then ready=1; break; fi
  sleep 2
done
if ((ready != 1)); then
  echo 'Android TV package/input/window services did not become ready within the bounded startup period.' >&2
  tail -80 "$reports/readiness.log" >&2
  exit 1
fi
for animation in window_animation_scale transition_animation_scale animator_duration_scale; do
  timeout 10 "$adb" -s "$serial" shell settings put global "$animation" 0
done

./gradlew --no-daemon :app:connectedStagingDebugAndroidTest
python3 - <<'PY'
from pathlib import Path
import json
import xml.etree.ElementTree as ET
files = list(Path('app/build/outputs/androidTest-results/connected').rglob('TEST-*.xml'))
if not files:
    raise SystemExit('Android TV produced no instrumentation XML results.')
suites = [ET.parse(path).getroot() for path in files]
result = {key: sum(int(suite.get(key, '0')) for suite in suites) for key in ('tests', 'failures', 'errors', 'skipped')}
Path('app/build/reports/androidTests/tv-runner/runtime-summary.json').write_text(json.dumps(result, indent=2) + '\n')
if result != {'tests': 8, 'failures': 0, 'errors': 0, 'skipped': 0}:
    raise SystemExit(f'Expected all eight instrumentation tests to pass: {result}')
print('Android TV: all eight instrumentation tests passed, none skipped.')
PY
