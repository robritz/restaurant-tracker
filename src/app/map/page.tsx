import { Suspense } from "react";
import MapView from "@/components/MapView";

// The selected Place is read from the query string, so the map has to sit
// behind a Suspense boundary to keep the rest of the route static.
export default function MapPage() {
  return (
    <Suspense>
      <MapView />
    </Suspense>
  );
}
