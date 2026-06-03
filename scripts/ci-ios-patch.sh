#!/usr/bin/env bash
# ci-ios-patch.sh — re-apply native iOS config after `npx cap add ios`.
#
# BUILD 2 SCOPE: microphone + export-compliance + iOS-15 floor (Build 1) PLUS
# the APNs push entitlement (aps-environment + CODE_SIGN_ENTITLEMENTS wiring).
#
# Runs on the Codemagic Mac mini (BSD userland). ios/ is generated fresh every
# build and NOT committed, so these settings must be re-applied on EVERY build.
# Idempotent (Set first, Add on failure). Run from the repo root (CM_BUILD_DIR).
set -euo pipefail

PLIST="ios/App/App/Info.plist"
PODFILE="ios/App/Podfile"
ENTITLEMENTS="ios/App/App/App.entitlements"
PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"
BUNDLE_ID="com.dreighto.sully"

if [ ! -f "$PLIST" ]; then
  echo "ERROR: $PLIST not found — did 'npx cap add ios --packagemanager CocoaPods' run first?" >&2
  exit 1
fi

# --- Info.plist keys ---------------------------------------------------------
set_or_add() {  # $1 key  $2 type(string|bool)  $3 value
  /usr/libexec/PlistBuddy -c "Set :$1 $3" "$PLIST" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PLIST"
}

# Microphone usage string — REQUIRED or the iOS mic prompt never fires and
# getUserMedia() rejects (voice mode dies silently).
set_or_add NSMicrophoneUsageDescription string "Sully uses the microphone for voice conversations."

# Declare no non-exempt encryption so TestFlight uploads skip the manual
# export-compliance question on every build.
set_or_add ITSAppUsesNonExemptEncryption bool false

# --- Podfile iOS deployment floor -------------------------------------------
# Capacitor 8 requires iOS 15.0. The CocoaPods template usually defaults to
# 15.0, but assert it so a regressed template can't resolve the wrong Cap pod.
# Runs BEFORE `cap sync` (which runs pod install), so the floor is honored.
if [ -f "$PODFILE" ]; then
  perl -0pi -e "s/platform :ios, '[0-9.]+'/platform :ios, '15.0'/g" "$PODFILE"
  echo "Podfile platform line:"; grep "platform :ios" "$PODFILE" || true
fi

# --- APNs push entitlement (Build 2) -----------------------------------------
# 1) Write the entitlements file. aps-environment=production — TestFlight + App
#    Store builds use the PRODUCTION APNs gateway (api.push.apple.com). A
#    development value here against a TestFlight build = silent BadDeviceToken.
cat > "$ENTITLEMENTS" <<'PLISTEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>aps-environment</key>
	<string>production</string>
</dict>
</plist>
PLISTEOF
echo "wrote $ENTITLEMENTS"

# 2) Wire CODE_SIGN_ENTITLEMENTS into every App-target build config. Anchor on
#    the PRODUCT_BUNDLE_IDENTIFIER line (present once per build config for the
#    App target) and insert the entitlements path right after it — but only if
#    not already present (idempotent across re-runs). Capacitor's generated
#    pbxproj uses tabs + "KEY = VALUE;" lines; we match that shape.
if [ -f "$PBXPROJ" ]; then
  if grep -q "CODE_SIGN_ENTITLEMENTS = App/App.entitlements;" "$PBXPROJ"; then
    echo "CODE_SIGN_ENTITLEMENTS already wired — skipping"
  else
    perl -0pi -e \
      's/(PRODUCT_BUNDLE_IDENTIFIER = \Q'"$BUNDLE_ID"'\E;)/$1\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App\/App.entitlements;/g' \
      "$PBXPROJ"
    echo "wired CODE_SIGN_ENTITLEMENTS into $(grep -c 'CODE_SIGN_ENTITLEMENTS = App/App.entitlements;' "$PBXPROJ") build config(s)"
  fi
else
  echo "WARNING: $PBXPROJ not found — entitlement not wired" >&2
fi

# --- Verify (printed in the build log) ---------------------------------------
echo 'iOS patch complete:'
/usr/libexec/PlistBuddy -c 'Print :NSMicrophoneUsageDescription' "$PLIST"
/usr/libexec/PlistBuddy -c 'Print :ITSAppUsesNonExemptEncryption' "$PLIST"
echo "aps-environment:"; /usr/libexec/PlistBuddy -c 'Print :aps-environment' "$ENTITLEMENTS" 2>/dev/null || echo '(entitlements file missing)'
echo "CODE_SIGN_ENTITLEMENTS lines:"; grep -c 'CODE_SIGN_ENTITLEMENTS = App/App.entitlements;' "$PBXPROJ" 2>/dev/null || echo 0
