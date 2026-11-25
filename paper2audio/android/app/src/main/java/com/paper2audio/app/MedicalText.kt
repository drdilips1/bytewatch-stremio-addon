package com.paper2audio.app

/**
 * Whether a document reads as medical (a research article, guideline, textbook chapter or case report), so
 * Narrato reads doses, units and clinical abbreviations in full there by itself ([Speaker.medicalFor]).
 * Worked out once per document from samples of its text: how often clinical words come up.
 */
object MedicalText {
    /** By document key (a book's text can be large: no hashing of it). */
    private val seen = HashMap<String, Boolean>()

    private val CLINICAL = Regex(
        """\b(?:patients?|clinical(?:ly)?|diagnos(?:is|es|ed|tic)|treatments?|therap(?:y|ies|eutic)|diseases?|syndromes?|""" +
            """symptoms?|dos(?:e|es|ing|age)|mg|mcg|randomi[sz]ed|placebo|trials?|cohort|etiology|aetiology|prognosis|""" +
            """lesions?|biops(?:y|ies)|histolog\w*|patholog\w*|infections?|inflammat\w*|chronic|acute|mortality|morbidity|""" +
            """incidence|prevalence|efficacy|adverse|contraindicat\w*|pharmacolog\w*|physicians?|hospital\w*|surgery|surgical|""" +
            """dermat\w*|cardi\w*|renal|hepatic|pulmonary|neurolog\w*|oncolog\w*|tumou?rs?|carcinoma|lymph\w*|serum|plasma|""" +
            """intravenous|oral(?:ly)?|subcutaneous|topical|prescri\w*|clinicians?|management)\b""",
        RegexOption.IGNORE_CASE,
    )

    fun looksMedical(d: Doc): Boolean = synchronized(seen) {
        seen.getOrPut(d.key) { score(d) }
    }

    private fun score(d: Doc): Boolean {
        val paras = d.paragraphs
        if (paras.isEmpty()) return false
        // Samples from the start, middle and end (a novel can have one hospital chapter).
        val sample = StringBuilder()
        for (at in listOf(0.05, 0.25, 0.5, 0.75, 0.95)) {
            var i = (paras.size * at).toInt().coerceIn(0, paras.size - 1)
            var taken = 0
            while (i < paras.size && taken < 4_000) {
                sample.append(paras[i]).append(' ')
                taken += paras[i].length
                i++
            }
        }
        val words = sample.count { it == ' ' }.coerceAtLeast(1)
        val hits = CLINICAL.findAll(sample).count()
        // Medical writing: about 2 or more clinical words in every 100; fiction and general writing far fewer.
        return words >= 150 && hits * 100.0 / words >= 1.8
    }
}
