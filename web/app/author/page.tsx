import { redirect } from "next/navigation";

// The tool lives at /author/<record type>. This is the door people link to and
// type, so it opens on the record type everything else on the site leads with.
export default function AuthorIndex() {
  redirect("/author/cell-spec");
}
