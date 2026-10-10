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
        versionCode = 20
        versionName = "4.2"
    }

    buildFeatures { buildConfig = true }

    // "full": the sideloaded app with every feature. "lite": the Play Store edition
    // (on-device voices only, no AI or accounts, supported by ads).
    flavorDimensions += "edition"
    productFlavors {
        create("full") {
            dimension = "edition"
            targetSdk = 34
            buildConfigField("boolean", "LITE", "false")
            buildConfigField("String", "AD_BANNER", "\"\"")
            buildConfigField("String", "AD_INTERSTITIAL", "\"\"")
            manifestPlaceholders["admobAppId"] = ""
        }
        create("lite") {
            dimension = "edition"
            // Permanent once uploaded to Google Play.
            applicationId = "com.narrato.reader"
            targetSdk = 36
            versionCode = 2
            versionName = "1.1"
            buildConfigField("boolean", "LITE", "true")
            // AdMob IDs from the environment (GitHub secrets); Google's test IDs otherwise.
            fun env(name: String, test: String) = System.getenv(name)?.takeIf { it.isNotBlank() } ?: test
            manifestPlaceholders["admobAppId"] = env("ADMOB_APP_ID", "ca-app-pub-3940256099942544~3347511713")
            buildConfigField("String", "AD_BANNER", "\"${env("ADMOB_BANNER_ID", "ca-app-pub-3940256099942544/9214589741")}\"")
            buildConfigField("String", "AD_INTERSTITIAL", "\"${env("ADMOB_INTERSTITIAL_ID", "ca-app-pub-3940256099942544/1033173712")}\"")
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
    // Ads and the EU/UK consent form, in the Play Store edition only.
    "liteImplementation"("com.google.android.gms:play-services-ads:24.4.0")
    "liteImplementation"("com.google.android.ump:user-messaging-platform:3.2.0")
}
