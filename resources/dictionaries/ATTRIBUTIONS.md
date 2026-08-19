# Dictionary attributions

`pt-BR.dict` and `en.dict` are compiled by `bun tools/lexicon/build.ts` from the
open linguistic resources listed below. Every source shipped inside the `.dict`
files is under a permissive or attribution-only license; each is credited here
as those licenses require. Nothing under a share-alike-only or non-commercial
license is compiled into the shipped files.

## pt-BR.dict

### Unitex-PB DELAF (`Delaf2015v04.dic`)
- **Role:** the entire Brazilian-Portuguese full-form lexicon — inflected form →
  lemma, part of speech, and morphological codes (~861k surface forms).
- **Authors:** NILC (Núcleo Interinstitucional de Linguística Computacional,
  USP/São Carlos) and the Unitex-PB project.
- **License:** LGPL-LR (Lesser General Public License For Linguistic Resources).
- **URL:** http://www.nilc.icmc.usp.br/nilc/projects/unitex-pb/ — the
  `DELAF_PB_v2.zip` archive (retrieved via the Internet Archive snapshot
  `https://web.archive.org/web/20161227211518id_/http://www.nilc.icmc.usp.br/nilc/projects/unitex-pb/web/files/DELAF_PB_v2.zip`).
  The Unitex-PB primary sources are also mirrored, LGPL-LR, at
  https://github.com/datasets-br/unitex-pt-br .

The pt-BR closed-class lists, chunk rules, suffix-guess rules and valency hints
in the dictionary are original work authored for mbook
(`tools/lexicon/syntax/pt-BR.ts`).

## en.dict

### AGID — Automatically Generated Inflection Database (`infl.txt`)
- **Role:** the English open-class lexicon — lemma + part of speech + inflected
  full forms (plurals; verb past / past-participle / progressive / 3rd-singular;
  adjective comparative / superlative).
- **Author:** Kevin Atkinson (2000–2016).
- **License:** permissive MIT/BSD-style — "Permission to use, copy, modify,
  distribute and sell this database … is hereby granted without fee, provided
  that the above copyright notice appears in all copies …". Provided "as is",
  without warranty.
- **URL:** http://wordlist.aspell.net/ (AGID). Retrieved from the mirror
  https://github.com/staticshock/wordlist (`agid/infl.txt`).

### Moby Part-of-Speech II (`mobypos.txt`)
- **Role:** part-of-speech breadth for closed-class words and adverbs that AGID
  (an open-class inflection database) does not cover.
- **Author:** Grady Ward (the Moby Project).
- **License:** public domain.
- **URL:** https://en.wikipedia.org/wiki/Moby_Project ; retrieved from the
  mirror https://github.com/elitejake/Moby-Project
  (`Moby Part-of-Speech II/mobypos.txt`).

### VarCon (`varcon.txt`)
- **Role:** US / UK spelling-variant tags (e.g. color↔colour, -ize↔-ise) applied
  to every English surface form.
- **Authors:** Kevin Atkinson (2000–2020) and Benjamin Titze (2016); derived word
  lists © 1993 Geoff Kuenning (Ispell), BSD-style.
- **License:** permissive MIT/BSD-style — same grant as AGID above; the Ispell
  copyright and modification notices are retained.
- **URL:** http://wordlist.aspell.net/ (VarCon). Retrieved from
  https://github.com/en-wl/wordlist (`varcon/varcon.txt`).

The en closed-class lists, chunk rules, suffix-guess rules and valency hints in
the dictionary are original work authored for mbook
(`tools/lexicon/syntax/en.ts`).

## Dev-side only — NOT shipped

Universal Dependencies treebanks (Bosque for pt, EWT for en; CC BY-SA) may be
downloaded under `tools/lexicon/cache/` for calibration and test fixtures. Their
data is **never** compiled into `pt-BR.dict` or `en.dict`, because CC BY-SA is a
share-alike license outside the permissive/attribution-only set above.
