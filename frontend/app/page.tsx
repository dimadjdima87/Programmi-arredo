"use client";
import dynamic from "next/dynamic";
const Studio = dynamic(() => import("./studio"), {
  ssr: false,
  loading: () => <p>Caricamento studio…</p>,
});
export default function Page() {
  return <Studio />;
}
