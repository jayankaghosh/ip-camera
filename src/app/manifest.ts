import type { MetadataRoute } from "next";

// Lets phones "Add to Home Screen" / install FurCam with its own name and icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FurCam",
    short_name: "FurCam",
    description: "Watch your pets live and get alerts for movement, meows, barks and crashes.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
