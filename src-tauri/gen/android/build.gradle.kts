buildscript {
    repositories {
        google()
        mavenCentral()
        // Mirrors kept as a fallback for networks where the official
        // repositories are slow or unavailable.
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/central") }
        maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.3.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
    }
}

allprojects {
    repositories {
        val localAndroidRepo = System.getenv("VYDER_ANDROID_M2")
        if (!localAndroidRepo.isNullOrBlank()) {
            maven { url = uri(localAndroidRepo) }
        }
        google()
        mavenCentral()
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/central") }
        maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
    }
}

tasks.register("clean").configure {
    delete("build")
}

