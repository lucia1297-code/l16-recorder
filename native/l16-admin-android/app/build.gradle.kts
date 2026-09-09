plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

android { namespace = "com.l16.admin"; compileSdk = 35
    defaultConfig { applicationId = "com.l16.admin"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.1.0" }
    buildFeatures { viewBinding = true; buildConfig = true }
    buildTypes {
        getByName("debug") {
            val url = project.findProperty("SUPABASE_URL")?.toString() ?: ""
            val key = project.findProperty("SUPABASE_ANON_KEY")?.toString() ?: ""
            buildConfigField("String", "SUPABASE_URL", "\"$url\"")
            buildConfigField("String", "SUPABASE_ANON_KEY", "\"$key\"")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
}
