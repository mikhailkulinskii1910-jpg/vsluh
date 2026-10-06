plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ru.irbis.remote"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.irbis.remote"
        minSdk = 26
        targetSdk = 35
        versionCode = 11
        versionName = "1.8"
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

// Гид «Как пользоваться» — общий с веб-версией: при сборке копируется из irbis/guide/ в assets/guide.
val syncHelp = tasks.register<Sync>("syncHelp") {
    from("../../irbis/guide") { exclude("sw.js", "manifest.webmanifest", "icon-*.png") }
    into(layout.buildDirectory.dir("helpAssets/guide"))
}
android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("helpAssets"))
tasks.named("preBuild") { dependsOn(syncHelp) }
