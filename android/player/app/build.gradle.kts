import java.util.Properties

plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose") }
val releaseVersion = Properties().apply { rootProject.file("version.properties").inputStream().use { load(it) } }
val signingNames = listOf("PLAYER_UPLOAD_KEYSTORE_PATH", "PLAYER_UPLOAD_STORE_PASSWORD", "PLAYER_UPLOAD_KEY_ALIAS", "PLAYER_UPLOAD_KEY_PASSWORD")
if (providers.gradleProperty("playerRequireSigning").orNull == "true") {
    require(signingNames.all { !System.getenv(it).isNullOrBlank() }) { "Spelersapp signing ontbreekt; gebruik een eigen uploadsleutel." }
    require(providers.gradleProperty("playerVersionCode").isPresent) { "Expliciete releaseversie vereist." }
}
android {
    namespace = "nl.dartflow.app"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "nl.dartflow.app"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.gradleProperty("playerVersionCode").orElse("6").get().toInt()
        versionName = providers.gradleProperty("playerVersionName").orElse(releaseVersion.getProperty("versionName")).get()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
    }
    signingConfigs {
        create("upload") {
            System.getenv("PLAYER_UPLOAD_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }?.let {
                storeFile = file(it)
                storePassword = System.getenv("PLAYER_UPLOAD_STORE_PASSWORD")
                keyAlias = System.getenv("PLAYER_UPLOAD_KEY_ALIAS")
                keyPassword = System.getenv("PLAYER_UPLOAD_KEY_PASSWORD")
            }
        }
    }
    flavorDimensions += "environment"
    productFlavors {
        create("production") {
            dimension = "environment"
            buildConfigField("String", "API_ORIGIN", "\"https://dartflow.nl\"")
            buildConfigField("String", "AUTH_SCHEME", "\"nl.dartflow.app\"")
            buildConfigField("boolean", "LOCAL_FIXTURES", "false")
            manifestPlaceholders["playerHost"] = "dartflow.nl"
            manifestPlaceholders["playerScheme"] = "nl.dartflow.app"
        }
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            resValue("string", "app_name", "DartFlow · Staging")
            buildConfigField("String", "API_ORIGIN", "\"https://staging.dartflow.nl\"")
            buildConfigField("String", "AUTH_SCHEME", "\"nl.dartflow.app.staging\"")
            buildConfigField("boolean", "LOCAL_FIXTURES", "false")
            manifestPlaceholders["playerHost"] = "staging.dartflow.nl"
            manifestPlaceholders["playerScheme"] = "nl.dartflow.app.staging"
        }
        create("development") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            resValue("string", "app_name", "DartFlow · Development")
            buildConfigField("String", "API_ORIGIN", "\"http://127.0.0.1:3000\"")
            buildConfigField("String", "AUTH_SCHEME", "\"nl.dartflow.app.dev\"")
            buildConfigField("boolean", "LOCAL_FIXTURES", "true")
            manifestPlaceholders["playerHost"] = "localhost"
            manifestPlaceholders["playerScheme"] = "nl.dartflow.app.dev"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (!System.getenv("PLAYER_UPLOAD_KEYSTORE_PATH").isNullOrBlank()) signingConfig = signingConfigs.getByName("upload")
        }
    }
    // Fixture access can never be packaged in a release, even accidentally.
    androidComponents.beforeVariants { if (it.buildType == "release" && it.productFlavors.any { flavor -> flavor.second == "development" }) it.enable = false }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions { unitTests.isReturnDefaultValues = true }
    lint { abortOnError = true; checkReleaseBuilds = true }
}
dependencies {
    constraints {
        // FCM's legacy support dependency otherwise selects Fragment 1.0.0,
        // which predates the Activity Result permission contract.
        implementation("androidx.fragment:fragment:1.8.9")
    }
    implementation(platform("androidx.compose:compose-bom:2025.09.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.browser:browser:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.google.firebase:firebase-messaging:26.0.2")
    implementation("com.google.zxing:core:3.5.3")
    implementation("io.github.webrtc-sdk:android:144.7559.15")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.09.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.6.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
