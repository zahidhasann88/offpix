import manifest from "./manifest.json";
import type { ModelManifestEntry } from "../engine/types";
import { PROFILE, PAGES_FILE_LIMIT, PAGES_PARTS } from "../buildProfile";

const allModels = manifest.models as ModelManifestEntry[];

export const models =
  PROFILE === "pages"
    ? allModels.filter(
        (m) =>
          m.size <= PAGES_FILE_LIMIT ||
          (m.pagesParts && PAGES_PARTS.includes(m.id)),
      )
    : allModels;
