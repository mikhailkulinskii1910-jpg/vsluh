#!/bin/bash
# Сборка APK без Gradle: aapt2 → javac → dx → zipalign → apksigner
# Нужны: android.jar (API 29), aapt2, zipalign, dx.jar, apksigner.jar, JDK.
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_JAR:?путь к android.jar}" "${AAPT2:?}" "${ZIPALIGN:?}" "${DX_JAR:?}" "${APKSIGNER_JAR:?}" "${KEYSTORE:?}"
OUT=build; rm -rf $OUT; mkdir -p $OUT/gen $OUT/classes

"$AAPT2" compile --dir res -o $OUT/res.zip
"$AAPT2" link -o $OUT/base.apk -I "$ANDROID_JAR" --manifest AndroidManifest.xml \
  -A assets --java $OUT/gen --min-sdk-version 21 --target-sdk-version 29 \
  --version-code 9 --version-name 1.8 -0 bin $OUT/res.zip

find src $OUT/gen -name '*.java' > $OUT/sources.txt
javac -source 8 -target 8 -encoding UTF-8 -nowarn -Xlint:-options \
  -bootclasspath "$ANDROID_JAR" -d $OUT/classes @$OUT/sources.txt

java -cp "$DX_JAR" com.android.dx.command.Main --dex --min-sdk-version=21 --output=$OUT/classes.dex $OUT/classes

cp $OUT/base.apk $OUT/unsigned.apk
(cd $OUT && zip -q -j unsigned.apk classes.dex)
"$ZIPALIGN" -p -f 4 $OUT/unsigned.apk $OUT/aligned.apk
java -jar "$APKSIGNER_JAR" sign --ks "$KEYSTORE" --ks-pass pass:esp32flasher --key-pass pass:esp32flasher \
  --min-sdk-version 21 --out $OUT/ESP32-Flasher.apk $OUT/aligned.apk
java -jar "$APKSIGNER_JAR" verify --verbose $OUT/ESP32-Flasher.apk
