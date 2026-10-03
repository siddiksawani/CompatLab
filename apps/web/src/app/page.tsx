import { searchResponseSchema } from "@compatlab/contracts";
import { packageUrl, readError } from "../components/labels";
import { Search } from "../components/search";
import { publicRead } from "../server/runtime";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  let packages: ReturnType<typeof searchResponseSchema.parse>["packages"] = [];
  let error = "";
  if (query) {
    const response = await publicRead(`/api/v1/search?${new URLSearchParams({ q: query })}`);
    if (response.ok) packages = searchResponseSchema.parse(await response.json()).packages;
    else error = readError(response.status);
  }
  return (
    <>
      <section className="hero">
        <p className="eyebrow">The public runtime lab</p>
        <h1>
          Know what loads.
          <br />
          <span>See the evidence.</span>
        </h1>
        <p className="lede">
          Test an exact npm package across Node.js, Bun and Deno. Inspect loading results, coverage
          and the environment behind every observation.
        </p>
        <Search initialQuery={query} initialPackages={packages} initialError={error} />
        <div className="examples">
          <span>Try a package</span>
          {["is-number", "@nodelib/fs.stat", "kleur"].map((name) => (
            <a key={name} href={packageUrl(name)}>
              {name}
            </a>
          ))}
        </div>
      </section>
      <section className="principles" aria-label="How CompatLab works">
        <article>
          <span className="step">01 / Published artifact</span>
          <h2>Start with exact inputs</h2>
          <p>
            A published version, verified integrity and one sealed dependency snapshot shared across
            the runtime matrix.
          </p>
        </article>
        <article>
          <span className="step">02 / Isolated execution</span>
          <h2>Observe each runtime</h2>
          <p>
            Independent import and require checks, then bounded subpath batches. Scripts stay
            disabled and execution stays offline.
          </p>
        </article>
        <article>
          <span className="step">03 / Inspectable results</span>
          <h2>Understand the limits</h2>
          <p>
            Inspect failures, incomplete coverage and pinned environments. Loading success does not
            prove functional correctness.
          </p>
        </article>
      </section>
      <section className="cli-callout">
        <div>
          <p className="eyebrow">Open source by design</p>
          <h2>Bring the lab to your own execution host.</h2>
          <p>The same engine powers local checks and hosted evidence.</p>
          <a className="text-link" href="/methodology#local-cli">
            Read the CLI setup guide →
          </a>
        </div>
        <pre>
          <code>compatlab check is-number@7.0.0 --json</code>
        </pre>
      </section>
    </>
  );
}
