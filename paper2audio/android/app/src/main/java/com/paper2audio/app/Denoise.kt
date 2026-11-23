package com.paper2audio.app

import android.content.Context
import com.k2fsa.sherpa.onnx.OfflineSpeechDenoiser
import com.k2fsa.sherpa.onnx.OfflineSpeechDenoiserConfig
import com.k2fsa.sherpa.onnx.OfflineSpeechDenoiserGtcrnModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeechDenoiserModelConfig
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Cleans up a voice recording before it is cloned: removes hum and rumble, then
 * background noise (GTCRN, a 0.5 MB speech-enhancement model run by sherpa-onnx).
 * Cloned voices made from noisy recordings come out as unintelligible mumbling;
 * cleaned ones read clearly.
 */
object Denoise {
    private const val MODEL_RATE = 16_000

    /** [x] at [rate] Hz with hum and background noise removed (same rate). Falls back to [x] if the model can't run. */
    fun speech(context: Context, x: FloatArray, rate: Int): FloatArray {
        val filtered = highPass(x, rate)
        return runCatching {
            val down = MyVoices.resample(lowPass(filtered, rate, 7_600.0), rate, MODEL_RATE)
            val denoiser = OfflineSpeechDenoiser(
                context.assets,
                OfflineSpeechDenoiserConfig(
                    model = OfflineSpeechDenoiserModelConfig(
                        gtcrn = OfflineSpeechDenoiserGtcrnModelConfig(model = "models/gtcrn_simple.onnx"),
                        numThreads = 2,
                    ),
                ),
            )
            try {
                val out = denoiser.run(down, MODEL_RATE)
                MyVoices.resample(out.samples, out.sampleRate, rate)
            } finally {
                denoiser.release()
            }
        }.getOrElse { filtered }
    }

    /** Background noise level relative to speech (0 = silent background; above ~0.12 is noticeably noisy). */
    fun noiseRatio(x: FloatArray, rate: Int = MyVoices.RATE): Float {
        val frame = rate / 50
        val n = x.size / frame
        if (n < 10) return 0f
        val energies = FloatArray(n) { f ->
            var s = 0.0
            for (i in f * frame until (f + 1) * frame) s += x[i] * x[i]
            sqrt(s / frame).toFloat()
        }.sorted()
        val speech = energies[(n * 0.9).toInt().coerceAtMost(n - 1)].coerceAtLeast(1e-5f)
        return energies[n / 10] / speech
    }

    /** Second-order Butterworth high-pass at 90 Hz: removes mains hum, rumble and DC offset. */
    internal fun highPass(x: FloatArray, rate: Int, cutoff: Double = 90.0): FloatArray {
        val w = 2 * PI * cutoff / rate
        val alpha = sin(w) / (2 * 0.7071)
        val c = cos(w)
        val a0 = 1 + alpha
        val b0 = (1 + c) / 2 / a0
        val b1 = -(1 + c) / a0
        val b2 = (1 + c) / 2 / a0
        val a1 = -2 * c / a0
        val a2 = (1 - alpha) / a0
        val out = FloatArray(x.size)
        var x1 = 0.0
        var x2 = 0.0
        var y1 = 0.0
        var y2 = 0.0
        for (i in x.indices) {
            val x0 = x[i].toDouble()
            val y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            out[i] = y0.toFloat()
            x2 = x1; x1 = x0
            y2 = y1; y1 = y0
        }
        return out
    }

    /** Windowed-sinc low-pass (31 taps), so downsampling doesn't fold high frequencies into speech. */
    internal fun lowPass(x: FloatArray, rate: Int, cutoff: Double, taps: Int = 31): FloatArray {
        val mid = (taps - 1) / 2.0
        val h = DoubleArray(taps) { i ->
            val m = i - mid
            val sinc = if (m == 0.0) 1.0 else sin(2 * PI * cutoff / rate * m) / (2 * PI * cutoff / rate * m)
            sinc * (0.54 - 0.46 * cos(2 * PI * i / (taps - 1)))
        }
        val sum = h.sum()
        for (i in h.indices) h[i] /= sum
        val half = taps / 2
        return FloatArray(x.size) { i ->
            var s = 0.0
            for (k in 0 until taps) {
                val j = i + k - half
                if (j >= 0 && j < x.size) s += h[k] * x[j]
            }
            s.toFloat()
        }
    }
}
