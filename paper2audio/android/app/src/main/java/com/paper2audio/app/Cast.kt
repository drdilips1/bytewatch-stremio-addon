package com.paper2audio.app

/**
 * Who says what, for multi-voice reading:
 *  - scripts and transcripts ("Host: …", "Speaker 2: …") get one voice per speaker;
 *  - in stories, quoted dialogue gets a voice per character ("…,” said Maya), with
 *    the character's gender guessed from "he said" / "she asked" and pronouns.
 */
object Cast {
    /** A stretch of text and who speaks it (null: the narrator). */
    data class Segment(val text: String, val speaker: String?)

    private val SCRIPT_LINE = Regex("""^([A-Z][\w.'\-]*(?: [A-Z0-9][\w.'\-]*){0,2}):\s+(\S.*)$""", RegexOption.DOT_MATCHES_ALL)
    private const val VERBS = "said|asked|replied|answered|whispered|shouted|cried|called|added|muttered|murmured|" +
        "exclaimed|yelled|laughed|snapped|sighed|began|continued|insisted|told|warned|agreed|admitted|explained|repeated"
    /** "Mrs. ", "Aunt " before a name: skipped, so the name itself is the character. */
    private const val TITLE = """(?:(?:Mrs|Mr|Ms|Miss|Dr|Sir|Lady|Lord|Aunt|Uncle|Captain|Madame|Monsieur)\.?\s+)?"""
    private val AFTER_NAME = Regex("""^[,.!?]?\s*(?:$VERBS)\s+(?:the\s+)?$TITLE([A-Z][a-z]+(?: [A-Z][a-z]+)?)""")
    private val AFTER_NAME_FIRST = Regex("""^[,.!?]?\s*$TITLE([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(?:$VERBS)\b""")
    private val AFTER_PRONOUN = Regex("""^[,.!?]?\s*(he|she)\s+(?:$VERBS)\b""", RegexOption.IGNORE_CASE)
    private val BEFORE_NAME = Regex("""$TITLE([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+(?:$VERBS)[,:]?\s*$""")
    private val BEFORE_PRONOUN = Regex("""\b(he|she)\s+(?:$VERBS)[,:]?\s*$""", RegexOption.IGNORE_CASE)
    private val NOT_NAMES = setOf("The", "Then", "But", "And", "She", "He", "It", "They", "We", "You", "I", "This", "That", "When", "Now", "Mrs", "Mr", "Ms", "Miss", "Dr")

    /** "Host: Welcome back." -> ("Host", "Welcome back."). */
    fun scriptLine(p: String): Pair<String, String>? {
        val m = SCRIPT_LINE.matchEntire(p.trim()) ?: return null
        val name = m.groupValues[1]
        if (name.length > 30 || name in NOT_NAMES) return null
        return name to m.groupValues[2]
    }

    /** Speakers of a script or transcript, in order of appearance; empty if the document isn't one. */
    fun scriptSpeakers(doc: Doc): List<String> {
        val lines = doc.paragraphs.mapNotNull { scriptLine(it)?.first }
        if (lines.size < 4 || lines.size < doc.paragraphs.size * 0.5) return emptyList()
        val counts = lines.groupingBy { it }.eachCount()
        // Real speakers come back again and again.
        return lines.distinct().filter { (counts[it] ?: 0) >= 2 }.take(8)
    }

    /**
     * Splits a story paragraph into narration and quoted speech, naming the speaker of
     * each quote when the text says ("…,” said Maya / Maya asked, “…” / “…,” she said).
     * Pronoun speakers come back as "he" or "she".
     */
    fun storySegments(paragraph: String): List<Segment> {
        val parts = Stories.split(paragraph) ?: return listOf(Segment(paragraph, null))
        val out = ArrayList<Segment>()
        for ((i, part) in parts.withIndex()) {
            val (quoted, text) = part
            if (!quoted) {
                out += Segment(text, null)
                continue
            }
            val after = parts.getOrNull(i + 1)?.takeIf { !it.first }?.second.orEmpty()
            val before = parts.getOrNull(i - 1)?.takeIf { !it.first }?.second.orEmpty()
            // The previous named speaker: "he said" right after them is usually the other person.
            val previous = out.lastOrNull { it.speaker != null && it.speaker != "?" && it.speaker != "he" && it.speaker != "she" }?.speaker
            val speaker = AFTER_NAME.find(after)?.groupValues?.get(1)?.takeIf { it !in NOT_NAMES }
                ?: AFTER_NAME_FIRST.find(after)?.groupValues?.get(1)?.takeIf { it !in NOT_NAMES }
                ?: AFTER_PRONOUN.find(after)?.groupValues?.get(1)?.lowercase()?.let { lastName(parts, i, previous) ?: it }
                ?: BEFORE_NAME.find(before)?.groupValues?.get(1)?.takeIf { it !in NOT_NAMES }
                ?: BEFORE_PRONOUN.find(before)?.groupValues?.get(1)?.lowercase()?.let { lastName(parts, i, previous) ?: it }
                ?: "?"
            out += Segment(text, speaker)
        }
        // A quote whose speaker isn't named continues the previous named quote in the paragraph.
        var last: String? = null
        return out.map { s ->
            when {
                s.speaker == null -> s
                s.speaker == "?" -> Segment(s.text, last ?: "?")
                else -> { last = s.speaker; s }
            }
        }
    }

