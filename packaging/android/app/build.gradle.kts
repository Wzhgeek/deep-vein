plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.wzhgeek.deepvein"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.wzhgeek.deepvein"
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }
    // 只保留 arm64 + armeabi-v7a，包更小
    splits { abi { isEnable = false } }
    buildTypes {
        release {
            isMinifyEnabled = false          // 壳子太小，混淆没意义
            isShrinkResources = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
}
