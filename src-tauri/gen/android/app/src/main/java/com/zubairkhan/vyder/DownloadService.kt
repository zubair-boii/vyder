package com.zubairkhan.vyder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.ConcurrentHashMap

/**
 * Keeps the process alive while a native yt-dlp transfer is running.
 *
 * The download itself still lives in [EnginePlugin]; this service only owns the
 * foreground notification and the "there is work in progress" lifecycle. That
 * is enough for Android to stop killing the WebView/engine process when the
 * user switches apps or locks the screen.
 */
class DownloadService : Service() {
    override fun onCreate() {
        super.onCreate()
        createChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createChannel(this)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        } else {
            0
        }
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(this),
            type,
        )
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "vyder-downloads"
        private const val NOTIFICATION_ID = 7301

        private data class Entry(val title: String, val percent: Double)

        private val active = ConcurrentHashMap<String, Entry>()

        fun start(context: Context, id: String, title: String) {
            active[id] = Entry(title.ifBlank { "Vyder download" }, 0.0)
            createChannel(context)
            runCatching {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, DownloadService::class.java),
                )
            }
            notify(context)
        }

        fun progress(context: Context, id: String, title: String, percent: Double) {
            val current = active[id] ?: Entry(title.ifBlank { "Vyder download" }, 0.0)
            active[id] = current.copy(
                title = title.ifBlank { current.title },
                percent = percent.coerceIn(0.0, 100.0),
            )
            notify(context)
        }

        fun stop(context: Context, id: String) {
            active.remove(id)
            if (active.isEmpty()) {
                context.stopService(Intent(context, DownloadService::class.java))
                runCatching {
                    context.getSystemService(NotificationManager::class.java)
                        ?.cancel(NOTIFICATION_ID)
                }
            } else {
                notify(context)
            }
        }

        private fun notify(context: Context) {
            if (active.isEmpty()) return
            createChannel(context)
            runCatching {
                context.getSystemService(NotificationManager::class.java)
                    ?.notify(NOTIFICATION_ID, buildNotification(context))
            }
        }

        private fun createChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Downloads",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Progress for active Vyder downloads"
                setShowBadge(false)
            }
            manager.createNotificationChannel(channel)
        }

        private fun buildNotification(context: Context): Notification {
            val entries = active.values.toList()
            val count = entries.size
            val first = entries.firstOrNull()
            val percent = when {
                count == 1 -> first?.percent ?: 0.0
                entries.isEmpty() -> 0.0
                else -> entries.map { it.percent }.average()
            }
            val title = when {
                count > 1 -> "Downloading $count items"
                first != null -> first.title
                else -> "Downloading"
            }
            val text = when {
                count > 1 -> "${percent.toInt()}% · Vyder"
                first != null && first.percent > 0 -> "${first.percent.toInt()}% · Vyder"
                else -> "Starting download…"
            }
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            return NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_vyder)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(pending)
                .setColor(0xFF1ED760.toInt())
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setProgress(100, percent.toInt().coerceIn(0, 100), percent <= 0.0)
                .build()
        }
    }
}
