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
    fun storySegments(paragraph: String, single: Boolean = false): List<Segment> {
        val parts = Stories.split(paragraph, single) ?: return listOf(Segment(paragraph, null))
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

    /** The characters who speak in [doc], with how many lines each, most frequent first. */
    fun characters(doc: Doc): List<Pair<String, Int>> {
        val counts = HashMap<String, Int>()
        for (segs in of(doc).segments.values) for (s in segs) {
            val who = s.speaker ?: continue
            if (who == "he" || who == "she" || who == "?") continue
            counts[who] = (counts[who] ?: 0) + 1
        }
        return counts.entries.sortedByDescending { it.value }.take(60).map { it.key to it.value }
    }

    // ---- The whole book, read once: who speaks every line, and each character's gender ----

    /** Every dialogue paragraph's segments (by paragraph index) with speakers worked out, and genders by name. */
    class Book(val segments: Map<Int, List<Segment>>, val genders: Map<String, String>, val singleQuotes: Boolean)

    private val books = java.util.Collections.synchronizedMap(java.util.WeakHashMap<Doc, Book>())

    /** [doc]'s cast, worked out once (a second or so for a long novel) and kept while the book is open. */
    fun of(doc: Doc): Book = books[doc] ?: synchronized(this) { books[doc] ?: read(doc).also { books[doc] = it } }

    /** Whether the book puts its dialogue in single quotes (‘…’), as many British and Indian editions do. */
    internal fun usesSingleQuotes(doc: Doc): Boolean {
        var single = 0
        var double = 0
        for (p in doc.paragraphs.take(600)) {
            double += p.count { it == '“' }
            for ((i, c) in p.withIndex()) if (c == '‘' && (i == 0 || !p[i - 1].isLetterOrDigit())) single++
        }
        return single >= 15 && single > double * 3
    }

    private fun read(doc: Doc): Book {
        val single = usesSingleQuotes(doc)
        val raw = HashMap<Int, List<Segment>>()
        for ((i, p) in doc.paragraphs.withIndex()) {
            if (if (single) '‘' !in p else ('“' !in p && '”' !in p)) continue
            val segs = storySegments(p, single)
            if (segs.any { it.speaker != null }) raw[i] = segs
        }
        // Everyone named as a speaker, and their gender from the whole book.
        val names = raw.values.flatten().mapNotNull { it.speaker }.filter { it != "he" && it != "she" && it != "?" }.toSet()
        val genders = HashMap<String, String>()
        for (name in names) {
            val text = doc.paragraphs.asSequence().filter { name in it }.joinToString(" ")
            (genderOf(name, text, names) ?: NAME_GENDER[name.substringBefore(' ').lowercase()])?.let { genders[name] = it }
        }
        // Conversations: lines without "she said" alternate between the two people talking.
        val out = HashMap<Int, List<Segment>>()
        val recent = ArrayList<String>() // the last two people who spoke, most recent last
        var lastDialogue = -10
        for (i in raw.keys.sorted()) {
            if (i - lastDialogue > 3) recent.clear() // a long stretch of narration: a new scene
            lastDialogue = i
            val narration = raw.getValue(i).filter { it.speaker == null }.joinToString(" ") { it.text }
            var thisParagraph: String? = null
            out[i] = raw.getValue(i).map { s ->
                val who = s.speaker ?: return@map s
                val resolved = when (who) {
                    "?" -> thisParagraph ?: if (recent.size == 2) recent[0] else null
                    "he", "she" -> {
                        val g = if (who == "he") "male" else "female"
                        // Someone named in this paragraph's narration with that gender, else one of the two talking.
                        NAME_WORD.findAll(narration).map { it.value }.filter { it in names && genders[it] == g }.lastOrNull()
                            ?: recent.filter { genders[it] == g }.singleOrNull()
                    }
                    else -> who
                }
                if (resolved != null) {
                    thisParagraph = resolved
                    recent.remove(resolved)
                    recent += resolved
                    while (recent.size > 2) recent.removeAt(0)
                }
                Segment(s.text, resolved ?: who)
            }
        }
        return Book(out, genders, single)
    }

    private val NAME_WORD = Regex("""\b[A-Z][a-z]{1,15}\b""")

    /**
     * Common first names (English and Indian) for when the book itself doesn't say (no "he" or
     * "she" near the name): a last resort, before guessing from the narrator.
     */
    private val NAME_GENDER: Map<String, String> = (
        ("mary anne anna emma olivia sophia isabella mia charlotte amelia emily grace lily ella chloe sarah jane " +
            "elizabeth lizzie kate katie margaret helen alice lucy rose ruby hannah laura rachel rebecca jessica jennifer " +
            "linda susan karen nancy betty dorothy julia claire diana victoria hermione ginny luna petunia molly minerva " +
            "lily jo meg beth amy priya payal pooja anjali neha kavya riya sneha divya meera asha radha sita lakshmi aarti " +
            "arti nisha shreya simran ananya aishwarya deepika sunita anita geeta gita kamala kavita lata maya nandini " +
            "parvati rekha savita shanti sonia swati tara uma usha vidya zara fatima ayesha sana noor").split(' ').associateWith { "female" } +
            ("john james robert michael william david richard joseph thomas charles daniel matthew mark paul george " +
                "edward henry jack harry tom ben sam peter andrew steven kevin brian simon oliver arthur albert fred frank " +
                "ron vernon dudley albus severus sirius draco neville hagrid rahul amit arjun rohan vikram raj ravi sanjay " +
                "anil suresh ramesh ajay vijay aman karan dev krishna arun ashok deepak gopal hari manoj mohan mukesh naveen " +
                "nikhil prakash rajesh sachin sunil vinod yash aditya akash ankit varun vivek imran ali omar ahmed hassan").split(' ').associateWith { "male" }
        )

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
