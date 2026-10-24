# JNI entry points and Tauri command annotations are looked up reflectively.
-keepattributes *Annotation*
-keep class com.zubairkhan.vyder.EngineNative { *; }
-keep class com.zubairkhan.vyder.EnginePlugin { *; }
-keep class com.zubairkhan.vyder.DownloadService { *; }
-keep class com.zubairkhan.vyder.Engine*Args { *; }

# youtubedl-android uses reflection while loading its Python runtime.
-keep class com.yausername.** { *; }
-dontwarn com.yausername.**

# ZipUtils reflects over Apache Commons Compress extra-field classes while
# unpacking Python/FFmpeg. R8 must not merge or abstract them.
-keep class org.apache.commons.compress.** { *; }
-keep class org.apache.commons.io.** { *; }
-dontwarn org.apache.commons.compress.**
-dontwarn org.apache.commons.io.**
