import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";
import MarkdownIt from "markdown-it";
import { sitePath } from "@/lib/site-url";

const parser = new MarkdownIt();

export async function GET(context: { site: URL }) {
  const items = (await getCollection("blog"))
    .filter((item) => !item.data.draft && item.data.category === "journal")
    .sort((a, b) => {
      const aDate = new Date(a.data.date.split("-").reverse().join("-")).getTime();
      const bDate = new Date(b.data.date.split("-").reverse().join("-")).getTime();
      return bDate - aDate;
    })
    .slice(0, 50);

  return rss({
    trailingSlash: false,
    title: "PEKHTOGRAPHY — Journal",
    description: "Editorial passages assembled from the archive.",
    site: context.site,
    items: items.map((item) => ({
      link: new URL(sitePath(`/blog/${item.id}`), context.site).toString(),
      pubDate: new Date(item.data.date.split("-").reverse().join("-")),
      title: item.data.title,
      description: item.data.description,
      categories: item.data.tags,
      content: sanitizeHtml(parser.render(item.body ?? "")),
    })),
    customData: "<language>en-us</language>",
  });
}
