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
        versionCode = 8
        versionName = "2.4"
    }

    // v2 + v3. Подпись v1 (её требуют некоторые установщики на прошивках Xiaomi и файловые менеджеры)
    // Gradle при minSdk ≥ 24 не ставит — её добавляет apksigner, см. README.
    signingConfigs.getByName("debug") {
        enableV2Signing = true
        enableV3Signing = true
    }

    buildFeatures { buildConfig = true }

    // full — с доступом к уведомлениям (пластинка сама останавливается на паузе в Яндекс Музыке);
    // lite — без него: ставится отдельно, нажатие решает по тому, играет ли музыка сейчас.
    flavorDimensions += "access"
    productFlavors {
        create("full") {
            dimension = "access"
            buildConfigField("boolean", "LISTENER", "true")
        }
        create("lite") {
            dimension = "access"
            applicationIdSuffix = ".lite"
            versionNameSuffix = "-lite"
            buildConfigField("boolean", "LISTENER", "false")
        }
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
