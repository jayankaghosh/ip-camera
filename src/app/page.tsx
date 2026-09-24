import { Suspense } from "react";
import { Home } from "@/components/Home";

export default function Page() {
  // Home reads ?code= from the URL, which needs a Suspense boundary on a prerendered page.
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}
