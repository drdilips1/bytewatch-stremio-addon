import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.paper2audio.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.paper2audio.app"
        minSdk = 26
        targetSdk = 34
        // Samsung Galaxy and nearly all current phones are 64-bit ARM; this keeps the APK small.
        ndk { abiFilters += "arm64-v8a" }
        versionCode = 37
        versionName = "6.9.8"
    }

    buildFeatures { buildConfig = true }

    // "full": the sideloaded app with every feature. "lite": the Play Store edition
    // (on-device voices only, no AI or accounts, no ads).
    flavorDimensions += "edition"
    productFlavors {
        create("full") {
            dimension = "edition"
            targetSdk = 34
            buildConfigField("boolean", "LITE", "false")
        }
        create("lite") {
            dimension = "edition"
            // Permanent once uploaded to Google Play.
            applicationId = "com.narrato.reader"
            targetSdk = 36
            versionCode = 38
            versionName = "1.9.28"
            buildConfigField("boolean", "LITE", "true")
        }
    }

    // Sign with your own key when P2A_KEYSTORE is set (see README), so new
    // builds install over old ones. Otherwise fall back to the debug key.
    val keystore = System.getenv("P2A_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (keystore != null) {
            create("own") {
                storeFile = keystore
                storePassword = System.getenv("P2A_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("P2A_KEY_ALIAS")
                keyPassword = System.getenv("P2A_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("own") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint {
        checkReleaseBuilds = false
    }
    // Ready-made voices shared from Paper to Audio are WAV files read straight from the APK.
    androidResources {
        noCompress += "wav"
    }
    packaging {
        resources {
            // BouncyCastle (pulled in by pdfbox-android) and Apache Commons ship duplicate metadata.
            excludes += setOf(
                "META-INF/versions/**", "META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA",
                "META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/DEPENDENCIES",
                // Post-quantum crypto tables from BouncyCastle; PDF reading never uses them.
                "org/bouncycastle/pqc/**",
            )
        }
        // Compressed native libraries: a much smaller download (unpacked once at install).
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
    implementation("org.jsoup:jsoup:1.17.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.apache.commons:commons-compress:1.26.2")
    // Google sign-in (Drive sync).
    implementation("com.google.android.gms:play-services-auth:21.2.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // On-device text recognition for photos, camera scans and scanned PDFs (works offline).
    implementation("com.google.mlkit:text-recognition:16.0.1")
    // On-device language detection, to pick voices that speak the document's language.
    implementation("com.google.mlkit:language-id:17.0.6")
    implementation("androidx.core:core:1.13.1")
}
