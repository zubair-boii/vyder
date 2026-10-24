package com.zubairkhan.vyder

import android.Manifest
import android.app.Activity
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.ConcurrentHashMap

@InvokeArg
class EngineUrlArgs {
    var url: String = ""
}

@InvokeArg
class EngineIdArgs {
    var id: String = ""
}

@InvokeArg
class EngineStartArgs {
    var id: String = ""
    var url: String = ""
    var title: String = ""
    var quality: String = "1080"
    var format: String = "mp4"
    var audioOnly: Boolean = false
    var outputDir: String = ""
    var filenameTemplate: String = "%(title)s.%(ext)s"
    var embedMetadata: Boolean = true
    var embedThumbnail: Boolean = false
    var sponsorblock: Boolean = false
    var notifications: Boolean = true
}

@InvokeArg
class EnginePathArgs {
    var path: String = ""
}

@TauriPlugin
class EnginePlugin(private val activity: Activity) : Plugin(activity) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val cancelled = ConcurrentHashMap.newKeySet<String>()

    @Volatile
    private var ready = false

    @Synchronized
    private fun ensureReady() {
        if (ready) return
        val context = activity.applicationContext
        Log.i(TAG, "initializing youtubedl-android runtime")
        YoutubeDL.getInstance().init(context)
        Log.i(TAG, "initializing ffmpeg runtime")
        FFmpeg.getInstance().init(context)
        ready = true
        Log.i(TAG, "download engine ready")
    }

    @Command
    fun inspect(invoke: Invoke) {
        val args = invoke.parseArgs(EngineUrlArgs::class.java)
        scope.launch {
            try {
                ensureReady()
                val request = YoutubeDLRequest(args.url)
                request.addOption("--dump-json")
                request.addOption("--no-playlist")
                request.addOption("--no-warnings")
                request.addOption("--socket-timeout", "20")
                val response = YoutubeDL.getInstance().execute(request)
                val json = response.out.trim()
                if (json.isEmpty()) {
                    throw IllegalStateException("No media was found at that link.")
                }
                val result = JSObject()
                result.put("json", json)
                invoke.resolve(result)
            } catch (error: Throwable) {
                Log.e(TAG, "inspect failed", error)
                invoke.reject(friendlyError(error))
            }
        }
    }

    @Command
    fun startDownload(invoke: Invoke) {
        val args = invoke.parseArgs(EngineStartArgs::class.java)
        val id = args.id
        val appContext = activity.applicationContext
        // Start the foreground service before the engine extracts Python or
        // FFmpeg. If the user backgrounds the app during that first-run setup,
        // Android must not kill the process halfway through.
        DownloadService.start(appContext, id, args.title)
        if (args.notifications) requestNotificationPermission()
        scope.launch {
            try {
                ensureReady()
                if (cancelled.remove(id)) {
                    invoke.reject("cancelled")
                    return@launch
                }

                val outputDir = File(args.outputDir)
                if (!outputDir.exists() && !outputDir.mkdirs()) {
                    throw IllegalStateException("Could not create the download folder.")
                }

                val template = args.filenameTemplate
                    .takeIf { it.isNotBlank() }
                    ?: "%(title)s.%(ext)s"
                val finalPathFile = File(activity.cacheDir, "last-$id.path")
                finalPathFile.delete()

                val request = YoutubeDLRequest(args.url)
                request.addOption("--no-playlist")
                request.addOption("--continue")
                request.addOption("--newline")
                request.addOption("--progress")
                request.addOption("--no-simulate")
                request.addOption("--no-warnings")
                request.addOption("--socket-timeout", "20")
                request.addOption("-o", File(outputDir, template).absolutePath)
                request.addCommands(
                    listOf(
                        "--print-to-file",
                        "after_move:filepath",
                        finalPathFile.absolutePath,
                    )
                )

                if (args.audioOnly) {
                    request.addOption("-f", "ba/b")
                    request.addOption("-x")
                    request.addOption("--audio-format", audioCodec(args.format))
                    request.addOption("--audio-quality", "0")
                } else {
                    request.addOption("-f", qualityFilter(args.quality))
                    request.addOption("--merge-output-format", if (args.format == "mkv") "mkv" else "mp4")
                }

                if (args.embedMetadata) request.addOption("--embed-metadata")
                if (args.embedThumbnail) {
                    request.addOption("--embed-thumbnail")
                    request.addOption("--convert-thumbnails", "jpg")
                }
                if (args.sponsorblock && !args.audioOnly) {
                    request.addOption("--sponsorblock-remove", "sponsor")
                }

                var lastEmit = 0L
                var lastNotify = 0L
                var lastPercent = -1.0
                val startedAt = System.currentTimeMillis()
                val response = YoutubeDL.getInstance().execute(request, id) { percent, eta, line ->
                    val current = if (percent >= 0f) percent.toDouble() else percentFromLine(line)
                    if (current >= 0) {
                        val total = bytesIn(line, sizePattern)
                        val speed = bytesIn(line, speedPattern)
                        val downloaded = if (total > 0) (total * (current / 100.0)).toLong() else 0L
                        val now = SystemClock.elapsedRealtime()
                        val stage = if (current >= 99.9) "processing" else "downloading"
                        if (now - lastEmit >= 180 || (stage == "processing" && lastPercent < 99.9)) {
                            lastEmit = now
                            lastPercent = current
                            runCatching {
                                EngineNative.progress(
                                    id,
                                    downloaded,
                                    total,
                                    speed.toDouble(),
                                    eta.coerceAtLeast(0).toDouble(),
                                    current,
                                    stage,
                                )
                            }
                            if (now - lastNotify >= 1000 || stage == "processing") {
                                lastNotify = now
                                DownloadService.progress(appContext, id, args.title, current)
                            }
                        }
                    }
                }

                if (cancelled.remove(id)) {
                    invoke.reject("cancelled")
                    return@launch
                }

                val path = readFinalPath(finalPathFile)
                    ?: newestFile(outputDir, startedAt)
                if (path.isNullOrBlank()) {
                    val message = response.err
                        .lineSequence()
                        .lastOrNull { it.contains("ERROR", ignoreCase = true) }
                        ?.trim()
                        ?: "The download finished without a file."
                    runCatching { EngineNative.failed(id, cleanError(message)) }
                    invoke.reject(cleanError(message))
                    return@launch
                }

                runCatching { EngineNative.done(id, path) }
                val result = JSObject()
                result.put("path", path)
                invoke.resolve(result)
            } catch (error: YoutubeDL.CanceledException) {
                cancelled.remove(id)
                invoke.reject("cancelled")
            } catch (error: Throwable) {
                val wasCancelled = cancelled.remove(id)
                if (!wasCancelled) {
                    Log.e(TAG, "download $id failed", error)
                    val message = friendlyError(error)
                    runCatching { EngineNative.failed(id, message) }
                    invoke.reject(message)
                } else {
                    invoke.reject("cancelled")
                }
            } finally {
                DownloadService.stop(appContext, id)
            }
        }
    }

    @Command
    fun readClipboard(invoke: Invoke) {
        try {
            val manager = activity.getSystemService(ClipboardManager::class.java)
            val clip = manager?.primaryClip
            val text = if (clip != null && clip.itemCount > 0) {
                clip.getItemAt(0).coerceToText(activity).toString()
            } else {
                ""
            }
            val result = JSObject()
            result.put("text", text)
            invoke.resolve(result)
        } catch (error: Throwable) {
            Log.e(TAG, "readClipboard failed", error)
            invoke.reject(friendlyError(error))
        }
    }

    @Command
    fun cancelDownload(invoke: Invoke) {
        val args = invoke.parseArgs(EngineIdArgs::class.java)
        cancelled.add(args.id)
        val stopped = runCatching {
            YoutubeDL.getInstance().destroyProcessById(args.id)
        }.getOrDefault(false)
        DownloadService.stop(activity.applicationContext, args.id)
        val result = JSObject()
        result.put("cancelled", stopped)
        invoke.resolve(result)
    }

    @Command
    fun openFile(invoke: Invoke) {
        val args = invoke.parseArgs(EnginePathArgs::class.java)
        try {
            val file = File(args.path)
            if (!file.exists()) {
                invoke.reject("That file is no longer on disk.")
                return
            }
            val uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                file,
            )
            val mime = MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(file.extension.lowercase())
                ?: "application/octet-stream"
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.startActivity(Intent.createChooser(intent, "Open with"))
            invoke.resolve(JSObject())
        } catch (error: Throwable) {
            Log.e(TAG, "openFile failed for ${args.path}", error)
            invoke.reject(friendlyError(error))
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        activity.runOnUiThread {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_REQUEST,
            )
        }
    }

    private fun qualityFilter(quality: String): String = when (quality) {
        "2160" -> "bv*[height<=2160]+ba/b[height<=2160]/b"
        "1440" -> "bv*[height<=1440]+ba/b[height<=1440]/b"
        "1080" -> "bv*[height<=1080]+ba/b[height<=1080]/b"
        "720" -> "bv*[height<=720]+ba/b[height<=720]/b"
        "480" -> "bv*[height<=480]+ba/b[height<=480]/b"
        "360" -> "bv*[height<=360]+ba/b[height<=360]/b"
        else -> "bv*+ba/b"
    }

    private fun audioCodec(format: String): String =
        when (format) {
            "m4a", "mp3", "wav", "opus" -> format
            else -> "mp3"
        }

    private fun readFinalPath(file: File): String? {
        if (!file.exists()) return null
        return file.readText()
            .lineSequence()
            .map { it.trim() }
            .lastOrNull { it.isNotEmpty() }
    }

    private fun newestFile(dir: File, startedAt: Long): String? =
        dir.listFiles()
            ?.filter { file ->
                file.isFile &&
                    file.lastModified() >= startedAt - 5_000 &&
                    !file.name.endsWith(".part", ignoreCase = true) &&
                    !file.name.endsWith(".ytdl", ignoreCase = true) &&
                    file.extension.lowercase() !in setOf(
                        "jpg", "jpeg", "png", "webp", "vtt", "srt", "ass", "json",
                    )
            }
            ?.maxByOrNull { it.lastModified() }
            ?.absolutePath

    private fun percentFromLine(line: String): Double =
        percentPattern.find(line)?.groupValues?.getOrNull(1)?.toDoubleOrNull() ?: -1.0

    private fun bytesIn(line: String, pattern: Regex): Long {
        val match = pattern.find(line) ?: return 0
        val value = match.groupValues.getOrNull(1)?.toDoubleOrNull() ?: return 0
        val unit = match.groupValues.getOrNull(2)?.uppercase().orEmpty()
        val multiplier = when (unit) {
            "K" -> 1024.0
            "M" -> 1024.0 * 1024.0
            "G" -> 1024.0 * 1024.0 * 1024.0
            "T" -> 1024.0 * 1024.0 * 1024.0 * 1024.0
            else -> 1.0
        }
        return (value * multiplier).toLong()
    }

    private fun friendlyError(error: Throwable): String {
        val raw = error.message?.trim().orEmpty()
        if (raw.isEmpty()) return "The download engine reported an error."
        val line = raw.lineSequence().lastOrNull { it.contains("ERROR", ignoreCase = true) }
            ?: raw.lineSequence().lastOrNull { it.isNotBlank() }
            ?: raw
        return cleanError(line)
    }

    private fun cleanError(value: String): String =
        value.replace("ERROR:", "")
            .replace("ERROR: ", "")
            .trim()
            .take(500)
            .ifEmpty { "The download engine reported an error." }

    private companion object {
        const val TAG = "VyderEngine"
        const val NOTIFICATION_REQUEST = 7302
        val percentPattern = Regex("""(\d+(?:\.\d+)?)%""")
        val sizePattern = Regex("""of\s+~?\s*([\d.]+)\s*([KMGT])?iB""", RegexOption.IGNORE_CASE)
        val speedPattern = Regex("""at\s+([\d.]+)\s*([KMGT])?iB/s""", RegexOption.IGNORE_CASE)
    }
}
