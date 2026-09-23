plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.paper2audio.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.paper2audio.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
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
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        checkReleaseBuilds = false
    }
    packaging {
        resources {
            // BouncyCastle (pulled in by pdfbox-android) ships duplicate metadata.
            excludes += setOf("META-INF/versions/**", "META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA")
        }
    }
}

dependencies {
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
    implementation("org.jsoup:jsoup:1.17.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
