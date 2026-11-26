package com.paper2audio.app

import android.content.Context
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.sin

/**
 * Copied voices as bright (crisp) as the real voice. Some copies come out duller than the recording they
 * were copied from (Emma, Oscar: 5-6 dB short in 4.5-8 kHz, where consonants live; others match). Each
 * voice's recording is measured once, the copy's sentences as they are made (averaged), and the treble is
 * lifted by the difference, at most 6 dB; voices that already match are left as they are. Measured on the
 * readers: naturalness up for every voice it lifts, no added hiss.
 */
object Brightness {
    private val refTilt = HashMap<String, Double>()

    /** [x] (a sentence of copied voice [id], recording [ref]) with its treble matched to the real voice. */
    fun match(context: Context, id: String, ref: FloatArray, x: FloatArray, rate: Int): FloatArray {
        val want = synchronized(refTilt) { refTilt.getOrPut(id) { tilt(ref, rate) ?: Double.NaN } }
        if (want.isNaN()) return x
        val now = tilt(x, rate) ?: return x
        val prefs = context.getSharedPreferences("p2a", Context.MODE_PRIVATE)
        val old = prefs.getFloat("tilt:$id", Float.NaN)
        // The copy's usual brightness: averaged over its sentences (one sentence depends on its sounds).
        val usual = if (old.isNaN()) now else old * 0.85 + now * 0.15
        prefs.edit().putFloat("tilt:$id", usual.toFloat()).apply()
        val gain = (want - usual).coerceIn(0.0, 6.0)
        return if (gain < 0.5) x else Denoise.highShelf(x, rate, 4_500.0, gain)
    }

    /** Forgets what was learned about voice [id] (deleted, or a new recording). */
    fun forget(context: Context, id: String) {
        synchronized(refTilt) { refTilt.remove(id) }
        context.getSharedPreferences("p2a", Context.MODE_PRIVATE).edit().remove("tilt:$id").apply()
    }

    /** 4.5-8 kHz level relative to 0.5-2 kHz (dB) over the louder (speech) frames; null when too short. */
    internal fun tilt(x: FloatArray, rate: Int): Double? {
        val n = 1024
        val frames = (x.size - n) / 512
        if (frames < 4) return null
        val win = DoubleArray(n) { 0.5 - 0.5 * cos(2 * PI * it / (n - 1)) }
        val energy = DoubleArray(frames)
        for (f in 0 until frames) {
            var e = 0.0
            for (i in 0 until n) { val v = x[f * 512 + i] * win[i]; e += v * v }
            energy[f] = e
        }
        val floor = energy.sorted()[(frames * 0.4).toInt()]
        val power = DoubleArray(n / 2 + 1)
        val re = DoubleArray(n)
        val im = DoubleArray(n)
        var used = 0
        for (f in 0 until frames) {
            if (energy[f] <= floor) continue
            for (i in 0 until n) { re[i] = x[f * 512 + i] * win[i]; im[i] = 0.0 }
            fft(re, im)
            for (k in power.indices) power[k] += re[k] * re[k] + im[k] * im[k]
            used++
        }
        if (used == 0) return null
        fun band(lo: Double, hi: Double): Double {
            var s = 0.0
            var c = 0
            for (k in power.indices) {
                val hz = k * rate.toDouble() / n
                if (hz >= lo && hz < hi) { s += power[k]; c++ }
            }
            return if (c == 0) 0.0 else s / c
        }
        val high = band(4_500.0, 8_000.0)
        val mid = band(500.0, 2_000.0)
        if (high <= 0 || mid <= 0) return null
        return 10 * log10(high / mid)
    }

    /** In-place radix-2 FFT ([re].size a power of two). */
    private fun fft(re: DoubleArray, im: DoubleArray) {
        val n = re.size
        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) { j = j xor bit; bit = bit shr 1 }
            j = j xor bit
            if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
        }
        var len = 2
        while (len <= n) {
            val ang = -2 * PI / len
            val wr = cos(ang)
            val wi = sin(ang)
            var i = 0
            while (i < n) {
                var cr = 1.0
                var ci = 0.0
                for (k in 0 until len / 2) {
                    val a = i + k
                    val b = a + len / 2
                    val tr = re[b] * cr - im[b] * ci
                    val ti = re[b] * ci + im[b] * cr
                    re[b] = re[a] - tr; im[b] = im[a] - ti
                    re[a] += tr; im[a] += ti
                    val nr = cr * wr - ci * wi
                    ci = cr * wi + ci * wr
                    cr = nr
                }
                i += len
            }
            len = len shl 1
        }
    }
}
