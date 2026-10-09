import { articleDate, articles } from "../../content/articles";
import { pageMetadata } from "../../server/metadata";

export const metadata = pageMetadata(
  "Articles",
  "Package loading results, runtime differences and practical notes from CompatLab.",
  "/articles",
);

export default function Articles() {
  return (
    <div className="page narrow">
      <h1>Articles</h1>
      <p className="lede">Package results and guides for developers and AI agents.</p>
      {articles.map((article) => (
        <article className="article-list-item" key={article.path}>
          <p className="muted">
            <time dateTime={article.publishedAt}>{articleDate(article.publishedAt)}</time> ·{" "}
            {article.author}
          </p>
          <h2>
            <a href={article.path}>{article.title}</a>
          </h2>
          <p>{article.description}</p>
        </article>
      ))}
    </div>
  );
}
