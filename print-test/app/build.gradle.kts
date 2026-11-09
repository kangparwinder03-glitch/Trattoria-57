plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "uk.trattoria57.printtest"
    compileSdk = 34
    defaultConfig {
        applicationId = "uk.trattoria57.printtest"
        minSdk = 23
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }
    // One fixed signing key, so every new build installs over the old one (no uninstall needed).
    signingConfigs {
        create("t57") {
            storeFile = file("t57-release.jks")
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
