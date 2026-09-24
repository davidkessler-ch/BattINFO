import type { Metadata } from "next";

// The form itself is a client component and cannot carry metadata, so the route
// does. Left out of the sitemap's crawl on purpose: /author is a tool, and
// twenty-two parameterised copies of it are not twenty-two pages worth indexing.
export const metadata: Metadata = {
  title: "Author a record",
  description:
    "Build a canonical BattINFO record in the browser. Every field, option and constraint comes from the published JSON Schemas, so a draft cannot drift from the package.",
};

export default function AuthorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
