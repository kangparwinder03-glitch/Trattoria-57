plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "uk.trattoria57.app"
    compileSdk = 34
    defaultConfig {
        applicationId = "uk.trattoria57.app"   // its own app: the T57 Printer app stays installed next to it
        minSdk = 23
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }
    // Same fixed signing key as the printer app, so every new build installs over the old one
    // and the tablet keeps its login, station and saved data.
    signingConfigs {
        create("t57") {
            storeFile = file("../../print-test/app/t57-release.jks")
            storePassword = "trattoria57"
            keyAlias = "t57"
            keyPassword = "trattoria57"
        }
    }
    buildTypes {
        getByName("debug") { signingConfig = signingConfigs.getByName("t57") }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.core:core:1.13.1")   // FileProvider, to share PDFs from the app
}