    private val CHILD = Regex("""\b(?:boy|girl|child|kid|toddler|baby|schoolboy|schoolgirl|little (?:boy|girl|one|brother|sister)|(?:[1-9]|1[0-2]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[- ]years?[- ]old)\b""", RegexOption.IGNORE_CASE)
    private val ADULT = Regex("""\b(?:man|woman|lady|gentleman|wife|husband|sir|madam|grown)\b""", RegexOption.IGNORE_CASE)

    /** Whether the text around [name] says they're a child ("little Tom", "the girl", "seven years old"). */
    fun isChild(name: String, text: String): Boolean {
        if (name.length < 2 || !name.first().isLetter()) return false
        var child = 0
        var adult = 0
        for (m in Regex("""(.{0,40})\b${Regex.escape(name)}\b(.{0,80})""").findAll(text)) {
            val around = m.groupValues[1] + " " + m.groupValues[2]
            child += CHILD.findAll(around).count()
            adult += ADULT.findAll(around).count()
        }
        return child >= 2 && child > adult * 2
    }

    /** The characters who speak in [doc] (named in "…,” said Maya and the like), most frequent first. */
    fun characters(doc: Doc): List<Pair<String, Int>> {
        val counts = HashMap<String, Int>()
        for (p in doc.paragraphs) {
            if ('"' !in p && '“' !in p && '«' !in p && '‘' !in p && '\'' !in p) continue
            for (s in storySegments(p)) {
                val who = s.speaker ?: continue
                if (who == "he" || who == "she" || who == "?") continue
                counts[who] = (counts[who] ?: 0) + 1
            }
        }
        return counts.entries.sortedByDescending { it.value }.take(60).map { it.key to it.value }
    }

    private val NAME = Regex("""\b([A-Z][a-z]{1,15})\b""")
    private val MALE = Regex("""\b(he|his|him|himself)\b""")
    private val FEMALE = Regex("""\b(she|her|hers|herself)\b""")

    /** The last character named in the narration before quote [i] ("Tom looked up. “No,” he said" -> Tom). */
    private fun lastName(parts: List<Pair<Boolean, String>>, i: Int, exclude: String?): String? {
        for (k in i - 1 downTo 0) {
            if (parts[k].first) continue
            val names = NAME.findAll(parts[k].second).map { it.value }.filter { it !in NOT_NAMES && it != exclude }.toList()
            if (names.isNotEmpty()) return names.last()
        }
        return null
    }

    /**
     * "male", "female" or null, from the pronouns right after a character's name in
     * [text] (up to the next name in [others], so another character's pronouns don't count).
     */
    fun genderOf(name: String, text: String, others: Set<String> = emptySet()): String? {
        if (name == "he") return "male"
        if (name == "she") return "female"
        // A title says it outright: "Mrs. Bennet", "Aunt Polly", "Sir Walter".
        val n = Regex.escape(name)
        val womanTitles = Regex("""\b(?:Mrs|Miss|Ms|Lady|Queen|Princess|Duchess|Countess|Madam|Madame|Mme|Aunt|Auntie|Mother|Grandma|Granny|Sister|Mistress|Dame|Empress)\.?\s+$n\b""")
        val manTitles = Regex("""\b(?:Mr|Sir|Lord|King|Prince|Duke|Count|Monsieur|Uncle|Father|Grandpa|Brother|Master|Emperor|Captain|Colonel)\.?\s+$n\b""")
        val w = womanTitles.findAll(text).count()
        val m = manTitles.findAll(text).count()
        if (w > m) return "female"
        if (m > w) return "male"
        var male = 0
        var female = 0
        // Built once per call (not per mention): this runs over long books.
        val otherNames = others.filter { it != name && it.length > 1 && it != "he" && it != "she" && it != "?" }
        val other = if (otherNames.isEmpty()) null else Regex("""\b(?:${otherNames.joinToString("|") { Regex.escape(it) }})\b""")
        // A lookahead, so mentions close together are all counted.
        for (m in Regex("""\b${Regex.escape(name)}\b(?=(.{0,80}))""").findAll(text)) {
            var tail = m.groupValues[1]
            val cut = other?.find(tail)?.range?.first
            if (cut != null) tail = tail.substring(0, cut)
            tail = tail.lowercase()
            male += MALE.findAll(tail).count()
            female += FEMALE.findAll(tail).count()
        }
        return when {
            male > female -> "male"
            female > male -> "female"
            else -> null
        }
    }
}
