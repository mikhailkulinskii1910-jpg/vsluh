plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ru.random.wheel"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.random.wheel"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
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

android.testOptions.unitTests.isIncludeAndroidResources = true

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
// Скриншоты: ./gradlew testReleaseUnitTest -PshotsDir=/путь [-ProboDir=/папка с android-all-instrumented]
tasks.withType<Test>().configureEach {
    providers.gradleProperty("shotsDir").orNull?.let { systemProperty("shots.dir", it) }
    providers.gradleProperty("roboDir").orNull?.let {
        systemProperty("robolectric.offline", "true"); systemProperty("robolectric.dependency.dir", it)
    }
}
