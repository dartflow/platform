import java.util.Properties
plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose") }
val releaseVersion = Properties().apply { rootProject.file("version.properties").inputStream().use { load(it) } }
if (providers.gradleProperty("ocheRequireSigning").orNull == "true") {
    require(listOf("ANDROID_UPLOAD_KEYSTORE_PATH", "ANDROID_UPLOAD_STORE_PASSWORD", "ANDROID_UPLOAD_KEY_ALIAS", "ANDROID_UPLOAD_KEY_PASSWORD").all { !System.getenv(it).isNullOrBlank() }) { "Release signing configuration is incomplete." }
    require(providers.gradleProperty("ocheVersionCode").isPresent && providers.gradleProperty("ocheVersionName").isPresent) { "An explicit release version is required." }
}
android {
    namespace = "nl.dartflow.ochelive"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "nl.dartflow.ochelive"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.gradleProperty("ocheVersionCode").orElse("1018").get().toInt()
        versionName = providers.gradleProperty("ocheVersionName").orElse(releaseVersion.getProperty("versionName")).get()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
    }
    signingConfigs {
        create("upload") {
            val keyPath = System.getenv("ANDROID_UPLOAD_KEYSTORE_PATH")
            if (!keyPath.isNullOrBlank()) {
                storeFile = file(keyPath)
                storePassword = System.getenv("ANDROID_UPLOAD_STORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_UPLOAD_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_UPLOAD_KEY_PASSWORD")
            }
        }
    }
    flavorDimensions += "environment"
    productFlavors {
        create("production") {
            dimension = "environment"
            buildConfigField("String", "API_ORIGIN", "\"https://dartflow.nl\"")
            manifestPlaceholders["ocheHost"] = "dartflow.nl"
        }
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            resValue("string", "app_name", "Oche Live · Staging")
            buildConfigField("String", "API_ORIGIN", "\"https://staging.dartflow.nl\"")
            manifestPlaceholders["ocheHost"] = "staging.dartflow.nl"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (!System.getenv("ANDROID_UPLOAD_KEYSTORE_PATH").isNullOrBlank()) signingConfig = signingConfigs.getByName("upload")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions { unitTests.isReturnDefaultValues = true }
    sourceSets.getByName("test").resources.srcDir("../../../contracts/fixtures/oche-display-v1")
    lint { abortOnError = true; checkReleaseBuilds = true }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.09.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.google.zxing:core:3.5.3")
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
