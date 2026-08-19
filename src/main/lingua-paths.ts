// Where the compiled dictionaries live. Packaged, electron-builder's
// extraResources drops them under process.resourcesPath/dictionaries; in dev
// they sit in the repo's resources/dictionaries, resolved off app.getAppPath()
// the same way window.ts resolves the bundled renderer.

import { join } from "node:path"

import { app } from "electron"

export type DictLang = "pt-BR" | "en"

export function dictionariesDir(): string {
  switch (app.isPackaged) {
    case true:
      return join(process.resourcesPath, "dictionaries")
    case false:
      return join(app.getAppPath(), "resources", "dictionaries")
  }
}

export function dictionaryPath(lang: DictLang): string {
  return join(dictionariesDir(), `${lang}.dict`)
}
