# mbook `.dict` format (v2)

One `.dict` file holds one language's compiled lexicon **and** its hand-authored
syntax data. It is optimised for exact-surface-form lookup at low memory: a
sorted form table binary-searched in place, plus packed fixed-width entry
records that reference deduplicated string pools.

The runtime contract a reader must satisfy:

```
lookup(form: string) -> Entry[]
Entry = { lemma: string, pos: Pos, feat: string, variant: Variant }
```

`tools/lexicon/format/decode.ts` is the reference reader and the executable
mirror of this document. `tools/lexicon/format/encode.ts` is the writer.

## Conventions

- All integers are **little-endian, unsigned**: `u8`, `u16`, `u32`.
- All strings are **UTF-8**, never NUL-terminated; their length comes from the
  offset tables described below.
- The file is meant to be read once into a single buffer (or mmap'd). Offset
  tables index into blobs that live in the same buffer; no string is copied
  until a form is actually looked up.
- Notation `T[n]` means `n` consecutive values of type `T`.

## Enumerations

### `Pos` (u8)
```
0 NOUN   1 PROPN  2 VERB   3 ADJ    4 ADV
5 PRON   6 DET    7 ADP    8 CONJ   9 NUM
10 INTJ  11 AUX   12 PART  13 X
```

### `Variant` (u8)
```
0 both   1 us   2 uk
```
`both` = spelling valid in US and UK English (and always for pt-BR).

### `VariantScheme` (u8) — file-level metadata
```
0 none    (pt-BR: every entry's Variant is 0)
1 us-uk   (en: entries carry meaningful us/uk/both tags)
```

## File layout (in order)

### 1. Header
| field         | type      | value / meaning                          |
|---------------|-----------|------------------------------------------|
| magic         | u8[4]     | `4D 42 4C 58` = ASCII `"MBLX"`           |
| version       | u32       | `2`                                      |
| langLen       | u8        | byte length of `lang`                    |
| lang          | u8[langLen] | UTF-8 language tag (`"pt-BR"`, `"en"`)  |
| variantScheme | u8        | `VariantScheme`                          |

### 2. Lexicon — counts
| field       | type | meaning                                  |
|-------------|------|------------------------------------------|
| formCount   | u32  | number of distinct surface forms         |
| entryCount  | u32  | total entry records (≥ formCount)         |
| lemmaCount  | u32  | number of pooled lemma strings           |
| featCount   | u16  | number of pooled feature strings         |

### 3. Lexicon — form table
| field       | type              | meaning                              |
|-------------|-------------------|--------------------------------------|
| formBlobLen | u32               | byte length of `formBlob`            |
| formOffsets | u32[formCount+1]  | offsets into `formBlob`              |
| formBlob    | u8[formBlobLen]   | concatenated UTF-8 of all forms      |

Form *i* (0-based) is the byte range `formBlob[formOffsets[i] ..
formOffsets[i+1]]`. `formOffsets[0] == 0`, `formOffsets[formCount] ==
formBlobLen`.

**Ordering — load-bearing:** forms are sorted **ascending by unsigned byte
comparison of their UTF-8 encodings** (compare byte-by-byte; the shorter string
is smaller on a shared prefix). This is *not* the same as JavaScript's UTF-16
`<`. A reader MUST binary-search using the identical comparison: encode the query
to UTF-8 and compare bytes. (`compareBytes` in `encode.ts` is the canonical
comparator; `decode.ts` reuses it.)

### 4. Lexicon — per-form entry ranges
| field      | type              | meaning                               |
|------------|-------------------|---------------------------------------|
| entryStart | u32[formCount+1]  | entry-record range per form           |

Form *i*'s entries are records `[entryStart[i] .. entryStart[i+1])`.
`entryStart[0] == 0`, `entryStart[formCount] == entryCount`.

### 5. Lexicon — entry records
`entryCount` records, **8 bytes each**, in form order:

| offset | type | field    | meaning                                |
|--------|------|----------|----------------------------------------|
| +0     | u32  | lemmaRef | index into the lemma pool              |
| +4     | u8   | pos      | `Pos`                                  |
| +5     | u8   | variant  | `Variant`                              |
| +6     | u16  | featRef  | index into the feature pool            |

Record *k* begins at byte `entriesBase + k*8`, where `entriesBase` is the file
offset immediately after `entryStart`. Duplicate analyses of one form (same
lemma+pos+feat+variant) are collapsed at compile time.

### 6. String pools
Two pools follow, **lemma pool then feature pool**, each with the same shape:

| field       | type              | meaning                              |
|-------------|-------------------|--------------------------------------|
| blobLen     | u32               | byte length of the pool blob         |
| offsets     | u32[count+1]      | offsets into the blob                |
| blob        | u8[blobLen]       | concatenated UTF-8 strings           |

`count` is `lemmaCount` for the lemma pool and `featCount` for the feature pool
(from section 2). String *j* is `blob[offsets[j] .. offsets[j+1]]`.

- **Lemma pool:** `lemmaRef` resolves here.
- **Feature pool:** `featRef` resolves here. Index `0` is always the empty
  string `""` (an entry with no morphology). Feature strings are short,
  language-native morphology codes stored opaquely — the linguistic engine
  interprets them:
  - **pt-BR** (Unitex codes): gender/number `ms fs mp fp`; verb `T P I J F C S
    U Q Y W G K` (tense/mood) + person `1 2 3` + number `s p`, e.g. `P3s` =
    present indicative 3rd-singular, `Kfs` = participle feminine-singular.
  - **en:** `PL`, `PAST`, `PASTPART`, `PROG`, `3SG`, `COMP`, `SUP`, `FIN`
    (generic finite verb form of an irregular paradigm), `""` (base form).

### 7. Syntax section
| field      | type              | meaning                               |
|------------|-------------------|---------------------------------------|
| syntaxLen  | u32               | byte length of `syntaxJson`           |
| syntaxJson | u8[syntaxLen]     | UTF-8 JSON, schema below              |

The syntax data is low-volume and hand-authored, so it is stored as one JSON
object (not a packed table). Schema (`SyntaxData` in `format/model.ts`):

```jsonc
{
  "closedClass": {
    "determiners":  ["..."],   // segmentation + chunk seeds
    "pronouns":     ["..."],
    "prepositions": ["..."],
    "conjunctions": ["..."],
    "adverbs":      ["..."],   // deictic/aspectual adverbs that never head an NP
    "abbreviations":["Mr","Dr","etc","..."]  // period here != sentence end
  },
  "chunkRules": [               // shallow NP/VP/PP patterns over POS
    { "chunk": "NP"|"VP"|"PP",
      "pattern": [ { "pos": Pos, "quant": "one"|"opt"|"star" }, ... ] }
  ],
  "suffixGuess": [              // POS guess for unknown words, by surface suffix
    { "suffix": "tion", "pos": "NOUN" }, ...
  ],
  "valency": [                  // verb-lemma subcategorization hints
    { "lemma": "give",
      "frame": "intransitive"|"transitive"|"ditransitive"|"copular"|"prepositional"
             |"presentational" }  // presentational: sole argument is a POSTVERBAL subject
  ],
  "complementizers": ["that"],  // words opening a clausal complement after a verb
  "relativePronouns": ["who"],  // a subject that IS one of these defers to its antecedent
  "passiveAuxiliaries": ["be"], // lemmas that head the passive periphrasis (aux + participle)
  "agentMarkers": ["by"],       // adposition surface forms introducing a passive agent PP
  "expletives": ["there"],      // existential dummies licensing a postverbal copular subject
  "verbFeats": {                // morphology-code prefixes, in this dict's feat vocabulary
    "finitePrefixes":     ["..."],
    "infinitivePrefixes": ["..."],
    "participlePrefixes": ["..."]
  }
}
```
`Pos` values in the JSON are the string names (`"NOUN"`, `"VERB"`, …), not the
byte codes.

### 8. Trailer
| field | type  | value                         |
|-------|-------|-------------------------------|
| magic | u8[4] | `58 4C 42 4D` = ASCII `"XLBM"` |

A reader may verify the trailer as an integrity/truncation check.

## Lookup algorithm (reference)

1. Verify header magic and `version == 2`; read metadata.
2. Load the offset tables (sections 3–4) and keep `entriesBase` and the two
   pools addressable.
3. `lookup(form)`: UTF-8-encode `form`; binary-search `formOffsets`/`formBlob`
   with unsigned byte comparison to find form index `i` (or miss → `[]`).
4. For `k` in `[entryStart[i], entryStart[i+1])`: read the 8-byte record, resolve
   `lemmaRef`→lemma and `featRef`→feat, decode `pos` and `variant`.

Complexity: `O(log formCount)` byte-comparisons per lookup; no full-table
deserialization, no per-form allocation until a hit is materialised.

## Versioning

`version` (u32) gates the whole layout. Any incompatible change — new fields,
reordering, different entry width, changed enum numbering — MUST bump it. A
reader encountering an unknown version fails closed (returns an error) rather
than guessing. New `Pos`/`Variant`/`VariantScheme` codes are additive only:
appended, never renumbered.

History: v2 grew the syntax JSON schema (`relativePronouns`,
`passiveAuxiliaries`, `agentMarkers`, `expletives`,
`verbFeats.participlePrefixes`). The binary layout is unchanged from v1, but
the schema is part of the reader contract — an engine handed a v1 dict would
read `undefined` where it expects those lists — so the version gates it.
