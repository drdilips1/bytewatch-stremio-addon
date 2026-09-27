package com.paper2audio.app

/**
 * Rewrites text into how it should be *said* (the screen keeps the original):
 * statistics ("HR 0.72, 95% CI 0.54–0.96, p=0.03"), units, ranges, symbols,
 * Greek letters, common abbreviations and ALL-CAPS headings. [medical] adds
 * dosing and clinical terms.
 */
object Speech {
    /** Bump when the rules change, so cached audio is made again. */
    const val VERSION = 1

    private const val NUM = """\d+(?:[.,]\d+)?"""
    private val IC = RegexOption.IGNORE_CASE

    private val rules: List<Pair<Regex, (MatchResult) -> String>> = listOf(
        // Confidence intervals: "95% CI 0.54–0.96", "95% CI: 0.54 to 0.96", "(95% CI, 0.54-0.96)"
        Regex("""(\d{2}(?:\.\d)?)\s?(?:%|percent)\s*CI[:,]?\s*\[?($NUM)\s*(?:[-–—]|to)\s*($NUM)\]?""", IC) to { m ->
            "${m.groupValues[1]} percent confidence interval from ${m.groupValues[2]} to ${m.groupValues[3]}"
        },
        Regex("""\bCI[:,]?\s*\[?($NUM)\s*(?:[-–—]|to)\s*($NUM)\]?""") to { m ->
            "confidence interval from ${m.groupValues[1]} to ${m.groupValues[2]}"
        },
        // p-values: "p=0.03", "P < .001", "p ≤ 0.05"
        Regex("""\b[pP]\s*(=|<|>|≤|≥|<=|>=)\s*(0?\.\d+|\d+(?:\.\d+)?(?:\s*[x×]\s*10\s*[−-]\s*\d+)?)""") to { m ->
            val v = m.groupValues[2].let { if (it.startsWith(".")) "0$it" else it }
            when (m.groupValues[1]) {
                "=" -> "a p-value of $v"
                "<" -> "a p-value below $v"
                ">" -> "a p-value above $v"
                "≤", "<=" -> "a p-value of at most $v"
                else -> "a p-value of at least $v"
            }
        },
        // Effect sizes with a value: "HR 0.72", "OR = 1.5", "RR, 0.8"
        Regex("""\b(aHR|HR|aOR|OR|RR|IRR|SMD|MD|NNT|NNH|ARR|RRR)\b\s*[=:,]?\s*($NUM)""") to { m ->
            "${statName(m.groupValues[1])} was ${m.groupValues[2]}"
        },
        // "n = 40", "N=1,200"
        Regex("""\b[nN]\s*=\s*(\d[\d,]*)""") to { m -> "n equals ${m.groupValues[1]}" },
        // "r = 0.5", "R² = 0.8"
        Regex("""\b[rR](²|2|\^2)\s*=\s*""") to { _ -> "R squared equals " },
        Regex("""\br\s*=\s*(?=[−-]?0?\.\d)""") to { _ -> "r equals " },
        // Mean ± SD
        Regex("""($NUM)\s*±\s*($NUM)""") to { m -> "${m.groupValues[1]} plus or minus ${m.groupValues[2]}" },
        // Ranges between numbers: "0.54–0.96", "10-20 mg", "2019–2021" (not "COVID-19" or minus signs)
        Regex("""(?<![\w.])($NUM)\s*[–—]\s*($NUM)(?!\w|\.\d)""") to { m -> "${m.groupValues[1]} to ${m.groupValues[2]}" },
        Regex("""(?<![\w.-])($NUM)\s?-\s?($NUM)(?=\s*(?:%|[a-zA-Zµμ°]))""") to { m -> "${m.groupValues[1]} to ${m.groupValues[2]}" },
    )

    private fun statName(s: String) = when (s) {
        "HR" -> "the hazard ratio"
        "aHR" -> "the adjusted hazard ratio"
        "OR" -> "the odds ratio"
        "aOR" -> "the adjusted odds ratio"
        "RR" -> "the relative risk"
        "IRR" -> "the incidence rate ratio"
        "SMD" -> "the standardized mean difference"
        "MD" -> "the mean difference"
        "NNT" -> "the number needed to treat"
        "NNH" -> "the number needed to harm"
        "ARR" -> "the absolute risk reduction"
        else -> "the relative risk reduction"
    }

