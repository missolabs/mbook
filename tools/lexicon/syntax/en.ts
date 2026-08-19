// Hand-authored English syntax data compiled into en.dict alongside the
// lexicon. Consumed by later rule-based stages: sentence segmentation
// (abbreviations), shallow NP/VP/PP chunking (chunkRules), unknown-word POS
// guessing (suffixGuess), and verb valency hints.

import type { PatItem, Quant, SyntaxData } from "../format/model"
import type { Pos } from "../format/model"

function p(pos: Pos, quant: Quant): PatItem {
  return { pos, quant }
}

export const EN_SYNTAX: SyntaxData = {
  closedClass: {
    determiners: [
      "the", "a", "an", "this", "that", "these", "those", "my", "your", "his",
      "her", "its", "our", "their", "some", "any", "no", "every", "each",
      "either", "neither", "another", "all", "both", "half", "several", "many",
      "much", "few", "little", "more", "most", "such", "what", "which", "whose",
    ],
    pronouns: [
      "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
      "them", "mine", "yours", "hers", "ours", "theirs", "myself", "yourself",
      "himself", "herself", "itself", "ourselves", "yourselves", "themselves",
      "who", "whom", "which", "what", "someone", "somebody", "something",
      "anyone", "anybody", "anything", "everyone", "everybody", "everything",
      "nobody", "nothing", "none", "one",
    ],
    prepositions: [
      "about", "above", "across", "after", "against", "along", "among",
      "around", "at", "before", "behind", "below", "beneath", "beside",
      "between", "beyond", "by", "despite", "down", "during", "except", "for",
      "from", "in", "inside", "into", "like", "near", "of", "off", "on", "onto",
      "out", "outside", "over", "past", "since", "through", "throughout", "to",
      "toward", "towards", "under", "underneath", "until", "up", "upon", "with",
      "within", "without",
    ],
    conjunctions: [
      "and", "or", "but", "nor", "yet", "so", "because", "although", "though",
      "while", "whereas", "since", "unless", "until", "if", "whether", "as",
      "when", "where", "before", "after", "once", "than", "that",
    ],
    // Deictic and frequency adverbs that never head an NP in running prose;
    // `there` matters most (the existential expletive must not read as a noun).
    adverbs: [
      "here", "there", "now", "then", "always", "never", "again",
    ],
    abbreviations: [
      "Mr", "Mrs", "Ms", "Dr", "Prof", "Sr", "Jr", "St", "Ave", "Rd", "Blvd",
      "Inc", "Ltd", "Co", "Corp", "vs", "etc", "e.g", "i.e", "a.m", "p.m",
      "U.S", "U.K", "Ph.D", "Gen", "Col", "Capt", "Sgt", "Lt", "Gov", "Sen",
      "Rep", "No", "Vol", "pp", "Fig",
    ],
  },
  chunkRules: [
    { chunk: "NP", pattern: [p("DET", "opt"), p("NUM", "opt"), p("ADJ", "star"), p("NOUN", "one"), p("NOUN", "star")] },
    { chunk: "NP", pattern: [p("PROPN", "one"), p("PROPN", "star")] },
    { chunk: "NP", pattern: [p("PRON", "one")] },
    { chunk: "VP", pattern: [p("AUX", "star"), p("ADV", "star"), p("VERB", "one")] },
    { chunk: "PP", pattern: [p("ADP", "one"), p("DET", "opt"), p("ADJ", "star"), p("NOUN", "one"), p("NOUN", "star")] },
    { chunk: "PP", pattern: [p("ADP", "one"), p("PRON", "one")] },
  ],
  suffixGuess: [
    { suffix: "tion", pos: "NOUN" },
    { suffix: "sion", pos: "NOUN" },
    { suffix: "ment", pos: "NOUN" },
    { suffix: "ness", pos: "NOUN" },
    { suffix: "ity", pos: "NOUN" },
    { suffix: "ance", pos: "NOUN" },
    { suffix: "ence", pos: "NOUN" },
    { suffix: "ship", pos: "NOUN" },
    { suffix: "age", pos: "NOUN" },
    { suffix: "ist", pos: "NOUN" },
    { suffix: "ism", pos: "NOUN" },
    { suffix: "or", pos: "NOUN" },
    { suffix: "ing", pos: "VERB" },
    { suffix: "ed", pos: "VERB" },
    { suffix: "ify", pos: "VERB" },
    { suffix: "ise", pos: "VERB" },
    { suffix: "ize", pos: "VERB" },
    { suffix: "ate", pos: "VERB" },
    { suffix: "ous", pos: "ADJ" },
    { suffix: "ful", pos: "ADJ" },
    { suffix: "less", pos: "ADJ" },
    { suffix: "able", pos: "ADJ" },
    { suffix: "ible", pos: "ADJ" },
    { suffix: "ive", pos: "ADJ" },
    { suffix: "ic", pos: "ADJ" },
    { suffix: "ish", pos: "ADJ" },
    { suffix: "ly", pos: "ADV" },
    { suffix: "ward", pos: "ADV" },
    { suffix: "wise", pos: "ADV" },
  ],
  valency: [
    { lemma: "be", frame: "copular" },
    { lemma: "become", frame: "copular" },
    { lemma: "seem", frame: "copular" },
    { lemma: "appear", frame: "copular" },
    { lemma: "look", frame: "copular" },
    { lemma: "go", frame: "intransitive" },
    { lemma: "come", frame: "intransitive" },
    { lemma: "arrive", frame: "intransitive" },
    { lemma: "sleep", frame: "intransitive" },
    { lemma: "give", frame: "ditransitive" },
    { lemma: "tell", frame: "ditransitive" },
    { lemma: "send", frame: "ditransitive" },
    { lemma: "show", frame: "ditransitive" },
    { lemma: "make", frame: "transitive" },
    { lemma: "take", frame: "transitive" },
    { lemma: "see", frame: "transitive" },
    { lemma: "want", frame: "transitive" },
    { lemma: "put", frame: "transitive" },
    { lemma: "rely", frame: "prepositional" },
    { lemma: "depend", frame: "prepositional" },
    { lemma: "consist", frame: "prepositional" },
    { lemma: "belong", frame: "prepositional" },
    // English postverbal subjects need the expletive (`there exists / there
    // remained`), so only verbs attested in that frame are marked; `arrive`
    // and kin stay intransitive because "There arrived a stranger" is archaic
    // and the plain SVO reading is the honest default.
    { lemma: "exist", frame: "presentational" },
    { lemma: "remain", frame: "presentational" },
  ],
  complementizers: ["that"],
  // AGID/Moby codes: PAST, 3SG and FIN are finite ("PAST" also prefixes
  // PASTPART — an accepted over-match, since a participle-only homograph with a
  // noun reading is vanishingly rare). The English infinitive is the bare base
  // form (feat ""), indistinguishable from the plain present, so no infinitive
  // prefix can be declared honestly and infinitive-gated rules never fire here.
  verbFeats: {
    finitePrefixes: ["PAST", "3SG", "FIN"],
    infinitivePrefixes: [],
  },
}
