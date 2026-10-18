package com.paper2audio.app

/**
 * The v2 Sec-MS-GEC token the online voice service has required since about 10 October 2026
 * (it answers the old plain SHA-256 token with HTTP 403). "<16 hex>-<64 hex>": a CS64 digest and
 * a SHA-256 variant with its own starting state, of the same text as before (Windows file-time
 * ticks, rounded down to 5 minutes, then the client token). Ported from edge-tts 7.3.0 (drm.py).
 */
internal object EdgeGec {
    private val INITIAL = intArrayOf(
        0x6A09E667, 0xBB67AE85.toInt(), 0x3C6EF372, 0xA54FF53A.toInt(),
        0x510E527F, 0x9B05688C.toInt(), 0x1F83D9AB, 0x5BE0CD19,
    )
    private val STATE = intArrayOf(
        0xFD9FBEA2.toInt(), 0x91243CE7.toInt(), 0xBE499094.toInt(), 0xCD2E1E0A.toInt(),
        0x6C006F49, 0x04BD35AB, 0xFEB0A7E4.toInt(), 0x03EFFBD2,
    )
    private val SCHEDULE = intArrayOf(
        0xEB24BF9E.toInt(), 0x1558691F, 0xA0C09EE2.toInt(), 0x0CFA32BA, 0xA622EE8C.toInt(),
        0xD1DD9491.toInt(), 0xC0DD25A0.toInt(), 0xF9E70AB6.toInt(), 0xF0C31573.toInt(), 0x7058CE4E,
        0x7188E606, 0x00E5AB33, 0xD258B060.toInt(), 0x72766564,
    )
    private val K = longArrayOf(
        0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
        0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
        0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
        0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
        0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
        0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
        0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
        0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
    ).map { it.toInt() }.toIntArray()
    private const val ADJUSTMENT = 0xC9DC06A7.toInt()
    private val BLOCK_K = K.copyOf().also { it[14] = ADJUSTMENT }
    private const val SIGMA0_ADJUSTMENT = 0x059C0B80
    private const val SIGMA1_ADJUSTMENT = 0x000B92C0

    private val CS64 = arrayOf(
        0xE82E91B1 to 0xB32700D0, 0x44DE24C6 to 0x88DFF51D, 0x3BEB65BC to 0x29514038,
        0xC89C5933 to 0xB328CBDF, 0x8D1EC211 to 0xD405B4D5, 0x314EF5D5 to 0x26E55F3C,
        0xE92491B1 to 0x607801C6, 0xF0A5B9D5 to 0x82B2C1FB, 0x06064CF3 to 0xFA51A3DA,
        0xDA79FA60 to 0x207CC464, 0xBED20560 to 0x3C3C74F3, 0x89F9C9F8 to 0xD2D14B61,
        0x35FA38C6 to 0xBB04A2C1, 0xCB49E3C6 to 0xC5626167,
    ).map { (a, b) -> a.toInt() to b.toInt() }
    private const val CS64_FACTOR = 0x82893933.toInt()
    private const val CS64_ADJUSTMENT0 = 0xF2F90B1A.toInt()
    private const val CS64_ADJUSTMENT1 = 0x0B1A0000

    private fun rol16(v: Int) = Integer.rotateLeft(v, 16)
    private fun sigma0(x: Int) = Integer.rotateRight(x, 7) xor Integer.rotateRight(x, 18) xor (x ushr 3)
    private fun sigma1(x: Int) = Integer.rotateRight(x, 17) xor Integer.rotateRight(x, 19) xor (x ushr 10)

    private fun expand(w: IntArray, from: Int) {
        for (i in from until 64) w[i] = sigma1(w[i - 2]) + w[i - 7] + sigma0(w[i - 15]) + w[i - 16]
    }

    /** SHA-256 rounds [first]..63 on [state] (the first block's 14th constant is adjusted when resuming at 14). */
    private fun rounds(state: IntArray, w: IntArray, first: Int): IntArray {
        val k = if (first == 14) BLOCK_K else K
        var a = state[0]; var b = state[1]; var c = state[2]; var d = state[3]
        var e = state[4]; var f = state[5]; var g = state[6]; var h = state[7]
        for (i in first until 64) {
            val s1 = Integer.rotateRight(e, 6) xor Integer.rotateRight(e, 11) xor Integer.rotateRight(e, 25)
            val t1 = h + s1 + (g xor (e and (f xor g))) + k[i] + w[i]
            val s0 = Integer.rotateRight(a, 2) xor Integer.rotateRight(a, 13) xor Integer.rotateRight(a, 22)
            val t2 = s0 + ((a and b) or (c and (a or b)))
            h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2
        }
        return intArrayOf(a, b, c, d, e, f, g, h)
    }

    private fun be(bytes: ByteArray, from: Int, n: Int): Int {
        var v = 0
        for (i in from until from + n) v = (v shl 8) or (bytes[i].toInt() and 0xff)
        return v
    }

