# R8 shrinks and obfuscates the release builds (Google Play asks for it). What has to keep its
# names stays readable:

# The voice engine: its native library finds these classes, fields and methods by name.
-keep class com.k2fsa.sherpa.onnx.** { *; }

# The app's own code: saved settings and lists use enum and class names, and the reader
# page calls the bridge's methods by name.
-keep class com.paper2audio.app.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# PDF reading: pdfbox loads its fonts, resources and parts by name, and password-protected
# PDFs use BouncyCastle, whose provider finds its ciphers by class name.
-keep class com.tom_roush.** { *; }
-keep class org.bouncycastle.** { *; }

# Crash reports stay readable.
-keepattributes SourceFile,LineNumberTable,Signature,*Annotation*,InnerClasses,EnclosingMethod

# An optional JPEG 2000 decoder pdfbox can use when present; the app never included it.
-dontwarn com.gemalto.jp2.**
