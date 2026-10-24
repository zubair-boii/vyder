package com.zubairkhan.vyder

import androidx.annotation.Keep

/**
 * Small JNI surface used by the Kotlin engine adapter. The Rust side owns the
 * queue, the library and the event bus, so the native downloader only needs to
 * report progress and the final file path.
 */
@Keep
object EngineNative {
    init {
        runCatching { System.loadLibrary("vyder_lib") }
    }

    @JvmStatic external fun progress(
        id: String,
        downloaded: Long,
        total: Long,
        speed: Double,
        eta: Double,
        percent: Double,
        stage: String,
    )

    @JvmStatic external fun done(id: String, path: String)

    @JvmStatic external fun failed(id: String, message: String)
}
