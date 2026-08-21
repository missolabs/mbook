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
    // `which` is deliberately NOT here (only in pronouns): in prose the
    // relative use dominates the interrogative determiner, and dual
    // membership would abstain into Moby's junk NOUN reading, letting an NP
    // swallow it ("the letter which" heading on `which`).
    determiners: [
      "the", "a", "an", "this", "that", "these", "those", "my", "your", "his",
      "her", "its", "our", "their", "some", "any", "no", "every", "each",
      "either", "neither", "another", "all", "both", "half", "several", "many",
      "much", "few", "little", "more", "most", "such", "what", "whose",
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
      "perhaps", "maybe", "often", "already", "soon",
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
  // Curated with a bias the tagger depends on: a valency hint also promotes a
  // sentence-initial finite reading over a noun homograph, so verbs whose
  // marked forms are frequent bare nouns (smiles, whispers, screams, dreams,
  // sounds, falls-of-water, walks, plays) are deliberately absent — English
  // opens far more sentences on nouns than on verbs.
  valency: [
    { lemma: "be", frame: "copular" },
    { lemma: "become", frame: "copular" },
    { lemma: "seem", frame: "copular" },
    { lemma: "appear", frame: "copular" },
    { lemma: "look", frame: "copular" },
    { lemma: "stay", frame: "copular" },
    { lemma: "go", frame: "intransitive" },
    // In prose `do` is overwhelmingly the auxiliary (`Did you see...`), and
    // marking it object-taking would read the inverted subject as its object;
    // the main-verb use (`did the dishes`) is sacrificed knowingly.
    { lemma: "do", frame: "intransitive" },
    { lemma: "arrive", frame: "intransitive" },
    { lemma: "sleep", frame: "intransitive" },
    { lemma: "die", frame: "intransitive" },
    { lemma: "fall", frame: "intransitive" },
    { lemma: "run", frame: "intransitive" },
    { lemma: "swim", frame: "intransitive" },
    { lemma: "sit", frame: "intransitive" },
    { lemma: "vanish", frame: "intransitive" },
    { lemma: "disappear", frame: "intransitive" },
    { lemma: "tremble", frame: "intransitive" },
    { lemma: "weep", frame: "intransitive" },
    { lemma: "return", frame: "intransitive" },
    { lemma: "give", frame: "ditransitive" },
    { lemma: "tell", frame: "ditransitive" },
    { lemma: "send", frame: "ditransitive" },
    { lemma: "show", frame: "ditransitive" },
    { lemma: "bring", frame: "ditransitive" },
    { lemma: "offer", frame: "ditransitive" },
    { lemma: "lend", frame: "ditransitive" },
    // `have` earns its hint for the PERFECT: without it `had` resolves to
    // Moby's junk had-lemma and the participle chain gate never sees the
    // auxiliary ("She had walked" losing its periphrasis).
    { lemma: "have", frame: "transitive" },
    { lemma: "make", frame: "transitive" },
    { lemma: "take", frame: "transitive" },
    { lemma: "see", frame: "transitive" },
    { lemma: "want", frame: "transitive" },
    { lemma: "put", frame: "transitive" },
    { lemma: "know", frame: "transitive" },
    { lemma: "believe", frame: "transitive" },
    { lemma: "say", frame: "transitive" },
    { lemma: "ask", frame: "transitive" },
    { lemma: "answer", frame: "transitive" },
    { lemma: "write", frame: "transitive" },
    { lemma: "read", frame: "transitive" },
    { lemma: "open", frame: "transitive" },
    { lemma: "close", frame: "transitive" },
    { lemma: "hear", frame: "transitive" },
    { lemma: "feel", frame: "transitive" },
    { lemma: "find", frame: "transitive" },
    { lemma: "lose", frame: "transitive" },
    { lemma: "love", frame: "transitive" },
    { lemma: "hate", frame: "transitive" },
    { lemma: "watch", frame: "transitive" },
    { lemma: "remember", frame: "transitive" },
    { lemma: "forget", frame: "transitive" },
    { lemma: "understand", frame: "transitive" },
    { lemma: "realize", frame: "transitive" },
    { lemma: "imagine", frame: "transitive" },
    { lemma: "notice", frame: "transitive" },
    { lemma: "observe", frame: "transitive" },
    { lemma: "carry", frame: "transitive" },
    { lemma: "hold", frame: "transitive" },
    { lemma: "drink", frame: "transitive" },
    { lemma: "eat", frame: "transitive" },
    { lemma: "kill", frame: "transitive" },
    { lemma: "fear", frame: "transitive" },
    { lemma: "meet", frame: "transitive" },
    { lemma: "call", frame: "transitive" },
    { lemma: "receive", frame: "transitive" },
    { lemma: "wear", frame: "transitive" },
    { lemma: "cross", frame: "transitive" },
    { lemma: "climb", frame: "transitive" },
    { lemma: "catch", frame: "transitive" },
    { lemma: "follow", frame: "transitive" },
    { lemma: "reach", frame: "transitive" },
    { lemma: "rely", frame: "prepositional" },
    { lemma: "depend", frame: "prepositional" },
    { lemma: "consist", frame: "prepositional" },
    { lemma: "belong", frame: "prepositional" },
    { lemma: "think", frame: "prepositional" },
    { lemma: "wait", frame: "prepositional" },
    { lemma: "listen", frame: "prepositional" },
    // English postverbal subjects need the expletive (`there exists / there
    // remained`), so only verbs attested in that frame are marked; `arrive`
    // and kin stay intransitive because "There arrived a stranger" is archaic
    // and the plain SVO reading is the honest default. `come` is the
    // exception literary narration still licenses bare ("Then came the
    // winter").
    { lemma: "exist", frame: "presentational" },
    { lemma: "remain", frame: "presentational" },
    { lemma: "come", frame: "presentational" },
  ],
  complementizers: ["that"],
  // `that` never chunks as a bare-pronoun NP here (DET outranks PRON for it),
  // so only the human relatives need declaring.
  relativePronouns: ["who", "whom", "which"],
  relativePlaceAdverbs: ["where"],
  genitiveMarkers: ["of"],
  passiveAuxiliaries: ["be"],
  agentMarkers: ["by"],
  expletives: ["there"],
  // Verbs of saying: the dialogue-tag inversion (`"...," said Holmes`). Same
  // curation bias as Portuguese — verbs that take a person as OBJECT stay out
  // (`observed Mary` watches her at least as often as it quotes her, so
  // `observe` is absent despite its Victorian dialogue-tag pedigree).
  // `observe` is safe here despite `observed Mary` also meaning watching her:
  // English demands overt subjects, so a subjectless dicendi + name only
  // occurs in attribution tails, and the clause-mate gate blocks plain SVO.
  dicendi: [
    "say", "ask", "reply", "answer", "whisper", "murmur", "mutter", "shout",
    "cry", "exclaim", "insist", "repeat", "argue", "add", "continue",
    "conclude", "remark", "sigh", "groan", "wonder", "think", "observe",
  ],
  dativeMarkers: ["to", "for"],
  negators: ["not", "never"],
  // English nouns carry no gender feat, so agreement can only come from the
  // pronoun side; an antecedent search falls back to nearest-nominal when the
  // candidate carries no feat to check.
  anaphoricPronouns: [
    { form: "he", feat: "ms" },
    { form: "she", feat: "fs" },
    { form: "they", feat: "" },
  ],
  possessivePronouns: ["his", "her", "their"],
  // English object pronouns are free forms the normal NP/object machinery
  // already binds ("saw him"); no clitic classes exist.
  accusativeClitics: [],
  dativeClitics: [],
  reflexiveClitics: [],
  // All in the closed conjunction list; these open adverbial clauses.
  subordinators: ["when", "while", "because", "although", "though", "if", "unless", "until", "once"],
  possessiveRelatives: ["whose"],
  definiteArticles: ["the"],
  indefiniteArticles: ["a", "an"],
  temporalNouns: [
    "night", "day", "morning", "evening", "afternoon", "moment", "instant",
    "hour", "time", "year", "month", "week", "summer", "winter", "spring",
    "autumn", "childhood", "eve", "sunday", "saturday",
  ],
  // The verb-particle construction ("gave up", "looked back"). `on`/`in` are
  // deliberately absent — as particles they are rarer than their plain
  // prepositional readings and would steal PP openers.
  particles: ["up", "down", "out", "off", "away", "back"],
  degreeAdverbs: ["more", "less", "as"],
  thanMarkers: ["than", "as"],
  perfectAuxiliaries: ["have"],
  lightVerbs: [
    { verb: "take", noun: "walk", lemma: "walk" },
    { verb: "take", noun: "look", lemma: "look" },
    { verb: "take", noun: "breath", lemma: "breathe" },
    { verb: "take", noun: "bath", lemma: "bathe" },
    { verb: "have", noun: "look", lemma: "look" },
    { verb: "have", noun: "drink", lemma: "drink" },
    { verb: "make", noun: "decision", lemma: "decide" },
    { verb: "make", noun: "promise", lemma: "promise" },
    { verb: "give", noun: "sigh", lemma: "sigh" },
    { verb: "give", noun: "laugh", lemma: "laugh" },
  ],
  locativeMarkers: ["in", "at", "into", "to", "from", "toward", "towards"],
  placeHeadNouns: [
    "city", "town", "street", "square", "bar", "café", "village", "country",
    "avenue", "station", "beach", "harbor", "harbour", "road", "port",
  ],
  timeConnectives: [
    { form: "then", role: "advance" },
    { form: "afterwards", role: "advance" },
    { form: "later", role: "advance" },
    { form: "finally", role: "advance" },
    { form: "earlier", role: "retreat" },
  ],
  subordinatorTime: [
    { form: "when", edge: "sub-meets-matrix" },
    { form: "once", edge: "sub-meets-matrix" },
    { form: "while", edge: "matrix-during-sub" },
    { form: "because", edge: "sub-before-matrix" },
    { form: "until", edge: "matrix-meets-sub" },
    { form: "although", edge: "none" },
    { form: "though", edge: "none" },
    { form: "if", edge: "none" },
    { form: "unless", edge: "none" },
  ],
  subordinatorSenses: [
    { form: "when", sense: "temporal" },
    { form: "once", sense: "temporal" },
    { form: "while", sense: "temporal" },
    { form: "until", sense: "temporal" },
    { form: "because", sense: "causal" },
    { form: "since", sense: "causal" },
    { form: "if", sense: "conditional" },
    { form: "unless", sense: "conditional" },
    { form: "although", sense: "concessive" },
    { form: "though", sense: "concessive" },
  ],
  discourseMarkers: [
    { form: "but", sense: "contrast" },
    { form: "however", sense: "contrast" },
    { form: "yet", sense: "contrast" },
    { form: "so", sense: "consequence" },
    { form: "therefore", sense: "consequence" },
    { form: "thus", sense: "consequence" },
  ],
  // English weather verbs take the expletive (`it rained`), so the
  // impersonal excuse never needs them; the list stays honest anyway.
  weatherVerbs: ["rain", "snow", "drizzle", "thunder"],
  negativeIndefinites: ["nobody", "nothing", "none", "no", "nowhere", "neither"],
  modalVerbs: ["can", "could", "may", "might", "must", "shall", "should", "would", "want", "wish", "try"],
  reportingVerbs: ["think", "believe", "imagine", "suppose", "doubt", "hope", "seem"],
  factiveVerbs: ["know", "remember", "realize", "notice", "discover", "admit"],
  intensifiers: ["very", "so", "quite", "almost", "rather", "too", "really"],
  roleMarkers: ["as"],
  // The purpose infinitive is gated on an object-rejecting matrix (`went to
  // buy bread`); a complement-taking verb's `to` is its complement, not a
  // purpose.
  purposeMarkers: ["to"],
  durationMarkers: ["for", "during"],
  interrogativeAdverbs: ["where", "when", "how", "why"],
  personTitles: ["Mr", "Mrs", "Ms", "Miss", "Dr", "Prof", "Sir", "Lady", "Lord"],
  personHeadNouns: [
    "man", "woman", "boy", "girl", "detective", "doctor", "writer", "poet",
    "friend", "neighbor", "neighbour", "stranger", "gentleman", "sailor",
  ],
  animalHeadNouns: ["cat", "dog", "bird", "horse", "fish"],
  organizationHeadNouns: ["company", "firm", "band", "newspaper", "bank", "shop"],
  objectPredicativeVerbs: ["find", "leave", "make", "keep", "consider", "paint"],
  // AGID/Moby codes: PAST, 3SG and FIN are finite ("PAST" also prefixes
  // PASTPART — an accepted over-match, since a participle-only homograph with a
  // noun reading is vanishingly rare). The English infinitive is the bare base
  // form (feat ""), indistinguishable from the plain present, so no infinitive
  // prefix can be declared honestly and infinitive-gated rules never fire here.
  verbFeats: {
    finitePrefixes: ["PAST", "3SG", "FIN"],
    infinitivePrefixes: [],
    participlePrefixes: ["PASTPART"],
    gerundPrefixes: ["PROG"],
    // English feats never carry 1st/2nd person digits, so no tense needs
    // declaring; the person gates simply never fire here.
    personDistinctPrefixes: [],
    // PASTPART before PAST — first declared prefix wins.
    tenseSenses: [
      { prefix: "PASTPART", sense: "participle" },
      { prefix: "PAST", sense: "past" },
      { prefix: "PROG", sense: "gerund" },
      { prefix: "3SG", sense: "present" },
      { prefix: "FIN", sense: "present" },
    ],
  },
}
