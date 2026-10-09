import { CompatibilityDirectory } from "../../../../components/compatibility-directory";
import {
  type DirectoryProps,
  directoryTitle,
  loadDirectory,
} from "../../../../server/compatibility-directory";
import { pageMetadata } from "../../../../server/metadata";

export async function generateMetadata(props: DirectoryProps) {
  const page = await loadDirectory(props, true);
  return pageMetadata(
    directoryTitle(true),
    "Inspect npm package loading failures across Node.js, Bun and Deno. Compare exact versions and original reports. Missing prerequisites alone are excluded.",
    page.path,
    !page.runtime && page.entries.length > 0,
  );
}

export default async function LoadingFailuresPage(props: DirectoryProps) {
  return <CompatibilityDirectory page={await loadDirectory(props, true)} failures />;
}
