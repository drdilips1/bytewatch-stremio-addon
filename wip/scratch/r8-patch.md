# R8 / Play code optimization (deadline Feb; do on Sunday 1 Nov)

Apply with: git apply (the diff below, between the fences)

```diff
From 19b308f346c83a4ac6461b78c250ae8585fccfb5 Mon Sep 17 00:00:00 2001
From: Claude <noreply@anthropic.com>
Date: Tue, 27 Oct 2026 07:40:14 +0000
Subject: [PATCH] Release builds shrunk and obfuscated with R8 (Google Play's
 code optimization)

The voice engine, the app's own classes (saved names, the reader's bridge), pdfbox and
BouncyCastle keep their names; the rest (about two thirds of the classes) is obfuscated.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WDc1c1YKnSJCKEGNbEE2Hi
---
 paper2audio/android/app/build.gradle.kts   |  4 +++-
 paper2audio/android/app/proguard-rules.pro | 23 ++++++++++++++++++++++
 2 files changed, 26 insertions(+), 1 deletion(-)
 create mode 100644 paper2audio/android/app/proguard-rules.pro

diff --git a/paper2audio/android/app/build.gradle.kts b/paper2audio/android/app/build.gradle.kts
index 57f709b..89ea757 100644
--- a/paper2audio/android/app/build.gradle.kts
+++ b/paper2audio/android/app/build.gradle.kts
@@ -65,7 +65,9 @@ android {
 
     buildTypes {
         release {
-            isMinifyEnabled = false
+            // Shrunk and obfuscated (Google Play's code optimization); see proguard-rules.pro.
+            isMinifyEnabled = true
+            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
             signingConfig = signingConfigs.findByName("own") ?: signingConfigs.getByName("debug")
         }
     }
diff --git a/paper2audio/android/app/proguard-rules.pro b/paper2audio/android/app/proguard-rules.pro
new file mode 100644
index 0000000..03507f7
--- /dev/null
+++ b/paper2audio/android/app/proguard-rules.pro
@@ -0,0 +1,23 @@
+# R8 shrinks and obfuscates the release builds (Google Play asks for it). What has to keep its
+# names stays readable:
+
+# The voice engine: its native library finds these classes, fields and methods by name.
+-keep class com.k2fsa.sherpa.onnx.** { *; }
+
+# The app's own code: saved settings and lists use enum and class names, and the reader
+# page calls the bridge's methods by name.
+-keep class com.paper2audio.app.** { *; }
+-keepclassmembers class * {
+    @android.webkit.JavascriptInterface <methods>;
+}
+
+# PDF reading: pdfbox loads its fonts, resources and parts by name, and password-protected
+# PDFs use BouncyCastle, whose provider finds its ciphers by class name.
+-keep class com.tom_roush.** { *; }
+-keep class org.bouncycastle.** { *; }
+
+# Crash reports stay readable.
+-keepattributes SourceFile,LineNumberTable,Signature,*Annotation*,InnerClasses,EnclosingMethod
+
+# An optional JPEG 2000 decoder pdfbox can use when present; the app never included it.
+-dontwarn com.gemalto.jp2.**
-- 
2.43.0

```
