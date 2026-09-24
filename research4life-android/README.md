# Research4Life Android app

A lightweight WebView wrapper for https://portal.research4life.org/signin.

- Keeps sign-in cookies (including third-party publisher cookies) between launches
- Downloads PDFs and other files to the phone's Downloads folder
- Supports file uploads, back-button navigation and pinch zoom

## Getting the APK

Every push that touches this folder runs the **Build Research4Life APK** workflow,
which publishes `Research4Life.apk` on the repository's Releases page.
Open that file on an Android phone (Android 7.0+) and allow installing from unknown sources.

## Building locally

With the Android SDK and Gradle 8.7+ installed:

    cd research4life-android
    gradle assembleDebug

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.
