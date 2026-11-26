import Foundation

/// Copied voices as crisp as the real voice (Android's Brightness.kt): the treble (4.5-8 kHz, relative to
/// 0.5-2 kHz) of each reader's recording is measured once, the copy's averaged over its sentences, and a
/// copy that comes out duller is lifted by the difference (at most 6 dB). Voices that match are untouched.
enum Brightness {
    private static var want: [String: Double] = [:]
    private static var usual: [String: Double] = [:]
    private static let lock = NSLock()

    static func match(id: String, ref: [Float], _ x: [Float], rate: Int) -> [Float] {
        lock.lock()
        if want[id] == nil { want[id] = tilt(ref, rate: rate) ?? .nan }
        let target = want[id]!
        lock.unlock()
        guard !target.isNaN, let now = tilt(x, rate: rate) else { return x }
        lock.lock()
        let avg = usual[id].map { $0 * 0.85 + now * 0.15 } ?? now
        usual[id] = avg
        lock.unlock()
        let gain = min(6, max(0, target - avg))
        return gain < 0.5 ? x : highShelf(x, rate: rate, cutoff: 4_500, gainDb: gain)
    }

    static func tilt(_ x: [Float], rate: Int) -> Double? {
        let n = 1024
        let frames = (x.count - n) / 512
        if frames < 4 { return nil }
        let win = (0..<n).map { 0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(n - 1)) }
        var energy = [Double](repeating: 0, count: frames)
        for f in 0..<frames {
            var e = 0.0
            for i in 0..<n { let v = Double(x[f * 512 + i]) * win[i]; e += v * v }
            energy[f] = e
        }
        let floor = energy.sorted()[Int(Double(frames) * 0.4)]
        var power = [Double](repeating: 0, count: n / 2 + 1)
        var re = [Double](repeating: 0, count: n), im = [Double](repeating: 0, count: n)
        var used = 0
        for f in 0..<frames where energy[f] > floor {
            for i in 0..<n { re[i] = Double(x[f * 512 + i]) * win[i]; im[i] = 0 }
            fft(&re, &im)
            for k in 0..<power.count { power[k] += re[k] * re[k] + im[k] * im[k] }
            used += 1
        }
        if used == 0 { return nil }
        func band(_ lo: Double, _ hi: Double) -> Double {
            var s = 0.0, c = 0
            for k in 0..<power.count {
                let hz = Double(k) * Double(rate) / Double(n)
                if hz >= lo && hz < hi { s += power[k]; c += 1 }
            }
            return c == 0 ? 0 : s / Double(c)
        }
        let high = band(4_500, 8_000), mid = band(500, 2_000)
        if high <= 0 || mid <= 0 { return nil }
        return 10 * log10(high / mid)
    }

    private static func fft(_ re: inout [Double], _ im: inout [Double]) {
        let n = re.count
        var j = 0
        for i in 1..<n {
            var bit = n >> 1
            while j & bit != 0 { j ^= bit; bit >>= 1 }
            j ^= bit
            if i < j { re.swapAt(i, j); im.swapAt(i, j) }
        }
        var len = 2
        while len <= n {
            let ang = -2 * Double.pi / Double(len)
            let wr = cos(ang), wi = sin(ang)
            var i = 0
            while i < n {
                var cr = 1.0, ci = 0.0
                for k in 0..<(len / 2) {
                    let a = i + k, b = a + len / 2
                    let tr = re[b] * cr - im[b] * ci
                    let ti = re[b] * ci + im[b] * cr
                    re[b] = re[a] - tr; im[b] = im[a] - ti
                    re[a] += tr; im[a] += ti
                    let nr = cr * wr - ci * wi
                    ci = cr * wi + ci * wr
                    cr = nr
                }
                i += len
            }
            len <<= 1
        }
    }

    /// High shelf (RBJ biquad): +[gainDb] above [cutoff]. Never clips.
    static func highShelf(_ x: [Float], rate: Int, cutoff: Double, gainDb: Double) -> [Float] {
        let a = pow(10.0, gainDb / 40)
        let w = 2 * Double.pi * cutoff / Double(rate)
        let c = cos(w)
        let s = 2 * sqrt(a) * sin(w) / (2 * 0.7071)
        let a0 = (a + 1) - (a - 1) * c + s
        let b0 = a * ((a + 1) + (a - 1) * c + s) / a0
        let b1 = -2 * a * ((a - 1) + (a + 1) * c) / a0
        let b2 = a * ((a + 1) + (a - 1) * c - s) / a0
        let a1 = 2 * ((a - 1) - (a + 1) * c) / a0
        let a2 = ((a + 1) - (a - 1) * c - s) / a0
        var y = x
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
        var peak: Float = 0
        for i in 0..<y.count {
            let xi = Double(x[i])
            let yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = xi; y2 = y1; y1 = yi
            y[i] = Float(yi)
            peak = max(peak, abs(y[i]))
        }
        if peak > 0.99 { for i in 0..<y.count { y[i] *= 0.99 / peak } }
        return y
    }
}
