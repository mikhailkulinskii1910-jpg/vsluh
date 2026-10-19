plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ru.vsluh.glassblock"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.vsluh.glassblock"
        minSdk = 26
        targetSdk = 35
        versionCode = 7
        versionName = "2.3.1"
    }

    // v2 + v3. Подпись v1 (её требуют некоторые установщики на прошивках Xiaomi и файловые менеджеры)
    // Gradle при minSdk ≥ 24 не ставит — её добавляет apksigner, см. README.
    signingConfigs.getByName("debug") {
        enableV2Signing = true
        enableV3Signing = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = false   // кадры виджета подключены только из layout виджета — не трогаем
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            // Подпись отладочным ключом, чтобы APK можно было сразу установить.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