    /** Units after a number: "5 mg", "120 mmHg", "37 °C", "2 mg/kg/day". */
    private val UNITS = linkedMapOf(
        "mg/kg/day" to "milligrams per kilogram per day",
        "mg/kg/d" to "milligrams per kilogram per day",
        "mg/kg" to "milligrams per kilogram",
        "mg/dL" to "milligrams per deciliter",
        "mg/dl" to "milligrams per deciliter",
        "mmol/L" to "millimoles per liter",
        "mmol/l" to "millimoles per liter",
        "μmol/L" to "micromoles per liter",
        "µmol/L" to "micromoles per liter",
        "ng/mL" to "nanograms per milliliter",
        "pg/mL" to "picograms per milliliter",
        "g/dL" to "grams per deciliter",
        "mL/min" to "milliliters per minute",
        "mL/kg" to "milliliters per kilogram",
        "IU/L" to "international units per liter",
        "U/L" to "units per liter",
        "cells/μL" to "cells per microliter",
        "cells/µL" to "cells per microliter",
        "kg/m2" to "kilograms per square meter",
        "kg/m²" to "kilograms per square meter",
        "mmHg" to "millimeters of mercury",
        "mEq" to "milliequivalents",
        "mcg" to "micrograms",
        "μg" to "micrograms",
        "µg" to "micrograms",
        "mg" to "milligrams",
        "kg" to "kilograms",
        "mL" to "milliliters",
        "ml" to "milliliters",
        "dL" to "deciliters",
        "μL" to "microliters",
        "µL" to "microliters",
        "IU" to "international units",
        "mm" to "millimeters",
        "cm" to "centimeters",
        "km" to "kilometers",
        "nm" to "nanometers",
        "μm" to "micrometers",
        "µm" to "micrometers",
        "kcal" to "kilocalories",
        "bpm" to "beats per minute",
        "kHz" to "kilohertz",
        "MHz" to "megahertz",
        "GHz" to "gigahertz",
        "Hz" to "hertz",
        "°C" to "degrees Celsius",
        "°F" to "degrees Fahrenheit",
        "ms" to "milliseconds",
        "min" to "minutes",
        "hrs" to "hours",
        "h" to "hours",
        "wk" to "weeks",
        "mo" to "months",
        "yrs" to "years",
        "y" to "years",
        "g" to "grams",
        "L" to "liters",
        "mM" to "millimolar",
        "μM" to "micromolar",
        "µM" to "micromolar",
        "nM" to "nanomolar",
        "GB" to "gigabytes",
        "MB" to "megabytes",
        "TB" to "terabytes",
    )
    private val UNIT_RE = Regex(
        """(\d)\s?(${UNITS.keys.sortedByDescending { it.length }.joinToString("|") { Regex.escape(it) }})(?![\w/²])"""
    )

    private val GREEK = mapOf(
        'α' to "alpha", 'β' to "beta", 'γ' to "gamma", 'δ' to "delta", 'Δ' to "delta", 'ε' to "epsilon",
        'ζ' to "zeta", 'η' to "eta", 'θ' to "theta", 'κ' to "kappa", 'λ' to "lambda", 'μ' to "mu", 'µ' to "mu",
        'ν' to "nu", 'ξ' to "xi", 'π' to "pi", 'ρ' to "rho", 'σ' to "sigma", 'Σ' to "sigma", 'τ' to "tau",
        'φ' to "phi", 'Φ' to "phi", 'χ' to "chi", 'ψ' to "psi", 'ω' to "omega", 'Ω' to "omega",
    )

    private val SYMBOLS = listOf(
        "≤" to " less than or equal to ", "≥" to " greater than or equal to ", "≠" to " not equal to ",
        "≈" to " approximately ", "∼" to " approximately ", "±" to " plus or minus ", "×" to " times ",
        "÷" to " divided by ", "→" to " to ", "←" to " from ", "∞" to " infinity ", "√" to " square root of ",
        "∑" to " sum of ", "∫" to " integral of ", "∂" to " partial ", "∈" to " in ", "∝" to " proportional to ",
        "°" to " degrees", "²" to " squared", "³" to " cubed", "‰" to " per mille", "%" to " percent", "&" to " and ",
    )

    private val ABBREVIATIONS = listOf(
        Regex("""\bFigs?\.\s*(?=\d)""") to "Figure ",
        Regex("""\bEqs?\.\s*(?=\(?\d)""") to "Equation ",
        Regex("""\bTab\.\s*(?=\d)""") to "Table ",
        Regex("""\bRef\.\s*(?=\d)""") to "Reference ",
        Regex("""\bSec\.\s*(?=\d)""") to "Section ",
        Regex("""\bNo\.\s*(?=\d)""") to "number ",
        Regex("""\bapprox\.\s*""") to "approximately ",
        Regex("""\bcf\.\s*""") to "compare ",
        Regex("""\bvs\.?(?=\s)""") to "versus",
        Regex("""\bi\.e\.,?""") to "that is,",
        Regex("""\be\.g\.,?""") to "for example,",
        Regex("""\bet al\.""") to "and colleagues",
        Regex("""\bSD\b""") to "standard deviation",
        Regex("""\bSE\b(?=\s*[=:(]|\s+of\b)""") to "standard error",
        Regex("""\bSEM\b""") to "standard error of the mean",
        Regex("""\bIQR\b""") to "interquartile range",
        Regex("""\b95% CI\b""") to "95 percent confidence interval",
        Regex("""\bCI\b""") to "confidence interval",
        Regex("""\bHR\b""") to "hazard ratio",
        Regex("""\bORs?\b(?=\s*(?:of|for|was|were|\())""") to "odds ratio",
    )

