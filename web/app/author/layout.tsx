import type { Metadata } from "next";

// The form itself is a client component and cannot carry metadata, so the route
// does. Left out of the sitemap's crawl on purpose: /author is a tool, and
// twenty-two parameterised copies of it are not twenty-two pages worth indexing.
export const metadata: Metadata = {
  title: "Author a record (beta)",
  description:
    "Build a canonical BattINFO record in the browser. Every field, option and constraint comes from the published JSON Schemas, so a draft cannot drift from the package.",
};

export default function AuthorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Narrower than the site-wide prototype banner, and about one thing: the
          contract this page draws itself from is not frozen yet. A record
          written today stays readable, but a field may be renamed or added
          under it before 1.0. */}
      <p className="border-b border-warning/20 bg-warning-tint px-6 py-1.5 text-center text-xs text-warning">
        Beta — the BattINFO schemas may still change until battinfo 1.0, and this form follows them.
      </p>
      {children}
    </>
  );
}
