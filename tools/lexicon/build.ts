// Dev-only build script: `bun tools/lexicon/build.ts`.
// Downloads (and caches) the open source corpora, parses them into one merged
// lexicon per language, folds in the hand-authored syntax data, encodes the
// binary .dict, and writes it to resources/dictionaries/. Never shipped.

import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { writeFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { Dictionary, LexEntry, Variant } from "./format/model"
import { encodeDictionary } from "./format/encode"
import { parseAgid } from "./sources/agid"
import { parseMoby } from "./sources/moby"
import { parseVarcon } from "./sources/varcon"
import { _internal as delafInternal } from "./sources/delaf"
import { compoundEntries } from "./sources/compounds"
import { EN_SYNTAX } from "./syntax/en"
import { PT_BR_SYNTAX } from "./syntax/pt-BR"

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, "cache")
const OUT = join(HERE, "..", "..", "resources", "dictionaries")

type Download = {
  file: string
  url: string
}

const DELAF_ZIP: Download = {
  file: join(CACHE, "DELAF_PB_v2.zip"),
  url: "https://web.archive.org/web/20161227211518id_/http://www.nilc.icmc.usp.br/nilc/projects/unitex-pb/web/files/DELAF_PB_v2.zip",
}

const DELAF_DIC = join(CACHE, "Delaf2015v04.dic")

const AGID: Download = {
  file: join(CACHE, "agid-infl.txt"),
  url: "https://raw.githubusercontent.com/staticshock/wordlist/master/agid/infl.txt",
}

const MOBY: Download = {
  file: join(CACHE, "mobypos.txt"),
  url: "https://raw.githubusercontent.com/elitejake/Moby-Project/main/Moby%20Part-of-Speech%20II/mobypos.txt",
}

const VARCON: Download = {
  file: join(CACHE, "varcon.txt"),
  url: "https://raw.githubusercontent.com/en-wl/wordlist/master/varcon/varcon.txt",
}

async function ensure(d: Download): Promise<void> {
  switch (existsSync(d.file)) {
    case true:
      return
    case false: {
      process.stdout.write(`downloading ${d.url}\n`)
      const res = await fetch(d.url)
      const buf = new Uint8Array(await res.arrayBuffer())
      writeFileSync(d.file, buf)
      return
    }
  }
}

async function ensureDelafDic(): Promise<void> {
  switch (existsSync(DELAF_DIC)) {
    case true:
      return
    case false: {
      await ensure(DELAF_ZIP)
      process.stdout.write("unzipping DELAF_PB_v2.zip\n")
      const r = spawnSync("unzip", ["-o", DELAF_ZIP.file, "-d", CACHE], { stdio: "inherit" })
      switch (r.status === 0) {
        case true:
          return
        case false:
          throw new Error("unzip failed for DELAF_PB_v2.zip")
      }
    }
  }
}

function streamDelaf(path: string): Promise<LexEntry[]> {
  return new Promise((resolve, reject) => {
    const out: LexEntry[] = []
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })

    rl.on("line", (line) => {
      for (const e of delafInternal.parseLine(line)) {
        out.push(e)
      }
    })

    rl.on("close", () => resolve(out))
    rl.on("error", reject)
  })
}

function variantOf(map: Map<string, Variant>, form: string): Variant {
  const found = map.get(form)

  switch (found === undefined) {
    case true:
      return "both"
    case false:
      return found!
  }
}

function writeDict(dict: Dictionary, name: string): number {
  const bytes = encodeDictionary(dict)
  const target = join(OUT, name)
  writeFileSync(target, bytes)
  return statSync(target).size
}

async function buildPtBr(): Promise<number> {
  await ensureDelafDic()
  process.stdout.write("parsing DELAF (pt-BR)\n")
  const entries = [...(await streamDelaf(DELAF_DIC)), ...compoundEntries()]

  const dict: Dictionary = {
    lang: "pt-BR",
    variantScheme: "none",
    entries,
    syntax: PT_BR_SYNTAX,
  }

  process.stdout.write(`pt-BR entries: ${entries.length}\n`)
  return writeDict(dict, "pt-BR.dict")
}

async function buildEn(): Promise<number> {
  await ensure(AGID)
  await ensure(MOBY)
  await ensure(VARCON)

  process.stdout.write("parsing AGID + Moby + VarCon (en)\n")
  const agid = parseAgid(readFileSync(AGID.file, "utf8"))
  const moby = parseMoby(readFileSync(MOBY.file, "utf8"))
  const variants = parseVarcon(readFileSync(VARCON.file, "utf8"))

  const merged = [...agid, ...moby].map((e) => ({
    form: e.form,
    lemma: e.lemma,
    pos: e.pos,
    feat: e.feat,
    variant: variantOf(variants, e.form),
  }))

  const dict: Dictionary = {
    lang: "en",
    variantScheme: "us-uk",
    entries: merged,
    syntax: EN_SYNTAX,
  }

  process.stdout.write(`en entries: ${merged.length}\n`)
  return writeDict(dict, "en.dict")
}

async function main(): Promise<void> {
  mkdirSync(CACHE, { recursive: true })
  mkdirSync(OUT, { recursive: true })

  const ptSize = await buildPtBr()
  const enSize = await buildEn()

  process.stdout.write(`\nwrote resources/dictionaries/pt-BR.dict (${ptSize} bytes)\n`)
  process.stdout.write(`wrote resources/dictionaries/en.dict (${enSize} bytes)\n`)
}

main().catch((e) => {
  process.stderr.write(`${e}\n`)
  process.exit(1)
})
