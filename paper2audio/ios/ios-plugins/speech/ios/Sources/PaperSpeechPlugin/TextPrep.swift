import Foundation

/// Text for the voices, as the Android app prepares it (TextCleaner.kt, Speech.kt, CloneCheck.prepareText).
enum TextPrep {
    private static func re(_ p: String, _ o: NSRegularExpression.Options = []) -> NSRegularExpression {
        // The patterns are fixed: a mistake in one is a programming error.
        return try! NSRegularExpression(pattern: p, options: o)
    }

    private static func replace(_ s: String, _ r: NSRegularExpression, _ with: String) -> String {
        r.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: with)
    }

    private static func matches(_ s: String, _ r: NSRegularExpression) -> Bool {
        r.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    private static let sentenceBreak = re("(?<=[.!?])\\s+")
    private static let noBreakAfter = re("(?:\\b(?:fig|figs|eq|eqs|tab|ref|refs|vol|no|nos|pp|p|ch|sec|dr|mr|mrs|ms|prof|st|vs|approx|ca|cf|al|etc|resp|dept|univ|jr|sr|inc|ltd|co|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|e\\.g|i\\.e)\\.|\\b[A-Z]\\.)$", [.caseInsensitive])

    private static func startsLower(_ t: String) -> Bool {
        let trimmed = t.drop { " \t\"'\u{201C}\u{2018}(\u{2014}\u{2013}".contains($0) }
        return trimmed.first?.isLowercase == true
    }

    /// Sentences, with no break after "Mr." or "Dr." and none before a lowercase word ("Really? she asked").
    static func sentences(_ p: String) -> [String] {
        let ns = p as NSString
        var parts: [String] = []
        var last = 0
        for m in sentenceBreak.matches(in: p, range: NSRange(location: 0, length: ns.length)) {
            parts.append(ns.substring(with: NSRange(location: last, length: m.range.location - last)))
            last = m.range.location + m.range.length
        }
        parts.append(ns.substring(from: last))
        var out: [String] = []
        for part in parts {
            if let prev = out.last {
                let t = prev.trimmingCharacters(in: .whitespaces)
                let joins = matches(t, noBreakAfter) && !t.hasSuffix("etc.")
                if joins || startsLower(part) { out[out.count - 1] = prev + " " + part; continue }
            }
            out.append(part)
        }
        return out
    }

    private static let clauseBreak = re("[,;:\u{2014}\u{2013})]\\s")

    /// A sentence longer than [limit], cut at a clause break past a quarter, else between words.
    static func splitLong(_ s0: String, limit: Int) -> [String] {
        var s = s0
        var out: [String] = []
        while s.count > limit {
            let window = String(s.prefix(limit + 1))
            let ns = window as NSString
            let clause = clauseBreak.matches(in: window, range: NSRange(location: 0, length: ns.length))
                .map { $0.range.location + 1 }.last { $0 >= limit / 4 }
            var space: Int? = nil
            if let r = window.range(of: " ", options: .backwards) {
                let i = window.distance(from: window.startIndex, to: r.lowerBound)
                if i >= limit / 3 { space = i }
            }
            let cut = clause ?? space ?? limit
            let idx = s.index(s.startIndex, offsetBy: min(cut, s.count))
            out.append(String(s[..<idx]).trimmingCharacters(in: .whitespaces))
            s = String(s[idx...]).trimmingCharacters(in: .whitespaces)
        }
        if !s.isEmpty { out.append(s) }
        return out
    }

    /// Playback pieces of a paragraph (TextCleaner.pieces): about a sentence each, very short ones joined.
    static func pieces(_ p: String, target: Int, hardMax: Int, minLength: Int) -> [String] {
        var out: [String] = []
        var buf = ""
        for sentence in sentences(p) where !sentence.trimmingCharacters(in: .whitespaces).isEmpty {
            let tooShort = buf.count < minLength && buf.count + sentence.count + 1 <= hardMax
            if !buf.isEmpty && buf.count + sentence.count + 1 > target && !tooShort {
                out.append(buf)
                buf = ""
            }
            if !buf.isEmpty { buf += " " }
            buf += sentence
        }
        if !buf.isEmpty { out.append(buf) }
        return out.flatMap { $0.count > hardMax ? splitLong($0, limit: hardMax) : [$0] }
    }

    /// The pieces for a voice: copied voices get shorter ones (they lose their way in long sentences).
    static func pieces(_ p: String, voice: String) -> [String] {
        if voice.hasPrefix("clone:") { return pieces(p, target: 60, hardMax: 160, minLength: 20) }
        return pieces(p, target: 14, hardMax: 320, minLength: 20)
    }

    private static let numberedTitle = re("^(\\d+(?:\\.\\d+)*)\\.\\s+")
    private static let sentenceEndings = ".!?\u{2026}:;\"\u{201D}')"

    /// Every piece ends like a sentence (copied voices run on after a heading otherwise).
    static func endSentence(_ text: String) -> String {
        var t = text.trimmingCharacters(in: .whitespaces)
        while let c = t.last, ",;\u{2014}\u{2013}-".contains(c) { t.removeLast() }
        t = t.trimmingCharacters(in: .whitespaces)
        t = replace(t, numberedTitle, "$1 ")
        if let c = t.last, !sentenceEndings.contains(c) { t += "." }
        return t
    }

    private static let abbreviations: [(NSRegularExpression, String)] = [
        (re("\\bFigs?\\.\\s*(?=\\d)"), "Figure "),
        (re("\\bEqs?\\.\\s*(?=\\(?\\d)"), "Equation "),
        (re("\\bTab\\.\\s*(?=\\d)"), "Table "),
        (re("\\bRef\\.\\s*(?=\\d)"), "Reference "),
        (re("\\bSec\\.\\s*(?=\\d)"), "Section "),
        (re("\\bNo\\.\\s*(?=\\d)"), "number "),
        (re("\\bapprox\\.\\s*"), "approximately "),
        (re("\\bcf\\.\\s*"), "compare "),
        (re("\\bvs\\.?(?=\\s)"), "versus"),
        (re("\\bi\\.e\\.,?"), "that is,"),
        (re("\\be\\.g\\.,?"), "for example,"),
        (re("\\bet al\\."), "and colleagues"),
    ]
    /// The pronunciations every voice uses ("once" was said with the O of "Om"); case kept.
    private static let onceWord = re("(?<![\\p{L}\\p{N}])(once)(?![\\p{L}\\p{N}])", [.caseInsensitive])

    /// The text as it should be spoken.
    static func normalize(_ text: String) -> String {
        var t = text
        for (r, with) in abbreviations { t = replace(t, r, with) }
        // "Once" → "Wunce", "ONCE" → "WUNCE", "once" → "wunce".
        let ns = t as NSString
        var out = ""
        var last = 0
        for m in onceWord.matches(in: t, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let w = ns.substring(with: m.range)
            out += w == w.uppercased() && w.count > 1 ? "WUNCE" : (w.first?.isUppercase == true ? "Wunce" : "wunce")
            last = m.range.location + m.range.length
        }
        out += ns.substring(from: last)
        // Curly quotes as plain ones (the voices read both the same; plain ones confuse fewer of them).
        return out.replacingOccurrences(of: "\u{201C}", with: "\"").replacingOccurrences(of: "\u{201D}", with: "\"")
            .replacingOccurrences(of: "\u{2018}", with: "'").replacingOccurrences(of: "\u{2019}", with: "'")
    }

    private static let afterMark = re("([.!?\u{2026}])\\s*[,;:]")
    private static let colonBeforeCapital = re("(?<!\\d):\\s+(?=\\p{Lu})")
    private static let colon = re("(?<!\\d):(?!\\d)")
    private static let bangBeforeLower = re("!\\s+(?=\\p{Ll})")

    /// CloneCheck.prepareText: how the copying engine's makers prepare text.
    static func prepareForCopied(_ t0: String) -> String {
        var s = t0.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ";", with: ",")
        s = replace(s, afterMark, "$1")
        s = replace(s, colonBeforeCapital, ". ")
        s = replace(s, colon, ",")
        s = replace(s, bangBeforeLower, ", ")
        if s.isEmpty { return s }
        if let f = s.first, !f.isUppercase { s = f.uppercased() + s.dropFirst() }
        if s.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).count < 5 { s = String(repeating: " ", count: 8) + s }
        return s
    }

    private static let stammer = re("\\b(\\p{L}+)\\b[\\s,.\u{2026}-]+\\1\\b", [.caseInsensitive])
    private static let startsWell = re("^\\W*well\\b", [.caseInsensitive])

    /// Lines a copied voice often gets wrong: four words or fewer, a word said twice, or starting with "Well".
    static func risky(_ text: String) -> Bool {
        let t = text.trimmingCharacters(in: .whitespaces)
        let words = t.split(whereSeparator: { $0.isWhitespace }).filter { $0.contains { $0.isLetter || $0.isNumber } }.count
        return words <= 4 || matches(t, stammer) || matches(t, startsWell)
    }
}
