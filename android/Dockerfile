# Strumenti per costruire l'APK di BLOCKSTRIKE (Android SDK senza Android Studio, niente Gradle).
# La usa scripts/build-android.mjs; non serve installare niente sul computer.
#
# Costruendo questa immagine si accettano le licenze dell'Android SDK (sdkmanager --licenses).

FROM eclipse-temurin:21-jdk-jammy

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip zip curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV ANDROID_HOME=/opt/android-sdk
# Pacchetto e impronta come li pubblica https://developer.android.com/studio («Command line tools only»).
ARG TOOLS=commandlinetools-linux-15859902_latest.zip
ARG TOOLS_SHA256=4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583

RUN curl -fsSL "https://dl.google.com/android/repository/${TOOLS}" -o /tmp/tools.zip \
 && echo "${TOOLS_SHA256}  /tmp/tools.zip" | sha256sum -c - \
 && mkdir -p "$ANDROID_HOME/cmdline-tools" \
 && unzip -q /tmp/tools.zip -d "$ANDROID_HOME/cmdline-tools" \
 && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" \
 && rm /tmp/tools.zip

RUN yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null \
 && "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install "platforms;android-35" "build-tools;35.0.0" > /dev/null

WORKDIR /work
