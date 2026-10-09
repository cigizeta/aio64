# Android setup -- v1

*Archived 2026-10-09: superseded, Mentes moved to its own repository
(tag `mentes-final`).*

Status: plan, awaiting approval (2026-10-05).

Goal: a "Hello Mentes" screen, rendered by one shared `App()` composable,
running on desktop, on an Android emulator, and on the developer's Samsung
Galaxy A16 over USB. No features, no platform seams yet.

Settles decisions 2 and 5 of mentes-design-summary.md section 11:
restructure modules first; minSdk 26; emulator first, A16 later.

## 1. Facts verified (2026-10-05)

- With AGP 9+, the Kotlin Multiplatform plugin is incompatible with
  `com.android.application` and `com.android.library` in the same module.
  The app module must be separate and depend on a KMP module that uses
  `com.android.kotlin.multiplatform.library`.
  Source: kotlinlang.org "Updating multiplatform projects with Android apps
  to use AGP 9"; JetBrains blog, January 2026.
- Latest stable AGP: 9.4.0 (September 2026), max API level 37.
- Gradle wrapper: 9.8.0. To check during implementation: AGP 9.4's minimum
  Gradle version (expected to be satisfied).
- AGP 9 has built-in Kotlin: the app module does not apply
  `org.jetbrains.kotlin.android`.

## 2. Module layout

```
mentes/
  shared/       KMP library: jvm() + android; all code and UI (App())
  desktopApp/   JVM app: main(), Window, compose.desktop packaging
  androidApp/   com.android.application: MainActivity, manifest, icons
  acpSpike/     unchanged, desktop-only
```

`composeApp/` is removed: its `Main.kt` splits into `shared`'s `App()` and
`desktopApp`'s `main()`.

Package: `io.github.cigizeta.mentes` everywhere; Android `applicationId`
and `namespace` the same (`shared` uses `io.github.cigizeta.mentes.shared`
as its namespace, since namespaces must be unique).

## 3. Gradle changes

`gradle/libs.versions.toml`:
- `agp = "9.4.0"`
- plugins `androidApplication` (`com.android.application`) and
  `androidKmpLibrary` (`com.android.kotlin.multiplatform.library`)
- library `androidx-activity-compose` (latest stable, checked at
  implementation time)

Root `build.gradle.kts`: add both Android plugins with `apply false`.

`settings.gradle.kts`: include `:shared`, `:desktopApp`, `:androidApp`;
drop `:composeApp`. `google()` is already in both repository blocks.

`shared/build.gradle.kts`:
- plugins: kotlinMultiplatform, androidKmpLibrary, composeMultiplatform,
  composeCompiler
- `jvmToolchain(25)` kept
- `jvm()`
- `android { namespace; compileSdk; minSdk = 26 }` with
  `compilerOptions.jvmTarget = JVM_17`: D8 and Android runtimes do not
  accept Java 25 class files
- `commonMain`: compose runtime, foundation, material3
- `jvmTest`: `kotlin("test")` (the existing test setup moves here)

`desktopApp/build.gradle.kts`: kotlinMultiplatform (`jvm()` only) or
kotlinJvm -- pick the one the current JetBrains template uses; depends on
`:shared` and `compose.desktop.currentOs`; holds the existing
`compose.desktop { application { ... } }` block unchanged, with
`mainClass` updated.

`androidApp/build.gradle.kts`:
- plugins: androidApplication, composeCompiler
- `android { namespace; applicationId; compileSdk; minSdk = 26;
  targetSdk }`, Java/Kotlin target 17
- depends on `:shared` and `androidx-activity-compose`

compileSdk/targetSdk: the highest stable API that both AGP 9.4 and the
installed SDK support (36 or 37), decided when the SDK is installed.

## 4. Source files

- `shared/src/commonMain/.../App.kt`: `@Composable fun App()` -- the
  current MaterialTheme/Surface/Text("Mentes") tree.
- `desktopApp/src/jvmMain/.../Main.kt` (or `src/main/kotlin` if kotlinJvm):
  `application { Window(...) { App() } }`.
- `androidApp/src/main/AndroidManifest.xml`: one launcher activity, label
  "Mentes", default icon for now.
- `androidApp/src/main/kotlin/.../MainActivity.kt`:
  `ComponentActivity` + `setContent { App() }`.

## 5. Developer setup (manual, Windows)

1. Install Android Studio for Windows. In the SDK Manager: the
   compileSdk platform, Platform-Tools, Build-Tools, Emulator, and one
   x86_64 Google APIs system image.
2. Open the repo once in Android Studio, or create `local.properties`
   with `sdk.dir=C:\\Users\\<user>\\AppData\\Local\\Android\\Sdk`.
   Already gitignored.
3. Add `<sdk>/platform-tools` to PATH so `adb` works in Git Bash.
4. Device Manager: create an AVD (Pixel-sized phone, same API as
   targetSdk).
5. Later, Galaxy A16 over USB:
   - Install Samsung's "Android USB Driver for Windows" (not Google's).
   - Phone: Settings > About phone > Software information > tap Build
     number 7 times; then Developer options > USB debugging on.
   - Plug in, accept the RSA fingerprint prompt, check `adb devices`.

Gradle keeps using the pinned JDK 25, not Android Studio's bundled JDK.
In Android Studio, set Gradle JDK to the daemon JVM criteria.

## 6. Verification

- `./gradlew :shared:jvmTest` passes.
- `./gradlew :desktopApp:run` shows the window as before.
- `./gradlew :androidApp:assembleDebug` builds an APK.
- With the emulator running: `./gradlew :androidApp:installDebug`, then
  launch "Mentes" from the app drawer.
- Later, the same `installDebug` with the A16 connected.

## 7. Follow-ups after implementation

- Update CLAUDE.md "Build and run" commands (`:desktopApp:run`,
  `:shared:jvmTest`, `:desktopApp:packageDistributionForCurrentOS`, plus
  `:androidApp:installDebug`).
- Update mentes-design-summary.md section 11: decisions 2 and 5 settled.
- Update TODO.md.

## Out of scope

Platform seams (storage, app data, process launching), window size class
layouts, Stockfish bundling, release signing, app icon.
