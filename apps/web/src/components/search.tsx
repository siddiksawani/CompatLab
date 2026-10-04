"use client";
import { type SearchResponse, searchResponseSchema } from "@compatlab/contracts";
import { useEffect, useState } from "react";
import { packageUrl, readError } from "./labels";

export function Search({
  initialQuery,
  initialPackages,
  initialError,
}: {
  initialQuery: string;
  initialPackages: SearchResponse["packages"];
  initialError: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState(initialPackages);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (query === initialQuery) {
      setLoading(false);
      setResults(initialPackages);
      setError(initialError);
      return;
    }
    if (!query.trim()) {
      setLoading(false);
      setResults([]);
      setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setResults([]);
    setError("");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/search?${new URLSearchParams({ q: query })}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(readError(response.status));
        setResults(searchResponseSchema.parse(await response.json()).packages);
      } catch (error) {
        if (!controller.signal.aborted) {
          setResults([]);
          setError(error instanceof Error ? error.message : "Search unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, initialQuery, initialPackages, initialError]);
  return (
    <search className="search-area">
      <form action="/" className="search-form">
        <label className="sr-only" htmlFor="package-search">
          Search npm packages
        </label>
        <input
          id="package-search"
          name="q"
          type="search"
          maxLength={200}
          placeholder="Search npm packages, including @scope/name"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">Search packages</button>
      </form>
      <p className="search-status" aria-live="polite">
        {loading
          ? "Searching the public npm registry…"
          : error ||
            (query.trim()
              ? `${results.length} ${results.length === 1 ? "package" : "packages"} found`
              : "Public npm packages. No account required.")}
      </p>
      {results.length > 0 && (
        <ul className="search-results" aria-label="Package results">
          {results.map((pkg) => (
            <li key={pkg.name}>
              <a href={packageUrl(pkg.name, pkg.version)}>
                <div className="row">
                  <strong>{pkg.name}</strong>
                  <span className="mono muted">{pkg.version}</span>
                </div>
                <p>{pkg.description || "No description supplied."}</p>
                <span className="text-link">
                  {pkg.reportId ? "Stored report available" : "Inspect version"}
                  <span aria-hidden="true"> →</span>
                </span>
              </a>
              {pkg.repositoryUrl && (
                <a className="repository-link" href={pkg.repositoryUrl} rel="noreferrer">
                  Source repository
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </search>
  );
}
