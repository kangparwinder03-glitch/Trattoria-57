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
        versionCode = 1
        versionName = "0.1-test"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