    /** Dosing, routes and clinical-trial terms (medical mode). */
    private val MEDICAL = listOf(
        Regex("""\b(?:b\.i\.d\.|BID|bd)\b""", IC) to "twice daily",
        Regex("""\b(?:t\.i\.d\.|TID|tds)\b""", IC) to "three times daily",
        Regex("""\b(?:q\.i\.d\.|QID|qds)\b""", IC) to "four times daily",
        Regex("""\b(?:q\.d\.|QD|OD)\b""") to "once daily",
        Regex("""\bq\.?(\d+)\s?h\b""", IC) to "every $1 hours",
        Regex("""\bPRN\b|\bp\.r\.n\.""", IC) to "as needed",
        Regex("""\bPO\b""") to "by mouth",
        Regex("""\bIV\b""") to "intravenous",
        Regex("""\bIM\b""") to "intramuscular",
        Regex("""\b(?:SC|SQ|s\.c\.)\b""") to "subcutaneous",
        Regex("""\bHS\b|\bh\.s\.""") to "at bedtime",
        Regex("""\bSTAT\b""") to "immediately",
        Regex("""\bITT\b""") to "intention to treat",
        Regex("""\bmITT\b""") to "modified intention to treat",
        Regex("""\bPP\b(?=\s+(?:analysis|population|set))""") to "per protocol",
        Regex("""\bRCTs\b""") to "randomized controlled trials",
        Regex("""\bRCT\b""") to "randomized controlled trial",
        Regex("""\bAEs\b""") to "adverse events",
        Regex("""\bAE\b""") to "adverse event",
        Regex("""\bSAEs?\b""") to "serious adverse events",
        Regex("""\bOS\b""") to "overall survival",
        Regex("""\bPFS\b""") to "progression-free survival",
        Regex("""\bDFS\b""") to "disease-free survival",
        Regex("""\bQoL\b""") to "quality of life",
        Regex("""\bLOS\b""") to "length of stay",
        Regex("""\bBMI\b""") to "B M I",
        Regex("""\bH&E\b""") to "H and E",
        Regex("""\bIHC\b""") to "immunohistochemistry",
        Regex("""\bFFPE\b""") to "formalin-fixed, paraffin-embedded",
        Regex("""\bhpf\b""", IC) to "high-power field",
        Regex("""\bSPF\b""") to "S P F",
        Regex("""\bUV[AB]?\b""") to "U V",
        Regex("""\bpt\b""") to "patient",
        Regex("""\bpts\b""") to "patients",
        Regex("""\bdx\b""") to "diagnosis",
        Regex("""\btx\b""") to "treatment",
        Regex("""\bhx\b""") to "history",
    )

    /** Words that stay capitalized when an ALL-CAPS line is turned into normal case. */
    private val KEEP_CAPS = setOf(
        "DNA", "RNA", "HIV", "AIDS", "USA", "UK", "EU", "UN", "WHO", "NASA", "COVID", "MRI", "CT", "ECG", "EEG", "ICU",
        "BMI", "HbA1c", "PCR", "NHS", "FDA", "CDC", "AI", "ML", "IQ", "ID", "TV", "PDF", "USB", "GPS", "NATO", "UNESCO",
    )
    private val CAPS_WORD = Regex("""\b[A-Z][A-Z'’]{1,}\b""")

    /** The text as it should be spoken. */
    fun normalize(text: String, medical: Boolean = false): String {
        var t = uncapitalize(text)
        for ((re, f) in rules) t = re.replace(t, f)
        for ((re, rep) in ABBREVIATIONS) t = re.replace(t, rep)
        if (medical) for ((re, rep) in MEDICAL) t = re.replace(t, rep)
        t = UNIT_RE.replace(t) { m -> "${m.groupValues[1]} ${UNITS[m.groupValues[2]]}" }
        for ((sym, word) in SYMBOLS) t = t.replace(sym, word)
        t = buildString(t.length) { for (c in t) append(GREEK[c]?.let { " $it " } ?: c) }
        t = Regex("""\s*([<>=])\s*""").replace(t) { m ->
            when (m.groupValues[1]) { "<" -> " less than "; ">" -> " greater than "; else -> " equals " }
        }
        return Regex("""\s{2,}""").replace(t, " ").replace(Regex("""\s+([,.;:!?])"""), "$1").trim()
    }

    /**
     * Mostly-uppercase text (shouted headings like "LET US BEGIN") is read in normal case,
     * so "US" isn't read as a country; real acronyms keep their capitals.
     */
    internal fun uncapitalize(text: String): String {
        val letters = text.filter { it.isLetter() }
        if (letters.length < 6 || letters.count { it.isUpperCase() } < letters.length * 0.8) return text
        return CAPS_WORD.replace(text) { m ->
            val w = m.value
            if (w in KEEP_CAPS || (w.length <= 3 && w.none { it in "AEIOU" })) w
            else w.lowercase().replaceFirstChar { it.uppercase() }.let { if (m.range.first == 0) it else it.lowercase() }
        }
    }
}
