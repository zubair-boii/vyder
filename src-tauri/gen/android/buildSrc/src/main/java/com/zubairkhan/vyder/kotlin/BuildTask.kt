import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import javax.inject.Inject
import org.gradle.process.ExecOperations

abstract class BuildTask : DefaultTask() {
    @get:Inject
    abstract val execOperations: ExecOperations

    @Input
    var rootDirRel: String? = null
    @Input
    var projectDir: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val executable = """pnpm""";
        val startedAt = System.currentTimeMillis();
        if (System.getenv("VYDER_ANDROID_PREBUILT") == "1") {
            if (copyBuiltLibrary(startedAt, null, force = true)) {
                logger.lifecycle("Using the prebuilt libvyder_lib.so from the Cargo target directory.")
                return
            }
            throw GradleException("VYDER_ANDROID_PREBUILT is set, but libvyder_lib.so was not found.")
        }
        try {
            runTauriCli(executable)
        } catch (e: Exception) {
            // Windows refuses to create symlinks unless Developer Mode is on.
            // The Tauri CLI has already compiled the library by the time the
            // link step fails, so copy it into jniLibs ourselves and continue.
            if (copyBuiltLibrary(startedAt, e)) {
                logger.warn("Symlink creation is unavailable; copied libvyder_lib.so into jniLibs instead.")
                return
            }
            if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                // Try different Windows-specific extensions
                val fallbacks = listOf(
                    "$executable.exe",
                    "$executable.cmd",
                    "$executable.bat",
                )

                var lastException: Exception = e
                for (fallback in fallbacks) {
                    try {
                        runTauriCli(fallback)
                        return
                    } catch (fallbackException: Exception) {
                        lastException = fallbackException
                    }
                }
                throw lastException
            } else {
                throw e;
            }
        }
    }

    fun copyBuiltLibrary(startedAt: Long, cause: Exception?, force: Boolean = false): Boolean {
        val appDir = projectDir ?: return false
        val rootRel = rootDirRel ?: return false
        val targetName = target ?: return false
        val triple = when (targetName) {
            "aarch64" -> "aarch64-linux-android"
            "armv7" -> "armv7-linux-androideabi"
            "i686" -> "i686-linux-android"
            "x86_64" -> "x86_64-linux-android"
            else -> return false
        }
        val abi = when (targetName) {
            "aarch64" -> "arm64-v8a"
            "armv7" -> "armeabi-v7a"
            "i686" -> "x86"
            "x86_64" -> "x86_64"
            else -> return false
        }
        val profile = if (release == true) "release" else "debug"
        val root = File(appDir, rootRel)
        val source = listOf(
            File(root, "src-tauri/target/$triple/$profile/libvyder_lib.so"),
            File(root, "target/$triple/$profile/libvyder_lib.so"),
            File(root.parentFile, "src-tauri/target/$triple/$profile/libvyder_lib.so"),
        ).firstOrNull { it.isFile && it.length() > 0 }
            ?: return false
        val symlinkFailure = cause.message
            ?.contains("symbolic link", ignoreCase = true) == true
        if (!source.isFile || source.length() == 0L) {
            return false
        }
        if (!force && !symlinkFailure && source.lastModified() < startedAt - 5_000) {
            return false
        }
        val destination = File(appDir, "src/main/jniLibs/$abi/libvyder_lib.so")
        return try {
            destination.parentFile?.mkdirs()
            source.copyTo(destination, overwrite = true)
            true
        } catch (error: Exception) {
            logger.error("Failed to copy the Android library: ${error.message}")
            false
        }
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = listOf("run", "--", "tauri", "android", "android-studio-script");

        execOperations.exec {
            workingDir(File(projectDir, rootDirRel))
            executable(executable)
            args(args)
            if (logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}