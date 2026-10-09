import { CompatibilityDirectory } from "../../../components/compatibility-directory";
import {
  type DirectoryProps,
  directoryTitle,
  loadDirectory,
} from "../../../server/compatibility-directory";
import { pageMetadata } from "../../../server/metadata";

export async function generateMetadata(props: DirectoryProps) {
  const page = await loadDirectory(props);
  return pageMetadata(
    directoryTitle(false),
    "Compare npm package compatibility on Node.js, Bun and Deno using exact versions, observed loading results and reproducible reports. Functional behavior is not tested.",
    page.path,
    page.entries.length > 0,
  );
}

export default async function CompatibilityPage(props: DirectoryProps) {
  return <CompatibilityDirectory page={await loadDirectory(props)} />;
}