    /** The starting state from the first seven bytes. */
    private fun init(data: ByteArray): IntArray {
        val w = IntArray(64)
        w[14] = be(data, 0, 3)
        w[15] = be(data, 3, 4)
        for (i in 16..29) {
            var v = SCHEDULE[i - 16]
            if (i - 2 >= 14) v += if (i == 16) sigma1(w[i - 2]) xor SIGMA1_ADJUSTMENT else sigma1(w[i - 2])
            if (i - 7 >= 14) v += w[i - 7]
            if (i - 15 >= 14) v += if (i == 29) sigma0(w[i - 15]) xor SIGMA0_ADJUSTMENT else sigma0(w[i - 15])
            w[i] = v
        }
        w[30] = sigma1(w[28]) + w[23] + sigma0(w[15]) + w[14] + ADJUSTMENT - K[14]
        expand(w, 31)
        val working = rounds(STATE, w, 14)
        return IntArray(8) { INITIAL[it] + working[it] }
    }

    internal fun sha256(data: ByteArray): ByteArray {
        require(data.size >= 7)
        val length = 57 + data.size
        val zeros = Math.floorMod(55 - length, 64)
        val body = java.io.ByteArrayOutputStream().apply {
            write(data, 7, data.size - 7)
            write(0x80)
            write(ByteArray(zeros))
            write(java.nio.ByteBuffer.allocate(8).putLong(length * 8L).array())
        }.toByteArray()
        var state = init(data)
        for (off in body.indices step 64) {
            val w = IntArray(64)
            for (i in 0 until 16) w[i] = be(body, off + 4 * i, 4)
            expand(w, 16)
            val working = rounds(state, w, 0)
            state = IntArray(8) { state[it] + working[it] }
        }
        val out = java.nio.ByteBuffer.allocate(32)
        state.forEach { out.putInt(it) }
        return out.array()
    }

    internal fun cs64(data: ByteArray, digest: ByteArray): Pair<Int, Int> {
        val le = java.nio.ByteBuffer.wrap(digest).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        val keyA = le.getInt(0) or 1
        val keyB = le.getInt(4) or 1
        val factors = intArrayOf(keyA * CS64_FACTOR, keyB * CS64_FACTOR)
        val terms = ArrayList<Int>()
        val offsets = ArrayList<Int>()
        CS64.forEachIndexed { i, (coef, offset) -> terms += coef * factors[i % 2]; offsets += offset }
        // Little-endian words of a zero byte and the data, zero-padded to an even number of words.
        val bytes = byteArrayOf(0) + data
        val padded = bytes.copyOf(bytes.size + Math.floorMod(-bytes.size, 4))
        val buf = java.nio.ByteBuffer.wrap(padded).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        val words = IntArray(padded.size / 4) { buf.getInt(4 * it) }.toMutableList()
        if (words.size % 2 == 1) words += 0
        for ((i, word) in words.withIndex()) {
            var term = word * (if (i % 2 == 0) keyA else keyB)
            var offset = rol16(word) * (if (i % 2 == 0) 0xEF0569FB.toInt() else 0xC31713DB.toInt())
            if (i == 0) {
                term += CS64_ADJUSTMENT0 * factors[0]
                offset += CS64_ADJUSTMENT1
            }
            terms += term
            offsets += offset
        }
        var swapAcc = 0
        var swapLast = 0
        var state = 0
        var acc = 0
        for (i in terms.indices step 2) {
            val x = terms[i]
            val y = terms[i + 1]
            var t = rol16(offsets[i] + x)
            var q = t * 0x76F50F34
            swapAcc += rol16(q) * 0xC3EFEA97.toInt() + q
            t = rol16(offsets[i + 1] + y)
            q = t * 0x1881CE3C
            swapLast = rol16(q) * 0x35BD1EC9 + q
            swapAcc += swapLast

            state = state * keyA + x
            state = rol16(state) * 0xCF98B111.toInt()
            state = rol16(state) * 0x87085B9F.toInt()
            state = rol16(state) * 0x12CEB96D
            state = rol16(state) * 0x257E1D83
            acc += state
            t = state * keyB + y
            t = rol16(t) * 0xA27416F5.toInt()
            t = rol16(t) * 0xD38396FF.toInt()
            state = rol16(rol16(t) * 0x7C932B89) * 0xBFA49F69.toInt()
            acc += state
        }
        return (swapLast xor state) to (swapAcc xor acc)
    }

    /** The token for [ticks] (Windows file time, already rounded down to 5 minutes) and [clientToken]. */
    fun token(ticks: Long, clientToken: String): String {
        val data = "$ticks$clientToken".toByteArray(Charsets.US_ASCII)
        val digest = sha256(data)
        val (a, b) = cs64(data, digest)
        val cs = java.nio.ByteBuffer.allocate(8).order(java.nio.ByteOrder.LITTLE_ENDIAN).putInt(a).putInt(b).array()
        fun hex(x: ByteArray) = x.joinToString("") { "%02X".format(it) }
        return "${hex(cs)}-${hex(digest)}"
    }
}
