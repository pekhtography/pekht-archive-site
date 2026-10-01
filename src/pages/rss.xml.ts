import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";
import MarkdownIt from "markdown-it";
import { sitePath } from "@/lib/site-url";

const parser = new MarkdownIt();

export async function GET(context: { site: URL }) {
  const items = (await getCollection("archive"))
    .filter((item) => item.data.x_created_at)
    .sort((a, b) => {
      const aDate = new Date(a.data.x_created_at!).getTime();
      const bDate = new Date(b.data.x_created_at!).getTime();
      return bDate - aDate;
    });

  return rss({
    trailingSlash: false,
    title: "PEKHTOGRAPHY — Archive",
    description: "Photographs and fragments from encounters with the everyday world.",
    site: context.site,
    items: items.map((item) => {
      const imageUrl = new URL(sitePath(item.data.image), context.site).toString();
      const link = new URL(sitePath(`/archive/${item.id}`), context.site).toString();

      return {
        link,
        pubDate: new Date(item.data.x_created_at!),
        title: item.data.title,
        description: item.data.title,
        categories: item.data.hashtags,
        content: sanitizeHtml(
          `<p><img src="${imageUrl}" alt="${item.data.title}" /></p>${parser.render(item.body ?? "")}`,
          {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
          },
        ),
      };
    }),
    customData: "<language>en-us</language>",
  });
}
