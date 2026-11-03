plugins { id("com.android.application") }

android {
    namespace = "ru.maptag.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "ru.maptag.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 5
        versionName = "1.4"
    }
    signingConfigs {
        create("release") {
            storeFile = file("../maptag.jks")
            storePassword = "maptag"
            keyAlias = "maptag"
            keyPassword = "maptag"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
android.testOptions.unitTests.isIncludeAndroidResources = true

// Веб-версия (папка map_tag/) копируется в assets/www при каждой сборке
val syncWeb = tasks.register<Sync>("syncWeb") {
    from("../..") { include("index.html", "manifest.webmanifest", "css/**", "js/**", "lib/**", "icons/icon-192.png") }
    into(layout.buildDirectory.dir("webAssets/www"))
}
android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("webAssets"))
tasks.named("preBuild") { dependsOn(syncWeb) }
