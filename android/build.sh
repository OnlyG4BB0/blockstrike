#!/usr/bin/env bash
# Costruisce, allinea e firma l'APK. Gira nell'immagine di android/Dockerfile con il progetto in
# /work (lo lancia scripts/build-android.mjs). Variabili: VERSION_CODE, VERSION_NAME, KS_PASS
# (password della chiave, da un file d'ambiente fuori da git).
set -euo pipefail

BT="$ANDROID_HOME/build-tools/35.0.0"
JAR="$ANDROID_HOME/platforms/android-35/android.jar"
APP=/work/android/app
OUT=/work/android/build
WEB=/work/client/dist-android
KS=/work/android/keystore/blockstrike.jks

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/check" "$OUT/assets"
cp -r "$WEB" "$OUT/assets/www"

echo "== tipi dei file del gioco"
javac -d "$OUT/check" "$APP/src/app/blockstrike/gioco/AssetPaths.java" /work/android/check/AssetPathsCheck.java
java -cp "$OUT/check" AssetPathsCheck "$OUT/assets/www"

echo "== risorse e manifest"
"$BT/aapt2" compile --dir "$APP/res" -o "$OUT/res.zip"
"$BT/aapt2" link -I "$JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version 35 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -A "$OUT/assets" --java "$OUT/gen" \
  -o "$OUT/unsigned.apk" "$OUT/res.zip"

echo "== codice"
javac -Xlint:-options -source 8 -target 8 -bootclasspath "$JAR" -classpath "$JAR" -d "$OUT/classes" \
  $(find "$APP/src" "$OUT/gen" -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$OUT" $(find "$OUT/classes" -name '*.class')
(cd "$OUT" && zip -q unsigned.apk classes.dex)

echo "== allineamento e firma"
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
"$BT/zipalign" -c -p 4 "$OUT/aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-key-alias blockstrike --ks-pass env:KS_PASS --key-pass env:KS_PASS \
  --out "$OUT/blockstrike.apk" "$OUT/aligned.apk"

echo "== controlli"
"$BT/apksigner" verify --verbose "$OUT/blockstrike.apk" | grep -E "Verifies|Verified using v[0-9]|Number of signers"
"$BT/zipalign" -c -p 4 "$OUT/blockstrike.apk" && echo "allineato"
"$BT/aapt2" dump badging "$OUT/blockstrike.apk" | grep -E "^package:|^sdkVersion|^targetSdkVersion|^uses-permission|^launchable-activity|^application-label:"
unzip -v "$OUT/blockstrike.apk" | grep -E " resources.arsc| assets/www/index.html| classes.dex"
rm -rf "$OUT/gen" "$OUT/classes" "$OUT/check" "$OUT/assets" "$OUT/res.zip" "$OUT/unsigned.apk" "$OUT/aligned.apk" "$OUT/classes.dex"
ls -l "$OUT/blockstrike.apk"
